// Owlit's own runs: the sessions of its background work (a reading note, a watched thread's check),
// kept apart from your chats so no chat list, unread mark or notification counts them. A run opens in the
// Owlit panel from what it works on; while it works, its steps stream here as chat.update.

import { applyUpdate, isTaskFinished, type Chat, type Task } from "@owlit/protocol"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { cancelTask, useTasksStore } from "@/features/tasks/store"

interface RunsState {
  // By chat id, the runs this window has opened or heard of
  runs: Record<string, Chat>
}

export const useRunsStore = create<RunsState>(() => ({ runs: {} }))

const put = (chat: Chat) => useRunsStore.setState((s) => ({ runs: { ...s.runs, [chat.id]: chat } }))

// A run the window hasn't heard of since it opened, read from core so the panel can show it
export async function loadRun(chatId: string) {
  if (useRunsStore.getState().runs[chatId]) return
  const chat = await rpc.chats.get({ id: chatId }).catch(() => null)
  if (chat?.startedBy) put(chat)
}

// Whether a chat id is one of Owlit's runs, as far as this window knows
export const isRun = (chatId: string | null | undefined) => !!chatId && !!useRunsStore.getState().runs[chatId]

// Stops a run: its task is cancelled, and core ends the session
export function stopRun(chat: Chat) {
  if (chat.run) void cancelTask(chat.run.taskId).catch(() => undefined)
}

// Owlit's agent runs at work or waiting their turn, the one at work first, then oldest: what the rail's
// ring stands for. One waiting on the user isn't working; it has its own amber.
export function workingRuns(byId: Record<string, Task>): Task[] {
  return Object.values(byId)
    .filter((t) => t.lane === "agent" && !isTaskFinished(t) && (t.state === "running" || t.state === "queued"))
    .sort((a, b) => (a.state === b.state ? a.createdAt - b.createdAt : a.state === "running" ? -1 : 1))
}

export const useWorkingRuns = () => useTasksStore(useShallow((s) => workingRuns(s.byId)))

if (isDesktop) {
  onNotify("chats.run", ({ chat }) => put(chat))
  onNotify("chat.update", ({ chatId, messageId, update }) => {
    const chat = useRunsStore.getState().runs[chatId]
    if (!chat) return
    put({ ...chat, messages: chat.messages.map((m) => (m.id === messageId ? { ...m, parts: applyUpdate(m.parts, update) } : m)) })
  })
  onWorkspaceOpened(() => useRunsStore.setState({ runs: {} }))
}
