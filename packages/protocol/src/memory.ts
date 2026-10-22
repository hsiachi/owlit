// Owlit's memory: a short list of what it keeps in mind about the user, one per workspace, in
// .owlit/memory.md. Every agent owlit runs hears it; the agents' own memories are kept off.

// work: how the user wants Owlit to work ("cite as (Author, Year)"); about: a fact about their work that
// has no other home ("I own P5 in the Infera project")
export type MemoryKind = "work" | "about"

export interface MemoryLine {
  // m1, m2…: what memory_write and Undo name a line by
  id: string
  kind: MemoryKind
  text: string
  // When it was kept or last changed (ms)
  at: number
  // The chat it came from
  chatId?: string
  // The project it is kept for, as its marked folder's path (Project.path): heard in full in the chats
  // of that project and of the projects inside it. Absent: the workspace's, heard in every chat. A work
  // line never has one.
  project?: string
}

// Where an agent keeps an about line (memory_write's scope): for the chat's project, or the workspace
export type MemoryScope = "project" | "workspace"

// A note Claude Code kept for this folder before owlit had a memory of its own, offered once to copy in
export interface ClaudeNote {
  // Its file name in Claude Code's memory folder, which is how it is kept or dropped
  file: string
  kind: MemoryKind
  text: string
}

// The list's size: past this Owlit merges or replaces lines rather than adding more
export const MEMORY_MAX_LINES = 40
export const MEMORY_MAX_CHARS = 300
