import { isMarkdown, isOpenComment, paperUri, type DocComment, type DocOwlit, type EvaluationRecord } from "@owlit/protocol"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { TYPING_MS, type Presence } from "./presence.ts"
import { halfDoneSkill, paragraphsOf, recheckSkill, replySkill, reviewSkill } from "./review.ts"
import { COMMENTING_RUNS, RECHECK_RUN, REPLY_RUN, REVIEW_RUN, SCAN_RUN, SETTLED_REVIEW_RUN } from "./runs.ts"
import { foldable, halfDone, halfDoneSince, sectionsOf, WEEK_MS } from "./scan.ts"
import { randomUUID } from "node:crypto"

// Owlit's runs on the user's docs (rules.ts › docs.*): the tasks that read a changed doc, look over the
// docs once a day, or look again at a comment, and where what they make lands. Two rules hold at every
// step. Nothing it writes is the user's: only Owlit's own comments (core checks). And it never writes on
// the page the user is writing in: a comment made while they type there is held, and lands when they
// stop or leave, if the words it is about are still there (commit-or-abort); one whose words are gone is
// dropped, and the drop is logged. What Owlit did on its own while the user was away waits further: for
// as long as they are back in that doc at all.

export interface ReviewServices {
  workspace: () => Workspace | null
  presence: Presence
  // A background session for the task, with only these of owlit's tools beyond the read-only ones; runId
  // signs what it writes (docs_add_comment comes back to comment())
  agent: (prompt: string, ctx: TaskContext, tools: RegExp, runId: string) => Promise<{ text: string }>
  // Writes one of Owlit's comments to the doc, as from the run's session; quiet, without a word in the
  // window (a run made while the user was away)
  write: (path: string, comment: DocComment, chatId: string | undefined, quiet: boolean) => Promise<void>
  // Owlit looked at a doc (the chip's line)
  looked: (path: string, state: DocOwlit) => void
  // One of Owlit's comments changed: it answered in it, added to it, or folded it away
  replied: (path: string, comment: DocComment) => void
  record: (entry: EvaluationRecord) => void
  now?: () => number
}

interface Held {
  path: string
  comment: DocComment
  chatId?: string
  // add: a new comment; put: one of Owlit's comments with something added to it
  how: "add" | "put"
  // Held for as long as the user is in the doc, not only while they type there
  pushed: boolean
}

// Runs started while the user was away, whose work waits while they are in the doc at all
const PUSHED = new Set<string>([SETTLED_REVIEW_RUN, SCAN_RUN, RECHECK_RUN])
// Never a run's tools: a run that may use only the read-only ones
const NONE = /^$/

const taskOf = (runId: string) => runId.slice(runId.indexOf(":") + 1)
const kindOf = (runId: string) => runId.slice(0, runId.indexOf(":"))

export const isCommentingRun = (runId: string | undefined) => !!runId && (COMMENTING_RUNS as readonly string[]).includes(kindOf(runId))

export class Reviews {
  private readonly services: ReviewServices
  // Comments each run made, held or written, by run id
  private made = new Map<string, number>()
  private held: Held[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(services: ReviewServices) {
    this.services = services
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask(REVIEW_RUN, { lane: reviewSkill.lane, retries: 1, run: (ctx) => this.review(ctx) }),
      defineTask(SETTLED_REVIEW_RUN, { lane: reviewSkill.lane, retries: 1, run: (ctx) => this.review(ctx) }),
      defineTask(REPLY_RUN, { lane: replySkill.lane, retries: 1, run: (ctx) => this.reply(ctx) }),
      defineTask(SCAN_RUN, { lane: halfDoneSkill.lane, retries: 1, run: (ctx) => this.scan(ctx) }),
      defineTask(RECHECK_RUN, { lane: recheckSkill.lane, retries: 1, run: (ctx) => this.recheck(ctx) }),
    ]
  }

  // A comment a run made through docs_add_comment: written now, or held while the user is on that page
  async comment(runId: string, path: string, comment: DocComment) {
    const ws = this.services.workspace()
    const chatId = ws?.tasks.get(taskOf(runId))?.chatId
    const signed = { ...comment, entries: comment.entries.map((e) => ({ ...e, ...(chatId ? { chatId } : {}) })) }
    this.made.set(runId, (this.made.get(runId) ?? 0) + 1)
    const held: Held = { path, comment: signed, chatId, how: "add", pushed: PUSHED.has(kindOf(runId)) }
    if (this.holds(held)) {
      this.hold(held)
      return "held"
    }
    await this.write(held)
    return "written"
  }

  // What was held lands where the user isn't any more
  async land() {
    const ready = this.held.filter((h) => !this.holds(h))
    this.held = this.held.filter((h) => !ready.includes(h))
    const ws = this.services.workspace()
    for (const h of ready) {
      const content = ws ? await ws.docs.read(h.path).then((r) => r.content, () => null) : null
      if (content !== null && content.includes(h.comment.quote)) {
        await this.write(h).catch((error) => console.error("[core] couldn't land Owlit's comment", error))
        continue
      }
      this.services.record({ kind: "evaluation", at: this.now(), rule: "docs.landing", subject: h.path, decision: "none", reason: "the passage changed before the comment landed", cause: "landing" })
    }
    if (this.held.length) this.later()
  }

  dispose() {
    clearTimeout(this.timer)
    this.held = []
  }

  private holds(h: Held) {
    const { presence } = this.services
    return h.pushed ? presence.inDoc(h.path) : presence.writingIn(h.path, this.now())
  }

  private hold(h: Held) {
    this.held.push(h)
    this.later()
  }

  private async write(h: Held) {
    if (h.how === "add") return this.services.write(h.path, h.comment, h.chatId, h.pushed)
    const ws = this.services.workspace()
    if (!ws) return
    // As it is now: the user may have answered, resolved or dismissed it meanwhile
    const now = (await ws.docs.listComments(h.path)).find((c) => c.id === h.comment.id)
    if (!now || !isOpenComment(now)) return
    const added = h.comment.entries.filter((e) => !now.entries.some((n) => n.id === e.id))
    const next = { ...now, entries: [...now.entries, ...added] }
    await ws.docs.putComment(h.path, next)
    this.services.replied(h.path, next)
  }

  private later() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.land()
    }, TYPING_MS)
    this.timer.unref?.()
  }

  private now() {
    return this.services.now?.() ?? Date.now()
  }

  // Owlit answers the user's reply under its comment (subject "<path>#<comment id>"), as one more entry
  private async reply(ctx: TaskContext) {
    const ws = this.services.workspace()
    if (!ws) throw new Error("No workspace is open.")
    const { rel, id } = commentSubject(ctx.task.subject)
    const find = async () => (await ws.docs.listComments(rel)).find((c) => c.id === id)
    const comment = await find()
    // Gone, put away, or already answered: nothing to say
    if (!comment || !isOpenComment(comment) || comment.entries.at(-1)?.by !== "you") return
    const { content } = await ws.docs.read(rel)
    const { text } = await this.services.agent(replySkill.instructions({ path: rel, content, comment }), ctx, replySkill.tools!, `${REPLY_RUN}:${ctx.task.id}`)
    const answer = text.trim()
    if (!answer) throw new Error("Owlit had nothing to say.")
    // As it is now: the user may have written meanwhile
    const now = await find()
    if (!now || !isOpenComment(now)) return
    const chatId = ws.tasks.get(ctx.task.id)?.chatId
    const replied: DocComment = { ...now, entries: [...now.entries, { id: randomUUID(), by: "owlit", text: answer, at: this.now(), ...(chatId ? { chatId } : {}) }] }
    await ws.docs.putComment(rel, replied)
    this.services.replied(rel, replied)
  }

  private async review(ctx: TaskContext) {
    const ws = this.services.workspace()
    if (!ws) throw new Error("No workspace is open.")
    const rel = ctx.task.subject
    if (!isMarkdown(rel)) return
    const owlit = await ws.docs.owlitOf(rel)
    if (owlit.out) return
    const { content, modifiedAt } = await ws.docs.read(rel)
    const paragraphs = paragraphsOf(content)
    const seen = new Set(owlit.looked?.seen ?? [])
    const changed = paragraphs.filter((p) => !seen.has(p.hash))
    const look = async (count: number) => {
      const state = await ws.docs.setLooked(rel, { at: this.now(), mtime: Math.round(modifiedAt), outcome: count ? "comments" : "nothing", count, seen: paragraphs.map((p) => p.hash) })
      this.services.looked(rel, state)
    }
    // Only paragraphs taken away, or words moved: nothing new to read
    if (!changed.length) return look(0)
    const comments = await ws.docs.listComments(rel)
    const owlits = comments.filter((c) => c.entries[0]?.by === "owlit")
    const otherDocs = (await ws.docs.list()).files.map((f) => f.path).filter((p) => p !== rel && isMarkdown(p))
    const prompt = reviewSkill.instructions({
      path: rel,
      changed,
      first: !owlit.looked?.seen,
      otherDocs,
      standing: owlits.filter(isOpenComment),
      dismissed: owlits.filter((c) => c.dismissedAt),
    })
    const runId = `${ctx.task.kind}:${ctx.task.id}`
    this.made.set(runId, 0)
    try {
      await this.services.agent(prompt, ctx, reviewSkill.tools!, runId)
      await look(this.made.get(runId) ?? 0)
    } finally {
      this.made.delete(runId)
    }
  }

  // The daily look over the docs (subject "workspace"): Owlit's comments left behind are folded away,
  // and sections half done for a week get one comment each from a session that gathers what the
  // threads, chats and library have for them. The doc the user is in is left for another day.
  private async scan(ctx: TaskContext) {
    const ws = this.services.workspace()
    if (!ws) throw new Error("No workspace is open.")
    const now = this.now()
    // What the daily rule goes by (rules.ts › docs.dailyScan), set as the look starts
    await ws.docs.setScannedAt(now)
    const due: { path: string; heading: string; body: string }[] = []
    for (const { path: rel } of (await ws.docs.list()).files) {
      if (!isMarkdown(rel) || this.services.presence.inDoc(rel)) continue
      const owlit = await ws.docs.owlitOf(rel).catch(() => null)
      if (!owlit || owlit.out) continue
      const content = await ws.docs.read(rel).then(
        (r) => r.content,
        () => null,
      )
      if (content === null) continue
      const comments = await ws.docs.listComments(rel)
      for (const c of foldable(comments, content, now)) {
        const folded = { ...c, foldedAt: now }
        await ws.docs.putComment(rel, folded)
        this.services.replied(rel, folded)
      }
      const found = halfDone(sectionsOf(content))
      const since = halfDoneSince(found, owlit.halfDone, now)
      if (JSON.stringify(since) !== JSON.stringify(owlit.halfDone ?? {})) await ws.docs.setHalfDone(rel, since)
      // Once per section: a comment of Owlit's on the heading, standing or put away, means it has spoken
      const spoken = new Set(comments.filter((c) => c.entries[0]?.by === "owlit").map((c) => c.quote.trim()))
      for (const s of found)
        if (now - since[s.key]! >= WEEK_MS && !spoken.has(s.heading) && !spoken.has(s.title)) due.push({ path: rel, heading: s.heading, body: s.body })
    }
    if (!due.length) return
    await this.services.agent(halfDoneSkill.instructions({ sections: due.slice(0, 5) }), ctx, halfDoneSkill.tools!, `${SCAN_RUN}:${ctx.task.id}`)
  }

  // One of Owlit's comments that leans on a paper the user has now read in full (subject
  // "<path>#<comment id>|<paper id>"): Owlit reads the paper again and adds to the comment if what it
  // said needs it
  private async recheck(ctx: TaskContext) {
    const ws = this.services.workspace()
    if (!ws) throw new Error("No workspace is open.")
    const bar = ctx.task.subject.lastIndexOf("|")
    const { rel, id } = commentSubject(ctx.task.subject.slice(0, bar))
    const paperId = ctx.task.subject.slice(bar + 1)
    const comment = (await ws.docs.listComments(rel)).find((c) => c.id === id)
    if (!comment || !isOpenComment(comment)) return
    const { content } = await ws.docs.read(rel)
    const title = (await ws.library.get(paperId).catch(() => undefined))?.title ?? paperId
    const { text } = await this.services.agent(recheckSkill.instructions({ path: rel, content, comment, paperId, title }), ctx, recheckSkill.tools ?? NONE, `${RECHECK_RUN}:${ctx.task.id}`)
    const answer = text.trim()
    if (!answer || /^still holds\.?$/i.test(answer)) return
    const chatId = ws.tasks.get(ctx.task.id)?.chatId
    const entry = { id: randomUUID(), by: "owlit" as const, text: answer, at: this.now(), ...(chatId ? { chatId } : {}) }
    const held: Held = { path: rel, comment: { ...comment, entries: [...comment.entries, entry] }, chatId, how: "put", pushed: true }
    if (this.holds(held)) this.hold(held)
    else await this.write(held)
  }
}

// "<path>#<comment id>"
function commentSubject(subject: string) {
  const cut = subject.lastIndexOf("#")
  return { rel: subject.slice(0, cut), id: subject.slice(cut + 1) }
}

// Owlit's open comments that lean on a paper: they link to it
export function leaningOn(comments: readonly DocComment[], paperId: string) {
  const link = paperUri(paperId)
  return comments.filter((c) => c.entries[0]?.by === "owlit" && isOpenComment(c) && c.entries.some((e) => e.by === "owlit" && (e.text.includes(`${link})`) || e.text.includes(`${link}#`))))
}
