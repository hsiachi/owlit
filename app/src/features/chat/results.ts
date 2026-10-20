import { useEffect } from "react"
import { owlitOf, type Change } from "@owlit/protocol"
import { create } from "zustand"
import { me, WEB_ME } from "@/lib/actors"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { paperOfNotePath } from "@/features/library/notes/note-actions"
import { displayName } from "@/features/docs/types"

// Whether a change from a chat should still raise a toast: not while its chat is on screen, since the
// result row there already says it
export { chatOnScreen } from "./status"

// What a chat changed outside itself, as core's change log keeps it: every entry made for the chat or
// run (the chatId), and the undos of them, which carry it too. Read when a chat's card first shows, and
// again whenever core says a change of that chat was added; nothing is kept in the window.
const useChatLog = create<{ byChat: Record<string, Change[]> }>(() => ({ byChat: {} }))

const EMPTY: Change[] = []
const reloads = new Map<string, ReturnType<typeof setTimeout>>()
// The chats whose log was asked for, by the number of their latest read: a change heard while the first
// read is under way reads it again, and only the latest read's list is taken
const reads = new Map<string, number>()

async function load(chatId: string) {
  const mine = (reads.get(chatId) ?? 0) + 1
  reads.set(chatId, mine)
  const list = await rpc.changes.list({ chatId }).catch(() => null)
  if (list && reads.get(chatId) === mine) useChatLog.setState((s) => ({ byChat: { ...s.byChat, [chatId]: list } }))
}

// The chat's entries, newest first
export function useChatChanges(chatId: string): Change[] {
  const list = useChatLog((s) => s.byChat[chatId])
  useEffect(() => {
    if (isDesktop && !list) void load(chatId)
  }, [chatId, list])
  return list ?? EMPTY
}

if (isDesktop) {
  onNotify("changes.added", ({ change }) => {
    const chatId = change.origin.chatId
    if (!chatId || !reads.has(chatId)) return
    // One write can be many entries said once; a burst of them is read once
    clearTimeout(reloads.get(chatId))
    reloads.set(
      chatId,
      setTimeout(() => void load(chatId), 100),
    )
  })
}

// Without the desktop app there is no core keeping a change log: the mock agent adds its entries here,
// each with how to take it back, which answers with how to take that back in turn
type MockUndo = () => MockUndo | void
const mockUndo = new Map<string, MockUndo>()

export function addMockChange(change: Change, undo: MockUndo) {
  mockUndo.set(change.id, undo)
  const chatId = change.origin.chatId!
  useChatLog.setState((s) => ({ byChat: { ...s.byChat, [chatId]: [change, ...(s.byChat[chatId] ?? [])] } }))
}

// Takes one entry back (an undo is an entry too, so this is also the redo); the passages of a doc that
// were edited since and stay as they are
export async function undoEntry(change: Change): Promise<string[] | undefined> {
  if (isDesktop) return (await rpc.changes.undo({ id: change.id })).left
  const back = mockUndo.get(change.id)?.()
  if (!back) return undefined
  const undo: Change = { id: `mock-${crypto.randomUUID()}`, at: Date.now(), actor: me() ?? WEB_ME, action: "update", target: change.target, origin: { via: "editor", chatId: change.origin.chatId }, undoes: change.id }
  addMockChange(undo, () => {
    back()
    return mockUndo.get(change.id)
  })
  return undefined
}

// The mock agent's entry for a chat
export const mockEntry = (chatId: string, target: Change["target"], action: Change["action"] = "create"): Change => ({
  id: `mock-${crypto.randomUUID()}`,
  at: Date.now(),
  actor: owlitOf(me() ?? WEB_ME),
  action,
  target,
  origin: { via: "tool", chatId },
})

// A doc by its name; a paper's note by its paper ("Chen 2025")
export function labelOf(path: string) {
  const notePaper = paperOfNotePath(path)
  const paper = notePaper ? useLibraryStore.getState().papers[notePaper] : undefined
  return paper ? citationLabel(paper) : displayName(path)
}
