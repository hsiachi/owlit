import { isMarkdown, isOpenComment, paperUri, parentPath, type DocComment, type DocOwlit, type EvaluationRecord } from "@owlit/protocol"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { TYPING_MS, type Presence } from "./presence.ts"
import { recheckSkill, replySkill } from "./review.ts"
import { COMMENTING_RUNS, GO_THROUGH_RUN, RECHECK_RUN, REPLY_RUN } from "./runs.ts"
import { cleanReading, goThroughSkill, isChinese, MEETINGS, recordOf } from "./go-through.ts"
import { randomUUID } from "node:crypto"

// Owlit's runs on the user's docs: the tasks that answer under one of its comments, look at a comment
// again, or go through material against the docs, and where what they make lands. Two rules hold at every
// step. Nothing it writes is the user's: only Owlit's own comments (core checks). And it never writes on
// the page the user is writing in: a comment made while they type there is held, and lands when they
// stop or leave, if the words it is about are still there (commit-or-abort); one whose words are gone is
// dropped, and the drop is logged. What Owlit did on its own waits further: for as long as the user is in
// that doc at all.

export interface ReviewServices {
  workspace: () => Workspace | null
  presence: Presence
  // A background session for the task, with only these of owlit's tools beyond the read-only ones; runId
  // signs what it writes (docs_add_comment comes back to comment())
  agent: (prompt: string, ctx: TaskContext, tools: RegExp, runId: string) => Promise<{ text: string }>
  // Writes one of Owlit's comments to the doc, as from the run's session; quiet, without a word in the
  // window (a run made while the user was away)
  write: (path: string, comment: DocComment, chatId: string | undefined, quiet: boolean) => Promise<void>
  // Owlit looked at a doc (the chip's line), or went through it
  looked: (path: string, state: DocOwlit) => void
  // Writes a new doc of Owlit's (a Go through's record), as an agent's write from the run's session:
  // kept as a version, so the run offers Undo
  writeRecord: (path: string, content: string, chatId: string | undefined) => Promise<void>
  // One of Owlit's comments changed: it answered in it, added to it, or folded it away
  replied: (path: string, comment: DocComment) => void
  record: (entry: EvaluationRecord) => void
  now?: () => number
  // The user's name, when they gave one (a Go through writes their own words as "you")
  userName?: () => Promise<string | undefined>
}

interface Held {
  path: string
  comment: DocComment
  chatId?: string
  // add: a new comment; put: one of Owlit's comments with something added to it
  how: "add" | "put"
  // Held for as long as the user is in the doc, not only while they type there
  pushed: boolean
  // A Go through's comment: held until the record it points back to is written, and dropped if it never is
  run?: string
}

// Runs nobody is waiting for, whose work waits while the user is in the doc at all
const PUSHED = new Set<string>([RECHECK_RUN])
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
  // The record each Go through run is writing, while it hasn't been written
  private records = new Map<string, { path: string; label: string }>()

  constructor(services: ReviewServices) {
    this.services = services
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask(REPLY_RUN, { lane: replySkill.lane, retries: 1, run: (ctx) => this.reply(ctx) }),
      defineTask(RECHECK_RUN, { lane: recheckSkill.lane, retries: 1, run: (ctx) => this.recheck(ctx) }),
      defineTask(GO_THROUGH_RUN, { lane: goThroughSkill.lane, retries: 1, run: (ctx) => this.goThrough(ctx) }),
    ]
  }

  // Goes through material from people (subject: its path) against the user's docs. The agent's answer is
  // the reading, written as a record beside the material; the points it lands meanwhile wait for the
  // record, since they point back to it, and are dropped if the run doesn't get that far.
  private async goThrough(ctx: TaskContext) {
    const ws = this.services.workspace()
    if (!ws) throw new Error("No workspace is open.")
    const rel = ctx.task.subject
    const { content } = await ws.docs.read(rel)
    if (!content.trim()) return
    const chinese = isChinese(content)
    const name = rel.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "")
    const record = ws.docs.freePath(parentPath(rel), `${name} · ${chinese ? "解读" : "reading"}`, ".md")
    const label = record.split("/").pop()!.replace(/\.md$/i, "")
    const docs = (await ws.docs.list()).files.map((f) => f.path).filter((p) => p !== rel && isMarkdown(p) && !MEETINGS.test(p))
    const runId = `${GO_THROUGH_RUN}:${ctx.task.id}`
    this.records.set(runId, { path: record, label })
    try {
      const today = new Date(this.now()).toISOString().slice(0, 10)
      const user = (await this.services.userName?.())?.trim() || undefined
      const { text } = await this.services.agent(goThroughSkill.instructions({ path: rel, content, record, recordLabel: label, docs, today, user }), ctx, goThroughSkill.tools!, runId)
      const reading = cleanReading(text)
      if (!reading.startsWith("# ")) throw new Error("Owlit's reading didn't come out as one.")
      await this.services.writeRecord(record, recordOf(reading, rel, chinese), ws.tasks.get(ctx.task.id)?.chatId)
      this.services.looked(rel, await ws.docs.setWentThrough(rel, { at: this.now(), record }))
    } finally {
      this.records.delete(runId)
      // Points of a run that stopped before its record: nothing to point back to
      if (!(await ws.docs.readDisk(record))) this.held = this.held.filter((h) => h.run !== runId)
    }
    await this.land()
  }

  // A comment a run made through docs_add_comment: written now, or held while the user is on that page
  async comment(runId: string, path: string, comment: DocComment) {
    const ws = this.services.workspace()
    const chatId = ws?.tasks.get(taskOf(runId))?.chatId
    // A Go through's comments carry over what people said, from the record it is writing
    const source = this.records.get(runId)
    const signed = { ...comment, ...(source ? { source } : {}), entries: comment.entries.map((e) => ({ ...e, ...(chatId ? { chatId } : {}) })) }
    this.made.set(runId, (this.made.get(runId) ?? 0) + 1)
    const held: Held = { path, comment: signed, chatId, how: "add", pushed: PUSHED.has(kindOf(runId)), ...(source ? { run: runId } : {}) }
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
    await this.landAll(ready)
    if (this.held.length) this.later()
  }

  // The workspace is closing, its tasks already stopped: the user has left every doc in it, so what was
  // held lands now, while it is still the open one. It can't wait: the next workspace may have a doc at
  // the same path. A Go through's points whose record never got written have nothing to point back to.
  async stop() {
    clearTimeout(this.timer)
    this.timer = undefined
    const held = this.held.filter((h) => !(h.run && this.records.has(h.run)))
    this.held = []
    this.records.clear()
    this.made.clear()
    await this.landAll(held)
  }

  dispose() {
    clearTimeout(this.timer)
    this.held = []
  }

  private async landAll(ready: Held[]) {
    const ws = this.services.workspace()
    for (const h of ready) {
      const content = ws ? await ws.docs.read(h.path).then((r) => r.content, () => null) : null
      // Written into whichever workspace is open: never another one's doc at the same path
      if (this.services.workspace() !== ws) return
      if (content !== null && content.includes(h.comment.quote)) {
        await this.write(h).catch((error) => console.error("[core] couldn't land Owlit's comment", error))
        continue
      }
      this.services.record({ kind: "evaluation", at: this.now(), rule: "docs.landing", subject: h.path, decision: "none", reason: "the passage changed before the comment landed", cause: "landing" })
    }
  }

  private holds(h: Held) {
    if (h.run && this.records.has(h.run)) return true
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
