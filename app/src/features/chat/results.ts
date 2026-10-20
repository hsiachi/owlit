import { useEffect } from "react"
import type { Change } from "@owlit/protocol"
import { create } from "zustand"
import { onNotify, rpc } from "@/lib/rpc"
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
    if (!list) void load(chatId)
  }, [chatId, list])
  return list ?? EMPTY
}

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

// Takes one entry back (an undo is an entry too, so this is also the redo); the passages of a doc that
// were edited since and stay as they are
export const undoEntry = async (change: Change): Promise<string[] | undefined> => (await rpc.changes.undo({ id: change.id })).left

// A doc by its name; a paper's note by its paper ("Chen 2025")
export function labelOf(path: string) {
  const notePaper = paperOfNotePath(path)
  const paper = notePaper ? useLibraryStore.getState().papers[notePaper] : undefined
  return paper ? citationLabel(paper) : displayName(path)
}
