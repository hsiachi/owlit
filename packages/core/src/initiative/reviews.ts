import { isMarkdown, isOpenComment, isPerson, parentPath, type DocComment, type DocOwlit } from "@owlit/protocol"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { correctable, correctionOf, replySkill } from "./review.ts"
import { COMMENTING_RUNS, GO_THROUGH_RUN, REPLY_RUN } from "./runs.ts"
import { cleanReading, goThroughSkill, isChinese, MEETINGS, recordOf } from "./go-through.ts"
import { randomUUID } from "node:crypto"

// Owlit's runs on the user's docs, each one the user started: the task that answers their reply under one
// of its comments, and the one that goes through material against the docs, and where what they make
// lands. Nothing a run writes is the user's: only Owlit's own comments (core checks). A comment lands as
// soon as it is made; the change log marks it unseen until the user looks.

export interface ReviewServices {
  workspace: () => Workspace | null
  // A background session for the task, with only these of owlit's tools beyond the read-only ones; runId
  // signs what it writes (docs_add_comment comes back to comment())
  agent: (prompt: string, ctx: TaskContext, tools: RegExp, runId: string) => Promise<{ text: string }>
  // Writes one of Owlit's comments to the doc, as the run's (run: "<kind>:<task id>")
  write: (path: string, comment: DocComment, run: string) => Promise<void>
  // Owlit went through a doc (the chip's line)
  looked: (path: string, state: DocOwlit) => void
  // Writes a new doc of Owlit's (a Go through's record), as an agent's write for the run: recorded in the
  // change log, so the run offers Undo
  writeRecord: (path: string, content: string, run: string) => Promise<void>
  // Changes one of Owlit's comments, as the run's: it answered in it or rewrote its own first entry (new
  // entries are signed by core)
  put: (path: string, comment: DocComment, run: string) => Promise<void>
  now?: () => number
  // The user's name, when they gave one (a Go through writes their own words as "you")
  userName?: () => Promise<string | undefined>
}

// A Go through's comment, waiting for the record it points back to
interface Waiting {
  path: string
  comment: DocComment
  // The run that made it, "<kind>:<task id>"
  run: string
}

const taskOf = (runId: string) => runId.slice(runId.indexOf(":") + 1)
const kindOf = (runId: string) => runId.slice(0, runId.indexOf(":"))

export const isCommentingRun = (runId: string | undefined) => !!runId && (COMMENTING_RUNS as readonly string[]).includes(kindOf(runId))

export class Reviews {
  private readonly services: ReviewServices
  private waiting: Waiting[] = []
  // The record each Go through run is writing, while it hasn't been written
  private records = new Map<string, { path: string; label: string }>()

  constructor(services: ReviewServices) {
    this.services = services
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask(REPLY_RUN, { lane: replySkill.lane, retries: 1, run: (ctx) => this.reply(ctx) }),
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
      await this.services.writeRecord(record, recordOf(reading, rel, chinese), runId)
      this.services.looked(rel, await ws.docs.setWentThrough(rel, { at: this.now(), record }))
    } finally {
      this.records.delete(runId)
      // Its points land once the record is there; a run that stopped before it leaves them nothing to
      // point back to
      const mine = this.waiting.filter((w) => w.run === runId)
      this.waiting = this.waiting.filter((w) => w.run !== runId)
      if (await ws.docs.readDisk(record)) await this.landAll(ws, mine)
    }
  }

  // A comment a run made through docs_add_comment: written now, or, for a Go through, once its record is
  async comment(runId: string, path: string, comment: DocComment) {
    const ws = this.services.workspace()
    const chatId = ws?.tasks.get(taskOf(runId))?.chatId
    // A Go through's comments carry over what people said, from the record it is writing
    const source = this.records.get(runId)
    const signed = { ...comment, ...(source ? { source } : {}), entries: comment.entries.map((e) => ({ ...e, ...(chatId ? { chatId } : {}) })) }
    if (source) this.waiting.push({ path, comment: signed, run: runId })
    else await this.services.write(path, signed, runId)
  }

  // The workspace is closing, its tasks already stopped: a Go through's points still waiting never got
  // their record
  stop() {
    this.waiting = []
    this.records.clear()
  }

  // Written if the words each is about are still there; never into another workspace's doc at the same path
  private async landAll(ws: Workspace, ready: Waiting[]) {
    for (const w of ready) {
      const content = await ws.docs.read(w.path).then((r) => r.content, () => null)
      if (this.services.workspace() !== ws) return
      if (content === null || !content.includes(w.comment.quote)) continue
      await this.services.write(w.path, w.comment, w.run).catch((error) => console.error("[core] couldn't land Owlit's comment", error))
    }
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
    const last = comment?.entries.at(-1)
    if (!comment || !isOpenComment(comment) || !last || !isPerson(last.by)) return
    const { content } = await ws.docs.read(rel)
    const { text } = await this.services.agent(replySkill.instructions({ path: rel, content, comment }), ctx, replySkill.tools!, `${REPLY_RUN}:${ctx.task.id}`)
    const answer = text.trim()
    if (!answer) throw new Error("Owlit had nothing to say.")
    // As it is now: the user may have written meanwhile
    const now = await find()
    if (!now || !isOpenComment(now)) return
    const chatId = ws.tasks.get(ctx.task.id)?.chatId
    // Shown wrong, Owlit says the right thing in its comment rather than under it; the replies stay
    const fixed = correctionOf(answer)
    const by = await ws.recorder.actorOf({ kind: "owlit" })
    const replied: DocComment =
      fixed && correctable(now)
        ? corrected(now, fixed, this.now())
        : { ...now, entries: [...now.entries, { id: randomUUID(), by, text: answer, at: this.now(), ...(chatId ? { chatId } : {}) }] }
    await this.services.put(rel, replied, `${REPLY_RUN}:${ctx.task.id}`)
  }
}

// Owlit's comment with its first entry rewritten: the old words kept as was, marked edited, which also
// makes the comment new to the user again (the doc's Owlit dot)
function corrected(comment: DocComment, text: string, at: number): DocComment {
  const [first, ...rest] = comment.entries
  if (!first || first.text === text) return comment
  return { ...comment, entries: [{ ...first, text, was: first.was ?? first.text, editedAt: at }, ...rest] }
}

// "<path>#<comment id>"
function commentSubject(subject: string) {
  const cut = subject.lastIndexOf("#")
  return { rel: subject.slice(0, cut), id: subject.slice(cut + 1) }
}
