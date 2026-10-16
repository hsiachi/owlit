import { t } from "@lingui/core/macro"
import { applyUpdate, mentionLink, paperUri, threadOfSubject, type Chat, type ChatMessage, type SessionUpdate, type Task } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import type { Chats } from "../chats/chats.ts"
import type { Workspace } from "../workspace/workspace.ts"

// Every piece of Owlit's background work is a run with a body: a session (a chat that no chat list
// shows) holding why it started, its steps and its result, which the window opens from the row it
// works on. A retry of the same task adds to the same session.

export interface RunWords {
  // What it is doing, in Owlit's voice: beside the subject and on the rail while the task is open
  doing: string
  // The session's title once it has finished
  done: string
  // Why it started, as the session's first message
  why: string
  // Said in place of the agent's answer once it is done, when the answer itself lives elsewhere (a
  // digest is the paper's, not a message)
  result?: string
}

export interface RunSession {
  chatId: string
  update(update: SessionUpdate): void
  finish(outcome: { status: "done" | "cancelled" | "error"; error?: string; connectorId?: string; model?: string }): Promise<void>
}

// The session of a task's run: the one the task already has (a retry), or a new one
export async function openRun(
  chats: Chats,
  task: Task,
  words: RunWords,
  notify: { update: (chatId: string, messageId: string, update: SessionUpdate) => void; created: (chat: Chat) => void },
): Promise<RunSession> {
  const now = Date.now()
  const existing = task.chatId ? await chats.get(task.chatId).catch(() => null) : null
  const chatId = existing?.id ?? randomUUID()
  if (!existing) {
    await chats.create({ id: chatId, title: words.doing, createdAt: now, updatedAt: now, pinned: false, startedBy: "owlit", run: { taskId: task.id, kind: task.kind, subject: task.subject } })
    await chats.appendMessage(chatId, { id: randomUUID(), role: "user", parts: [{ type: "text", text: words.why }], createdAt: now })
  } else {
    await chats.update(chatId, { title: words.doing, updatedAt: now })
  }
  let message: ChatMessage = { id: randomUUID(), role: "assistant", parts: [], createdAt: now, status: "streaming" }
  await chats.appendMessage(chatId, message)
  notify.created(await chats.get(chatId))
  return {
    chatId,
    update(update) {
      message = { ...message, parts: applyUpdate(message.parts, update) }
      void chats.patchMessage(chatId, message).catch(() => undefined)
      notify.update(chatId, message.id, update)
    },
    async finish({ status, error, connectorId, model }) {
      // Steps stay; the answer, when it lives elsewhere, is said in a line
      const parts = status === "done" && words.result ? [...message.parts.filter((p) => p.type !== "text"), { type: "text" as const, text: words.result }] : message.parts
      message = { ...message, parts, status, finishedAt: Date.now(), ...(error ? { error } : {}), ...(connectorId ? { connectorId } : {}), ...(model ? { modelId: model } : {}) }
      await chats.patchMessage(chatId, message, true)
      await chats.update(chatId, { title: status === "done" ? words.done : words.doing, updatedAt: Date.now() })
      notify.created(await chats.get(chatId))
    },
  }
}

// The words of a run, from its task: what it is about, by name, and who started it
export async function runWords(ws: Workspace, task: Task): Promise<RunWords> {
  if (task.kind === "paper.digest") {
    const title = (await ws.library.get(task.subject).catch(() => undefined))?.title ?? task.subject
    const why =
      task.priority === "waiting"
        ? t`You opened “${title}”, which has no digest yet.`
        : task.priority === "asked"
          ? t`You asked for a digest of “${title}”.`
          : t`“${title}” has no digest yet.`
    return { doing: t`Writing the digest of “${title}”`, done: t`Digest of “${title}”`, why, result: `${t`The digest is written:`} ${mentionLink(title, paperUri(task.subject))}` }
  }
  if (task.kind.startsWith("threads.")) {
    const thread = await ws.threads.get(threadOfSubject(task.subject)).catch(() => undefined)
    const title = thread?.title ?? t`a thread`
    const asked = task.priority !== "background"
    switch (task.kind) {
      case "threads.gather":
        return { doing: t`Gathering papers for “${title}”`, done: t`Gathered papers for “${title}”`, why: t`You asked Owlit to gather papers: “${thread?.asked.text ?? title}”.` }
      case "threads.more":
        return { doing: t`Looking for more papers for “${title}”`, done: t`Looked for more papers for “${title}”`, why: t`You asked for more papers in “${title}”.` }
      case "threads.fill": {
        const question = thread?.columns.find((c) => c.id === task.subject.split(":")[1])?.question ?? ""
        return { doing: t`Answering “${question}” for the papers in “${title}”`, done: t`Answered “${question}” in “${title}”`, why: t`You asked “${question}” of each paper in “${title}”.` }
      }
      case "threads.read":
        return { doing: t`Reading the papers in “${title}”`, done: t`Read the papers in “${title}”`, why: t`You asked Owlit to read the papers in “${title}”.` }
      case "threads.check":
        return {
          doing: t`Checking “${title}” for new papers`,
          done: t`Checked “${title}” for new papers`,
          why: asked ? t`You asked Owlit to check “${title}” for new papers.` : t`You asked Owlit to watch “${title}”, and a day has passed since it last looked.`,
        }
    }
  }
  return { doing: t`Working in the background`, done: t`Background work`, why: t`Owlit started this on its own.` }
}
