import { isOpenComment, isPerson, type DocComment } from "@owlit/protocol"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { correctable, correctionOf, replySkill } from "./review.ts"
import { REPLY_RUN } from "./runs.ts"
import { randomUUID } from "node:crypto"

// Owlit's run on the user's docs that answers their reply under one of its comments. Nothing it writes is
// the user's: only Owlit's own comments (core checks).

export interface ReviewServices {
  workspace: () => Workspace | null
  // A background session for the task, with only these of owlit's tools beyond the read-only ones; runId
  // signs what it writes (docs_add_comment comes back to comment())
  agent: (prompt: string, ctx: TaskContext, tools: RegExp, runId: string) => Promise<{ text: string }>
  // Changes one of Owlit's comments, as the run's: it answered in it or rewrote its own first entry (new
  // entries are signed by core)
  put: (path: string, comment: DocComment, run: string) => Promise<void>
  now?: () => number
}

export class Reviews {
  private readonly services: ReviewServices

  constructor(services: ReviewServices) {
    this.services = services
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask(REPLY_RUN, { lane: replySkill.lane, retries: 1, run: (ctx) => this.reply(ctx) }),
    ]
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
