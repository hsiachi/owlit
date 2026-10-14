import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { paperOfNotePath } from "@/features/library/notes/note-actions"
import { displayName } from "@/features/docs/types"
import { useChatStore } from "./store"

// Whether a change from a chat should still raise a toast: not while its chat is on screen, since the
// result row there already says it
export { chatOnScreen } from "./status"

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
  // A paper the agent took back out of the library
  removed?: boolean
  undone?: boolean
  // After an Undo from the card: what puts the change back (core keeps the undo as a version too)
  redoId?: string
}

interface ResultsState {
  // By assistant message id
  byMessage: Record<string, AgentResult[]>
  add: (messageId: string, result: AgentResult) => void
  // Each undone change with what puts it back, when there is a way
  markUndone: (messageId: string, redoIds: Record<string, string | undefined>) => void
  markRedone: (messageId: string, versionIds: string[]) => void
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
      markUndone: (messageId, redoIds) =>
        set((s) => ({
          byMessage: {
            ...s.byMessage,
            [messageId]: (s.byMessage[messageId] ?? []).map((r) => (r.versionId in redoIds ? { ...r, undone: true, redoId: redoIds[r.versionId] } : r)),
          },
        })),
      markRedone: (messageId, versionIds) =>
        set((s) => ({
          byMessage: {
            ...s.byMessage,
            [messageId]: (s.byMessage[messageId] ?? []).map((r) => (versionIds.includes(r.versionId) ? { ...r, undone: false, redoId: undefined } : r)),
          },
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

// Without the desktop app there is no core keeping versions; the mock agent says how to take back what it
// did, and its undo hands back how to put it back again
type MockUndo = () => (() => void) | void
const mockUndo = new Map<string, MockUndo>()
const mockRedo = new Map<string, () => void>()
export const setMockUndo = (versionId: string, undo: MockUndo) => mockUndo.set(versionId, undo)

// Takes a change back; returns what puts it back again, when there is a way. A change undone and redone
// is undone again by its own version: core's restore only asks that the file reads as the change left it.
export async function undoResult(versionId: string): Promise<string | undefined> {
  if (isDesktop) return (await rpc.versions.restore({ id: versionId })).redoId
  const redo = mockUndo.get(versionId)?.()
  if (!redo) return undefined
  const redoId = `mock-redo-${crypto.randomUUID()}`
  mockRedo.set(redoId, redo)
  return redoId
}

// Puts back a change an Undo from the result card took back, the same way the Undo was made
export async function redoResult(redoId: string) {
  if (isDesktop) {
    await rpc.versions.restore({ id: redoId })
    return
  }
  mockRedo.get(redoId)?.()
  mockRedo.delete(redoId)
}

// A doc by its name; a paper's note by its paper ("Chen 2025")
export function labelOf(path: string) {
  const notePaper = paperOfNotePath(path)
  const paper = notePaper ? useLibraryStore.getState().papers[notePaper] : undefined
  return paper ? citationLabel(paper) : displayName(path)
}

export function recordResult(chatId: string | undefined, result: AgentResult) {
  if (!chatId) return
  const messageId = replyOf(chatId)
  if (messageId) useResultsStore.getState().add(messageId, result)
}

if (isDesktop) {
  onNotify("agent.changed", ({ kind, op, versionId, path, label, chatId }) => {
    // A collection isn't a result row yet: it is said in a toast (agent-changes)
    if (kind === "knowledge" || kind === "collection") return
    recordResult(chatId, { kind, versionId, path, label, at: Date.now(), ...(op === "removed" ? { removed: true } : {}) })
  })
  onNotify("agent.wrote", ({ path, versionId, chatId }) => {
    recordResult(chatId, { kind: "file", versionId, path, label: labelOf(path), at: Date.now() })
  })
}
