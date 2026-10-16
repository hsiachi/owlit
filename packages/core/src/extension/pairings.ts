import { t } from "@lingui/core/macro"
import type { ExtensionPairing, ExtensionView, PairAnswer, StoredPairing } from "@owlit/protocol"
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type { SettingsStore } from "../settings.ts"
import { HttpFailure } from "./http.ts"

// How long the question stays in the window before the extension has to ask again
export const QUESTION_MS = 2 * 60_000
// How long one GET /pair/:pairing waits for the answer. Under 30 s: Chrome stops an extension's service
// worker whose fetch takes longer than that to answer.
export const HOLD_MS = 20_000
// A pairing's last request is written to settings.json at most this often
const SEEN_EVERY_MS = 60_000

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

interface Question {
  id: string
  browser: string
  at: number
  answer?: { allowed: true; token: string } | { allowed: false }
  expired?: boolean
  // GET /pair/:pairing requests holding for the answer
  waiters: Set<() => void>
  timer: ReturnType<typeof setTimeout>
}

// The extensions the user allowed (settings.extension.paired) and the ones asking. A token is shown to
// its extension once, when the user allows it; settings.json keeps only its SHA-256.
export class Pairings {
  private readonly settings: SettingsStore
  private readonly changed: () => void
  private readonly questionMs: number
  private readonly questions = new Map<string, Question>()

  constructor(settings: SettingsStore, changed: () => void, options: { questionMs?: number } = {}) {
    this.settings = settings
    this.changed = changed
    this.questionMs = options.questionMs ?? QUESTION_MS
  }

  async view(serving: boolean, portTaken: boolean): Promise<ExtensionView> {
    const paired = await this.paired()
    const asking = [...this.questions.values()].filter((q) => !q.answer && !q.expired).map(({ id, browser, at }) => ({ id, browser, at }))
    return { serving, portTaken, paired: paired.map(({ id, browser, pairedAt, lastSeenAt }): ExtensionPairing => (lastSeenAt ? { id, browser, pairedAt, lastSeenAt } : { id, browser, pairedAt })), asking }
  }

  // The pairing this bearer token belongs to
  async byToken(token: string): Promise<StoredPairing | undefined> {
    const offered = Buffer.from(sha256(token), "hex")
    return (await this.paired()).find((p) => {
      const kept = Buffer.from(p.tokenSha256, "hex")
      return kept.length === offered.length && timingSafeEqual(kept, offered)
    })
  }

  // An extension in this browser asks to connect: the question goes to the window
  ask(browser: string): { pairing: string; expiresIn: number } {
    const id = randomUUID()
    const question: Question = {
      id,
      browser,
      at: Date.now(),
      waiters: new Set(),
      timer: setTimeout(() => {
        question.expired = true
        this.settle(question)
        // Kept a moment longer, so a request already on its way learns it expired rather than not found
        setTimeout(() => this.questions.delete(id), HOLD_MS * 2).unref?.()
      }, this.questionMs),
    }
    question.timer.unref?.()
    this.questions.set(id, question)
    this.changed()
    return { pairing: id, expiresIn: this.questionMs }
  }

  // The answer once there is one, or "waiting" after holdMs; the token is handed over once
  async wait(id: string, holdMs: number, closed: AbortSignal): Promise<PairAnswer> {
    const question = this.questions.get(id)
    if (!question) throw new HttpFailure(404, "not-found", t`owlit has no such question.`)
    if (!question.answer && !question.expired) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          question.waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, holdMs)
        question.waiters.add(done)
        closed.addEventListener("abort", done, { once: true })
      })
    }
    if (question.answer?.allowed) {
      const { token } = question.answer
      this.questions.delete(id)
      return { state: "allowed", token }
    }
    if (question.answer) {
      this.questions.delete(id)
      throw new HttpFailure(403, "refused", t`You didn't allow this browser to connect to owlit.`)
    }
    if (question.expired) throw new HttpFailure(408, "expired", t`Nobody answered in owlit. Press Connect again.`)
    return { state: "waiting" }
  }

  // The user's answer in the window
  async answer(id: string, allow: boolean) {
    const question = this.questions.get(id)
    if (!question || question.answer || question.expired) return
    if (allow) {
      const token = randomBytes(32).toString("base64url")
      const pairing: StoredPairing = { id: randomUUID(), browser: question.browser, tokenSha256: sha256(token), pairedAt: Date.now() }
      await this.settings.update((s) => ({ ...s, extension: { paired: [...(s.extension?.paired ?? []), pairing] } }))
      question.answer = { allowed: true, token }
    } else question.answer = { allowed: false }
    clearTimeout(question.timer)
    // Answered and never collected (the extension went away): its token isn't kept in memory for long
    setTimeout(() => this.questions.delete(id), HOLD_MS * 2).unref?.()
    this.settle(question)
  }

  async forget(id: string) {
    await this.settings.update((s) => ({ ...s, extension: { paired: (s.extension?.paired ?? []).filter((p) => p.id !== id) } }))
    this.changed()
  }

  // A request from this pairing: when it was last seen, kept now and then
  async seen(pairing: StoredPairing) {
    const now = Date.now()
    if (pairing.lastSeenAt && now - pairing.lastSeenAt < SEEN_EVERY_MS) return
    await this.settings.update((s) => ({ ...s, extension: { paired: (s.extension?.paired ?? []).map((p) => (p.id === pairing.id ? { ...p, lastSeenAt: now } : p)) } }))
    this.changed()
  }

  dispose() {
    for (const question of this.questions.values()) {
      clearTimeout(question.timer)
      question.expired = true
      this.settle(question)
    }
    this.questions.clear()
  }

  private async paired() {
    return (await this.settings.get()).extension?.paired ?? []
  }

  private settle(question: Question) {
    for (const waiter of [...question.waiters]) waiter()
    this.changed()
  }
}
