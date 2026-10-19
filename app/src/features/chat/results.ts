import { isOwlit, type Change, type MemoryKind, type MemoryLine } from "@owlit/protocol"
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
// each change of its log (so it can be undone) with the chat it came from; the change is pinned to the
// reply that was running then, and shows under that answer as a result row.
export type ResultKind = "paper" | "note" | "file" | "thread" | "memory"

export interface AgentResult {
  kind: ResultKind
  changeId: string
  // A paper's id, or a workspace-relative path
  path: string
  label: string
  at: number
  // A paper the agent took back out of the library, or a line of memory it removed
  removed?: boolean
  // A line of memory: which kind, and whether it replaced one
  memory?: MemoryKind
  replaced?: boolean
  undone?: boolean
  // After an Undo from the card: the undo's own change, whose undo puts the change back
  redoId?: string
  // A thread: whether the write started it, the papers it added, the question it was for, and the
  // thread those papers went to when the user kept them separate
  created?: boolean
  rows?: string[]
  // Rows already there whose answers the write changed
  updated?: number
  asked?: string
  separate?: { id: string; title: string }
}

interface ResultsState {
  // By assistant message id
  byMessage: Record<string, AgentResult[]>
  add: (messageId: string, result: AgentResult) => void
  // Each undone change with what puts it back, when there is a way
  markUndone: (messageId: string, redoIds: Record<string, string | undefined>) => void
  markRedone: (messageId: string, changeIds: string[]) => void
  // null: the split was undone, the papers are back in the thread the reply wrote to
  markSeparate: (messageId: string, changeIds: string[], to: { id: string; title: string } | null) => void
}

// Old replies drop out first; a result row is a confirmation, the change itself stays in core
const KEEP = 200

export const useResultsStore = create<ResultsState>()(
  persist(
    (set) => ({
      byMessage: {},
      add: (messageId, result) =>
        set((s) => {
          const list = s.byMessage[messageId] ?? []
          if (list.some((r) => r.changeId === result.changeId)) return s
          const byMessage = { ...s.byMessage, [messageId]: [...list, result] }
          const ids = Object.keys(byMessage)
          for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete byMessage[id]
          return { byMessage }
        }),
      markUndone: (messageId, redoIds) =>
        set((s) => ({
          byMessage: {
            ...s.byMessage,
            [messageId]: (s.byMessage[messageId] ?? []).map((r) => (r.changeId in redoIds ? { ...r, undone: true, redoId: redoIds[r.changeId] } : r)),
          },
        })),
      markSeparate: (messageId, changeIds, to) =>
        set((s) => ({
          byMessage: {
            ...s.byMessage,
            [messageId]: (s.byMessage[messageId] ?? []).map((r) => (changeIds.includes(r.changeId) ? { ...r, separate: to ?? undefined } : r)),
          },
        })),
      markRedone: (messageId, changeIds) =>
        set((s) => ({
          byMessage: {
            ...s.byMessage,
            [messageId]: (s.byMessage[messageId] ?? []).map((r) => (changeIds.includes(r.changeId) ? { ...r, undone: false, redoId: undefined } : r)),
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

// Without the desktop app there is no core keeping a change log; the mock agent says how to take back what it
// did, and its undo hands back how to put it back again
type MockUndo = () => (() => void) | void
const mockUndo = new Map<string, MockUndo>()
const mockRedo = new Map<string, () => void>()
export const setMockUndo = (changeId: string, undo: MockUndo) => mockUndo.set(changeId, undo)

// Takes a change back; returns what puts it back again, when there is a way. A change undone and redone
// is undone again by its own id: core's undo only asks that the file reads as the change left it.
export async function undoResult(changeId: string): Promise<string | undefined> {
  if (isDesktop) return (await rpc.changes.undo({ id: changeId })).change.id
  const redo = mockUndo.get(changeId)?.()
  if (!redo) return undefined
  const redoId = `mock-redo-${crypto.randomUUID()}`
  mockRedo.set(redoId, redo)
  return redoId
}

// Puts back a change an Undo from the result card took back, the same way the Undo was made
export async function redoResult(redoId: string) {
  if (isDesktop) {
    await rpc.changes.undo({ id: redoId })
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

const KINDS: Record<Change["target"]["kind"], ResultKind> = { doc: "file", comment: "note", paper: "paper", thread: "thread", memory: "memory" }

if (isDesktop) {
  onNotify("changes.added", ({ change, label, thread }) => {
    // Owlit's changes only; an undo is the person's
    if (!isOwlit(change.actor) || change.undoes) return
    const { target, action } = change
    const kind = KINDS[target.kind]
    const line = (change.after ?? change.before) as MemoryLine | undefined
    recordResult(change.origin.chatId, {
      kind,
      changeId: change.id,
      path: target.part && kind === "memory" ? target.part : target.path,
      label: kind === "file" ? labelOf(target.path) : (label ?? target.path),
      at: Date.now(),
      ...(action === "delete" && (kind === "paper" || kind === "memory") ? { removed: true } : {}),
      ...(kind === "thread" ? { created: action === "create", rows: thread?.rows ?? [], updated: thread?.updated ?? 0, ...(thread?.asked ? { asked: thread.asked } : {}) } : {}),
      ...(kind === "memory" ? { memory: line?.kind ?? "work", ...(action === "update" ? { replaced: true } : {}) } : {}),
    })
  })
}
