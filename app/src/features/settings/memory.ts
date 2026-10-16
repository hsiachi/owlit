// Owlit's memory as Settings shows it: core's .owlit/memory.md, read when the dialog shows it and kept
// current by memory.changed (an agent in a chat, an Undo, another window). Without the desktop app there
// is no core, so dev:web keeps a list in this tab to try the rows.

import type { ClaudeNote, MemoryKind, MemoryLine } from "@owlit/protocol"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
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
  if (!isDesktop) return useMemory.setState({ loaded: true })
  const { lines, claudeNotes } = await rpc.memory.list()
  useMemory.setState({ lines, claudeNotes, loaded: true })
}

let mockId = 0
const mockPut = (line: { id?: string; kind: MemoryKind; text: string; at?: number }) => {
  const lines = useMemory.getState().lines
  const kept: MemoryLine = { at: Date.now(), ...line, id: line.id ?? `m${++mockId + lines.length}` }
  return lines.some((l) => l.id === kept.id) ? lines.map((l) => (l.id === kept.id ? kept : l)) : [...lines, kept]
}

export async function putLine(line: { id?: string; kind: MemoryKind; text: string; at?: number; chatId?: string }) {
  useMemory.setState({ lines: isDesktop ? await rpc.memory.put(line) : mockPut(line) })
}

export async function removeLine(id: string) {
  useMemory.setState({ lines: isDesktop ? await rpc.memory.remove({ id }) : useMemory.getState().lines.filter((l) => l.id !== id) })
}

export async function decideClaudeNote(note: ClaudeNote, keep: boolean) {
  const lines = isDesktop ? await rpc.memory.decideClaudeNotes(keep ? { keep: [note], drop: [] } : { keep: [], drop: [note.file] }) : useMemory.getState().lines
  useMemory.setState((s) => ({ lines, claudeNotes: s.claudeNotes.filter((n) => n.file !== note.file) }))
}

if (isDesktop) onNotify("memory.changed", ({ lines }) => useMemory.setState({ lines }))
