import { isMarkdown, isOpenComment, type DocComment, type DocOwlit, type EvaluationRecord } from "@owlit/protocol"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { TYPING_MS, type Presence } from "./presence.ts"
import { paragraphsOf, replySkill, reviewSkill } from "./review.ts"
import { randomUUID } from "node:crypto"

// Owlit's review runs (rules.ts › docs.reviewOnOpen): the task that reads a changed doc, and where its
// comments land. Two rules hold at every step. Nothing it writes is the user's: only Owlit's own
// comments (core checks). And it never writes on the page the user is writing in: a comment made while
// they type there is held, and lands when they stop or leave, if the words it is about are still there
// (commit-or-abort); one whose words are gone is dropped, and the drop is logged.

export interface ReviewServices {
  workspace: () => Workspace | null
  presence: Presence
  // A background session for the task, with only these of owlit's tools beyond the read-only ones; runId
  // signs what it writes (docs_add_comment comes back to comment())
  agent: (prompt: string, ctx: TaskContext, tools: RegExp, runId: string) => Promise<{ text: string }>
  // Writes one of Owlit's comments to the doc, as from the run's session
  write: (path: string, comment: DocComment, chatId: string | undefined) => Promise<void>
  // Owlit looked at a doc (the chip's line)
  looked: (path: string, state: DocOwlit) => void
  // Owlit answered in one of its comments
  replied: (path: string, comment: DocComment) => void
  record: (entry: EvaluationRecord) => void
  now?: () => number
}

interface Held {
  path: string
  comment: DocComment
  chatId?: string
}

export const REVIEW_RUN = "docs.review"
export const REPLY_RUN = "docs.reply"

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
      defineTask(REPLY_RUN, { lane: replySkill.lane, retries: 1, run: (ctx) => this.reply(ctx) }),
    ]
  }

  // A comment a run made through docs_add_comment: written now, or held while the user writes in the doc
  async comment(runId: string, path: string, comment: DocComment) {
    const ws = this.services.workspace()
    const chatId = ws?.tasks.get(runId.slice(REVIEW_RUN.length + 1))?.chatId
    const signed = { ...comment, entries: comment.entries.map((e) => ({ ...e, ...(chatId ? { chatId } : {}) })) }
    this.made.set(runId, (this.made.get(runId) ?? 0) + 1)
    if (this.services.presence.writingIn(path, this.now())) {
      this.held.push({ path, comment: signed, chatId })
      this.later()
      return "held"
    }
    await this.services.write(path, signed, chatId)
    return "written"
  }

  // What was held lands where the user isn't writing any more
  async land() {
    const now = this.now()
    const ready = this.held.filter((h) => !this.services.presence.writingIn(h.path, now))
    this.held = this.held.filter((h) => !ready.includes(h))
    const ws = this.services.workspace()
    for (const h of ready) {
      const content = ws ? await ws.docs.read(h.path).then((r) => r.content, () => null) : null
      if (content !== null && content.includes(h.comment.quote)) {
        await this.services.write(h.path, h.comment, h.chatId).catch((error) => console.error("[core] couldn't land Owlit's comment", error))
        continue
      }
      this.services.record({ kind: "evaluation", at: now, rule: "docs.reviewOnOpen", subject: h.path, decision: "none", reason: "the passage changed before the comment landed", cause: "landing" })
    }
    if (this.held.length) this.later()
  }

  dispose() {
    clearTimeout(this.timer)
    this.held = []
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
    const cut = ctx.task.subject.lastIndexOf("#")
    const rel = ctx.task.subject.slice(0, cut)
    const id = ctx.task.subject.slice(cut + 1)
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
    const runId = `${REVIEW_RUN}:${ctx.task.id}`
    this.made.set(runId, 0)
    try {
      await this.services.agent(prompt, ctx, reviewSkill.tools!, runId)
      await look(this.made.get(runId) ?? 0)
    } finally {
      this.made.delete(runId)
    }
  }
}
