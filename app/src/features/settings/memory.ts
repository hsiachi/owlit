// Owlit's memory as Settings shows it: core's .owlit/memory.md, read when the dialog shows it and kept
// current by memory.changed (an agent in a chat, an Undo, another window).

import type { ClaudeNote, MemoryKind, MemoryLine } from "@owlit/protocol"
import { create } from "zustand"
import { onNotify, rpc } from "@/lib/rpc"
import { openSettings } from "./store"

interface MemoryState {
  lines: MemoryLine[]
  claudeNotes: ClaudeNote[]
  loaded: boolean
  // The list's dialog is open, above Settings
  managing: boolean
}

export const useMemory = create<MemoryState>()(() => ({ lines: [], claudeNotes: [], loaded: false, managing: false }))

// Opens the list above Settings › Owlit (a result row's line goes straight to it)
export function manageMemory(open: boolean) {
  if (open) openSettings("memory")
  useMemory.setState({ managing: open })
}

export async function loadMemory() {
  const { lines, claudeNotes } = await rpc.memory.list()
  useMemory.setState({ lines, claudeNotes, loaded: true })
}

// A line added, edited, put back, or moved: its project is where it is kept (none: every chat)
export async function putLine(line: { id?: string; kind: MemoryKind; text: string; at?: number; chatId?: string; project?: string }) {
  useMemory.setState({ lines: await rpc.memory.put(line) })
}

export async function removeLine(id: string) {
  useMemory.setState({ lines: await rpc.memory.remove({ id }) })
}

export async function decideClaudeNote(note: ClaudeNote, keep: boolean) {
  const lines = await rpc.memory.decideClaudeNotes(keep ? { keep: [note], drop: [] } : { keep: [], drop: [note.file] })
  useMemory.setState((s) => ({ lines, claudeNotes: s.claudeNotes.filter((n) => n.file !== note.file) }))
}

onNotify("memory.changed", ({ lines }) => useMemory.setState({ lines }))
