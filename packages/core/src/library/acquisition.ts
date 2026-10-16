import type { PdfState, PdfTry } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { clean, type Serial } from "../util.ts"
import { paperDir } from "./paths.ts"
import { hasPdfFile, pdfFile } from "./pdf.ts"

// Where getting a paper's PDF stands, kept in library/papers/<id>/acquisition.json. This module is its
// only reader and writer: every try at the PDF, by anyone, is one entry in `tried`, and `state` is worked
// out from them in one function (standing), so nothing else decides it again.

export type { PdfTry }

// have-it: the PDF was placed (and paper.pdf is there); the window never sees it as a state
export type PdfStanding = PdfState["state"] | "have-it"

export interface Acquisition {
  version: 2
  state: PdfStanding
  // Newest last, at most MAX_TRIES
  tried: PdfTry[]
  // Where a PDF found by hand goes
  dropHere: string
  // The route that gave the PDF in place, and its SHA-256, so the same file dropped again is recognised
  route?: string
  sha256?: string
  // How many of owlit's looks in a row found no PDF, for spacing out the daily look (lookDue)
  looks?: number
  // When the user's browser was last sent for it, and whether to an article page for them to save the
  // PDF from: their Downloads is looked at from then, across restarts. It goes with the Downloads watch.
  sentToBrowser?: { at: number; page: boolean }
}

// Enough for every route of several looks; the daily look adds a few each time, so older ones go
const MAX_TRIES = 60

// The daily look for a paper without a PDF, spaced out the longer nothing comes: a day after the first
// look, then 3, 7 and 30 days, since a daily look at every such paper visits their publishers dozens of
// times a day for nothing. New open copies do turn up, so it never stops.
const LOOK_AGAIN_DAYS = [1, 3, 7, 30]
const DAY_MS = 24 * 60 * 60 * 1000

// Where the paper stands after these tries, and the try that says why. Finding before any try, and while
// the newest found nothing reachable; have-it once the newest brought the PDF. Otherwise no PDF, for
// the reason of the newest try since the last PDF, except where owlit's own try says less than an
// earlier one: finding no open copy hides nothing (a library that said no still hasn't got it), and a
// page that stopped owlit with a check or a sign-in doesn't hide what the user's browser, which gets
// past those, was told.
export function standing(tried: readonly PdfTry[]): { state: PdfStanding; reason?: PdfTry } {
  const newest = tried.at(-1)
  if (!newest) return { state: "finding" }
  if (newest.ended === "offline") return { state: "finding", reason: newest }
  if (newest.ended === "pdf") return { state: "have-it", reason: newest }
  let reason: PdfTry | undefined
  for (const t of tried) {
    if (t.ended === "pdf") reason = undefined
    else if (t.ended === "offline") continue
    else if (!reason || !saysLess(t, reason)) reason = t
  }
  return { state: "no-pdf", reason: reason ?? newest }
}

const saysLess = (later: PdfTry, earlier: PdfTry) =>
  later.by === "owlit" && ((later.ended === "no-copy" && earlier.ended !== "no-copy") || ((later.ended === "check" || later.ended === "sign-in") && earlier.by !== "owlit"))

// When owlit's back-off look is next due for a paper without its PDF: from its newest look, after
// LOOK_AGAIN_DAYS by how many found nothing. undefined while it isn't spaced out (finding).
export function nextLookAt(acquisition: Pick<Acquisition, "state" | "tried" | "looks">) {
  if (acquisition.state !== "no-pdf") return undefined
  const last = acquisition.tried.findLast((t) => t.by === "owlit")?.at ?? acquisition.tried.at(-1)?.at ?? 0
  const days = LOOK_AGAIN_DAYS[Math.min(Math.max(acquisition.looks ?? 1, 1), LOOK_AGAIN_DAYS.length) - 1]
  return last + days * DAY_MS
}

// Whether the daily look takes the paper now: a paper with no PDF once its back-off is over, and one
// still finding because nothing could be reached, which has no back-off to wait for
export function lookDue(acquisition: Pick<Acquisition, "state" | "tried" | "looks">, now: number) {
  if (acquisition.state === "finding") return acquisition.tried.at(-1)?.ended === "offline"
  const next = nextLookAt(acquisition)
  // A little early is fine: a look that ran at 9:05 yesterday is due at 9:00 today
  return next !== undefined && now >= next - 60 * 60 * 1000
}

// ---- The older file (version 1), read into tries once

interface AttemptV1 {
  route: string
  url: string
  // HTTP status, or 0 when nothing answered
  status?: number
  error?: string
  at: number
}

export interface AcquisitionV1 {
  version: 1
  result: "ok" | "no_pdf"
  route?: string
  tried: AttemptV1[]
  at: number
  dropHere: string
  sha256?: string
  needs?: { reason: "challenge" | "login" | "refused" | "browser"; route: string; at: number; host?: string; url?: string }
  yourBrowser?: { outcome: "no-access" | "refused" | "missing" | "missed"; at: number; host?: string; title?: string }
  looked?: { outcome: "no-access" | "missing"; at: number; host?: string; title?: string }
  looks?: number
  sentToBrowser?: { at: number; page: boolean }
}

// Routes a PDF the user placed came by in version 1
const PLACED_BY_YOU = new Set(["dropped", "your-browser"])

// A version 1 file in today's shape: each of its fields becomes one try. Its attempts are owlit's
// routes finding no copy, or one offline try when none of them reached anything; what the publisher's
// page wanted is a check or a sign-in; what the user's browser and owlit's were told keep their words.
export function migrate(old: AcquisitionV1 | Acquisition): Acquisition {
  if (old.version === 2) return old
  const attempts = (old.tried ?? []).filter((a) => !a.error?.startsWith("Not tried"))
  const placedRoute = old.result === "ok" ? old.route : undefined
  const placed = placedRoute ? attempts.findLastIndex((a) => a.route === placedRoute) : -1
  const failed = attempts.filter((_, i) => i !== placed)
  const unreachable = (a: AttemptV1) => !a.status && /couldn't reach/i.test(a.error ?? "")
  const tried: PdfTry[] = []
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname || undefined
    } catch {
      return undefined
    }
  }
  if (failed.length && failed.every(unreachable)) tried.push({ by: "owlit", ended: "offline", at: failed.at(-1)!.at })
  else for (const a of failed) tried.push(clean({ by: "owlit", ended: "no-copy", at: a.at, route: a.route, host: hostOf(a.url) }))
  if (old.needs) tried.push(clean({ by: "owlit", ended: old.needs.reason === "login" ? "sign-in" : "check", at: old.needs.at, route: old.needs.route, host: old.needs.host }))
  if (old.looked) {
    const ended = old.looked.outcome === "missing" ? "not-there" : "no-access"
    tried.push(clean({ by: "owlit", ended, at: old.looked.at, host: old.looked.host, title: old.looked.title }))
  }
  if (old.yourBrowser) {
    const ended = ({ "no-access": "no-access", refused: "not-offered", missing: "not-there", missed: "nothing-came" } as const)[old.yourBrowser.outcome]
    tried.push(clean({ by: "you", ended, at: old.yourBrowser.at, host: old.yourBrowser.host, title: old.yourBrowser.title }))
  }
  tried.sort((a, b) => a.at - b.at)
  if (old.result === "ok") {
    const a = placed >= 0 ? attempts[placed] : undefined
    tried.push(clean({ by: PLACED_BY_YOU.has(placedRoute ?? "") ? "you" : "owlit", ended: "pdf", at: a?.at ?? old.at, route: placedRoute }))
  } else if (!tried.length) tried.push({ by: "owlit", ended: "no-copy", at: old.at })
  return clean({
    version: 2 as const,
    state: standing(tried).state,
    tried: tried.slice(-MAX_TRIES),
    dropHere: old.dropHere,
    route: placedRoute,
    sha256: old.result === "ok" ? old.sha256 : undefined,
    looks: old.looks,
    sentToBrowser: old.sentToBrowser,
  })
}

// ---- Reading and writing

export const acquisitionFile = (root: string, id: string) => path.join(paperDir(root, id), "acquisition.json")

// The paper's record in today's shape (a version 1 file is read into it), or undefined before owlit looked
export const readAcquisition = (root: string, id: string) =>
  readJson<AcquisitionV1 | Acquisition>(acquisitionFile(root, id)).then(
    (raw) => (raw && typeof raw === "object" && Array.isArray(raw.tried) ? migrate(raw) : undefined),
    () => undefined,
  )

const write = (root: string, id: string, acquisition: Acquisition) => writeJsonAtomic(acquisitionFile(root, id), acquisition, { parents: false })

// A PDF in place: how it came. by "you" for a file the user dropped or chose, or one taken from their
// Downloads; route names the way ("dropped", "your-browser", "arxiv", "browser:acm")
export interface Placed {
  by: PdfTry["by"]
  route: string
  sha256: string
}

interface Locking {
  // The paper may have moved or gone to the trash while this waited for the lock: nothing is written
  signal?: AbortSignal
  // The caller already holds the library's lock (Serial isn't reentrant)
  held?: boolean
}

// The writers, each under the library's lock, so a try noted by one way never lands over a PDF another
// way just placed
export class Acquisitions {
  private readonly root: string
  private readonly serial: Serial

  constructor(root: string, serial: Serial) {
    this.root = root
    this.serial = serial
  }

  read(id: string) {
    return readAcquisition(this.root, id)
  }

  // What the window is shown for a paper without its PDF; the run in the user's browser is added by the
  // library, which keeps it in memory
  async shown(id: string): Promise<PdfState> {
    const acquisition = await this.read(id)
    if (!acquisition) return { state: "finding", tried: [] }
    const { reason } = standing(acquisition.tried)
    // A PDF placed and then taken away outside owlit: nothing is looking, so the next look finds it
    const state = acquisition.state === "have-it" ? "finding" : acquisition.state
    const nextLook = nextLookAt(acquisition)
    return clean({ state, tried: acquisition.tried, reason: state === "finding" && reason?.ended === "pdf" ? undefined : reason, nextLook })
  }

  // Tries that ended without the PDF, appended; look: they were owlit's look through its routes, which
  // counts towards spacing the next one out. Whether they were noted: not when a PDF is in place
  // (another way placed it meanwhile, and its record stands).
  noteTried(id: string, tries: PdfTry | PdfTry[], options: Locking & { look?: boolean } = {}): Promise<boolean> {
    return this.locked(options, async () => {
      if (await hasPdfFile(this.root, id)) return false
      const previous = await this.read(id)
      const tried = [...(previous?.tried ?? []), ...[tries].flat()].slice(-MAX_TRIES)
      const looks = options.look ? (previous?.state === "no-pdf" ? (previous.looks ?? 1) : 0) + 1 : previous?.looks
      await write(this.root, id, this.next(id, previous, tried, { looks }))
      return true
    })
  }

  // The paper's PDF in place. place, when given, moves the file there under the same lock, after the
  // signal is checked, so the file and its record always change together.
  notePlaced(id: string, placed: Placed, options: Locking & { place?: () => Promise<void> } = {}): Promise<void> {
    return this.locked(options, async () => {
      await options.place?.()
      const previous = await this.read(id)
      const tried = [...(previous?.tried ?? []), { by: placed.by, ended: "pdf" as const, at: Date.now(), route: placed.route }].slice(-MAX_TRIES)
      await write(this.root, id, this.next(id, previous, tried, { route: placed.route, sha256: placed.sha256 }))
    })
  }

  // When the user's browser was sent for the paper, so a PDF saved after a restart is still found
  noteSent(id: string, page: boolean): Promise<void> {
    return this.locked({}, async () => {
      const previous = await this.read(id)
      if (!previous || previous.state === "have-it") return
      await write(this.root, id, this.next(id, previous, previous.tried, { sentToBrowser: { at: Date.now(), page } }))
    })
  }

  // The SHA-256 of the PDF in place, worked out once for a record that hasn't got it
  noteHash(id: string, sha256: string, options: Locking = {}): Promise<void> {
    return this.locked(options, async () => {
      const previous = await this.read(id)
      if (previous) await write(this.root, id, this.next(id, previous, previous.tried, { sha256 }))
    })
  }

  // Every version 1 file written again in today's shape, so it is read into tries only once
  async migrateAll(ids: string[]) {
    for (const id of ids) {
      await this.locked({}, async () => {
        const raw = await readJson<{ version?: number }>(acquisitionFile(this.root, id)).catch(() => undefined)
        if (raw?.version !== 1) return
        const acquisition = await this.read(id)
        if (acquisition) await write(this.root, id, acquisition)
      })
    }
  }

  // The one place a record is put together: the tries decide the state; what carries over from the
  // record before is listed here and nowhere else
  private next(id: string, previous: Acquisition | undefined, tried: PdfTry[], change: Partial<Pick<Acquisition, "looks" | "route" | "sha256" | "sentToBrowser">>): Acquisition {
    const { state } = standing(tried)
    const placed = state === "have-it"
    return clean({
      version: 2 as const,
      state,
      tried,
      dropHere: pdfFile(this.root, id),
      // Of the PDF in place only
      route: placed ? (change.route ?? previous?.route) : undefined,
      sha256: placed ? (change.sha256 ?? previous?.sha256) : undefined,
      // Of the looks since the last PDF only
      looks: placed ? undefined : "looks" in change ? change.looks : previous?.looks,
      sentToBrowser: placed ? undefined : (change.sentToBrowser ?? previous?.sentToBrowser),
    })
  }

  private locked<T>(options: Locking, work: () => Promise<T>): Promise<T> {
    const run = async () => {
      options.signal?.throwIfAborted()
      return work()
    }
    return options.held ? run() : this.serial.run(run)
  }
}
