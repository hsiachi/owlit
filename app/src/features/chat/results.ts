import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { useChatStore } from "./store"
import { useSeenStore } from "./status"

// What a reply changed outside its chat: papers added, notes left on a doc, a file written. Core reports
// each change with its version (so it can be undone) and the chat it came from; the change is pinned to
// the reply that was running then, and shows under that answer as a result row. Knowledge changes are
// left out here: they already show from the reply's own tool calls (knowledge/components/ChatUpdates).
export type ResultKind = "paper" | "note" | "file"

export interface AgentResult {
  kind: ResultKind
  versionId: string
  // A paper's id, or a workspace-relative path
  path: string
  label: string
  at: number
  undone?: boolean
}

interface ResultsState {
  // By assistant message id
  byMessage: Record<string, AgentResult[]>
  add: (messageId: string, result: AgentResult) => void
  markUndone: (messageId: string, versionIds: string[]) => void
}

// Old replies drop out first; a result row is a confirmation, the version itself stays in core
const KEEP = 200

export const useResultsStore = create<ResultsState>()(
  persist(
    (set) => ({
      byMessage: {},
      add: (messageId, result) =>
        set((s) => {
          const list = s.byMessage[messageId] ?? []
          if (list.some((r) => r.versionId === result.versionId)) return s
          const byMessage = { ...s.byMessage, [messageId]: [...list, result] }
          const ids = Object.keys(byMessage)
          for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete byMessage[id]
          return { byMessage }
        }),
      markUndone: (messageId, versionIds) =>
        set((s) => ({
          byMessage: { ...s.byMessage, [messageId]: (s.byMessage[messageId] ?? []).map((r) => (versionIds.includes(r.versionId) ? { ...r, undone: true } : r)) },
        })),
    }),
    { name: "owlit.chat-results" },
  ),
)

// The reply running in a chat now, or its last one when the change lands just after it ended
function replyOf(chatId: string): string | undefined {
  const chat = useChatStore.getState().chats[chatId]
  if (!chat) return undefined
  return [...chat.messages].reverse().find((m) => m.role === "assistant")?.id
}

// Whether a change from this chat should still raise a toast: not while its chat is on screen, since the
// result row there already says it
export function chatOnScreen(chatId: string | undefined) {
  return !!chatId && !!useSeenStore.getState().viewing[chatId] && document.visibilityState === "visible"
}

// Without the desktop app there is no core keeping versions; the mock agent says how to take back what it did
const mockUndo = new Map<string, () => void>()
export const setMockUndo = (versionId: string, undo: () => void) => mockUndo.set(versionId, undo)

export async function undoResult(versionId: string) {
  if (isDesktop) {
    await rpc.versions.restore({ id: versionId })
    return
  }
  mockUndo.get(versionId)?.()
  mockUndo.delete(versionId)
}

// A doc by its name; a paper's note by its paper ("Chen 2025")
export function labelOf(path: string) {
  const notePaper = /^\.owlit\/papers\/([^/]+)\/note\.md$/.exec(path)?.[1]
  const paper = notePaper ? useLibraryStore.getState().papers[notePaper] : undefined
  return paper ? citationLabel(paper) : path.split("/").pop()!.replace(/\.md$/i, "")
}

export function recordResult(chatId: string | undefined, result: AgentResult) {
  if (!chatId) return
  const messageId = replyOf(chatId)
  if (messageId) useResultsStore.getState().add(messageId, result)
}

if (isDesktop) {
  onNotify("agent.changed", ({ kind, versionId, path, label, chatId }) => {
    if (kind === "knowledge") return
    recordResult(chatId, { kind, versionId, path, label, at: Date.now() })
  })
  onNotify("agent.wrote", ({ path, versionId, chatId }) => {
    recordResult(chatId, { kind: "file", versionId, path, label: labelOf(path), at: Date.now() })
  })
}
