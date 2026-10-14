import type { ReadStatus } from "./library.ts"

// What the user does in the interface, as the renderer reports it to core. It feeds the workspace
// journal (Knowledge reads its delta from there, core's reading.ts what was read) and, later, a live
// agent that follows along. Every event carries the time it happened, in ms since the epoch.

// Which side of a paper's page was in view: Owlit's digest or the paper itself
export type PaperView = "digest" | "pdf"

// A change the user made to a paper's star, status or tags (the whole new set)
export type PaperMark = { what: "starred"; to: boolean } | { what: "status"; to: ReadStatus } | { what: "tags"; to: string[] }

export type ActivityEvent =
  | { kind: "paper.opened"; at: number; paperId: string }
  | { kind: "paper.closed"; at: number; paperId: string }
  // 1-based page that came to the top while reading
  | { kind: "paper.page"; at: number; paperId: string; page: number }
  // Time on the paper's page with the window in front and the person not away, settled every 30
  // seconds of it and when they leave the paper, the view or the window
  | { kind: "paper.focus"; at: number; paperId: string; view: PaperView; seconds: number }
  // Time a page of the PDF spent at the top, once that stay reached 5 seconds; a long stay comes in
  // parts, settled with paper.focus
  | { kind: "paper.dwell"; at: number; paperId: string; page: number; seconds: number }
  | { kind: "paper.marked"; at: number; paperId: string; mark: PaperMark }
  | { kind: "highlight.added"; at: number; paperId: string; highlightId: string }
  | { kind: "highlight.removed"; at: number; paperId: string; highlightId: string }
  // The paper's own note, once typing has paused
  | { kind: "note.edited"; at: number; paperId: string }
  | { kind: "doc.opened"; at: number; path: string }
  | { kind: "doc.closed"; at: number; path: string }
  // Typed by the user (not an agent's edit), once typing has paused; workspace-relative path
  | { kind: "doc.edited"; at: number; path: string }
  | { kind: "chat.sent"; at: number; chatId: string }
  // The user left a chat they had written in
  | { kind: "chat.ended"; at: number; chatId: string }
  // id is the sentence's block id (^s1) in the topic file
  | { kind: "knowledge.edited"; at: number; topic: string; id: string }
  // The window has been in the background this long
  | { kind: "idle"; at: number; seconds: number }

export type ActivityKind = ActivityEvent["kind"]

export type ActivityOf<K extends ActivityKind> = Extract<ActivityEvent, { kind: K }>

// What goes into .owlit/journal.jsonl. The rest (page turns, idle, closing a doc, removing a highlight,
// sending a message) is only for live listeners.
export const JOURNALED_KINDS = [
  "paper.opened",
  "paper.focus",
  "paper.dwell",
  "paper.marked",
  "doc.opened",
  "doc.edited",
  "chat.ended",
  "highlight.added",
  "note.edited",
  "knowledge.edited",
  "paper.closed",
] as const satisfies readonly ActivityKind[]

// What core records about agents itself; never reported by a window
export type AgentRecord = { kind: "agent.wrote"; at: number; path: string; versionId: string; chatId?: string }

// A line of .owlit/journal.jsonl: who did what, when
export type JournalEntry = (ActivityEvent & { actor: "user" }) | (AgentRecord & { actor: "agent" })
