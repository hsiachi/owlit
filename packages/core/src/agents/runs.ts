import { t } from "@lingui/core/macro"
import { applyUpdate, threadOfSubject, type Chat, type ChatMessage, type SessionUpdate, type Task } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import type { Chats } from "../chats/chats.ts"
import type { Workspace } from "../workspace/workspace.ts"

// A scheduler task's agent run (a thread's work, Go through, a reply under Owlit's comment) has a body: a
// session (a chat that no chat list shows) holding why it started, its steps and its result. A retry of
// the same task adds to the same session. A digest is a chat owlit starts instead (chats.ts startFor).

export interface RunWords {
  // The session's title: what the run does, by name
  title: string
  // Why it started, as the session's first message
  why: string
}

export interface RunSession {
  chatId: string
  update(update: SessionUpdate): void
  finish(outcome: { status: "done" | "cancelled" | "error"; error?: string; errorDetail?: string; connectorId?: string; model?: string }): Promise<void>
}

// The session of a task's run: the one the task already has (a retry), or a new one
export async function openRun(
  chats: Chats,
  task: Task,
  words: RunWords,
  // Told when the session starts and when it ends
  changed: (chat: Chat) => void,
): Promise<RunSession> {
  const now = Date.now()
  const existing = task.chatId ? await chats.get(task.chatId).catch(() => null) : null
  const chatId = existing?.id ?? randomUUID()
  if (!existing) {
    await chats.create({ id: chatId, title: words.title, createdAt: now, updatedAt: now, pinned: false, startedBy: "owlit", run: { taskId: task.id, kind: task.kind, subject: task.subject } })
    await chats.appendMessage(chatId, { id: randomUUID(), role: "user", parts: [{ type: "text", text: words.why }], createdAt: now })
  } else {
    await chats.update(chatId, { updatedAt: now })
  }
  let message: ChatMessage = { id: randomUUID(), role: "assistant", parts: [], createdAt: now, status: "streaming" }
  await chats.appendMessage(chatId, message)
  changed(await chats.get(chatId))
  return {
    chatId,
    update(update) {
      message = { ...message, parts: applyUpdate(message.parts, update) }
      void chats.patchMessage(chatId, message).catch(() => undefined)
    },
    async finish({ status, error, errorDetail, connectorId, model }) {
      message = { ...message, status, finishedAt: Date.now(), ...(error ? { error } : {}), ...(errorDetail ? { errorDetail } : {}), ...(connectorId ? { connectorId } : {}), ...(model ? { modelId: model } : {}) }
      await chats.patchMessage(chatId, message, true)
      await chats.update(chatId, { updatedAt: Date.now() })
      changed(await chats.get(chatId))
    },
  }
}

// A doc as the app names it: its file name without .md
const docName = (rel: string) => (rel.split("/").pop() ?? rel).replace(/\.md$/i, "")

// The words of a run, from its task: what it is about, by name, and what the user asked
export async function runWords(ws: Workspace, task: Task): Promise<RunWords> {
  if (task.kind === "docs.reply") {
    const name = docName(task.subject.slice(0, task.subject.lastIndexOf("#")))
    return { title: t`Answered your reply in “${name}”`, why: t`You replied to Owlit's comment in “${name}”.` }
  }
  if (task.kind.startsWith("threads.")) {
    const thread = await ws.threads.get(threadOfSubject(task.subject)).catch(() => undefined)
    const title = thread?.title ?? t`a thread`
    switch (task.kind) {
      case "threads.gather":
        return { title: t`Gathered papers for “${title}”`, why: t`You asked Owlit to gather papers: “${thread?.asked.text ?? title}”.` }
      case "threads.more":
        return { title: t`Looked for more papers for “${title}”`, why: t`You asked for more papers in “${title}”.` }
      case "threads.fill": {
        const question = thread?.columns.find((c) => c.id === task.subject.split(":")[1])?.question ?? ""
        return { title: t`Answered “${question}” in “${title}”`, why: t`You asked “${question}” of each paper in “${title}”.` }
      }
      case "threads.read":
        return { title: t`Read the papers in “${title}”`, why: t`You asked Owlit to read the papers in “${title}”.` }
    }
  }
  return { title: t`Background work`, why: t`You asked Owlit for this.` }
}
