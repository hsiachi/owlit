import type { ActorId, PersonId } from "./changes.ts"
import type { ReadStatus } from "./library.ts"

// What the user does in the interface, as the renderer reports it to core. It feeds the workspace
// journal (core's reading.ts reads what was read from there). Every event carries the time it happened, in ms
// since the epoch.

// Which side of a paper's page was in view: Owlit's digest or the paper itself
export type PaperView = "digest" | "pdf"

// A change the user made to a paper's star, status or tags (the whole new set)
export type PaperMark = { what: "starred"; to: boolean } | { what: "status"; to: ReadStatus } | { what: "tags"; to: string[] }

export type ActivityEvent =
  | { kind: "paper.opened"; at: number; paperId: string }
  | { kind: "paper.closed"; at: number; paperId: string }
  // Time on the paper's page with the window in front and the person not away, settled every 30
  // seconds of it and when they leave the paper, the view or the window
  | { kind: "paper.focus"; at: number; paperId: string; view: PaperView; seconds: number }
  // Time a page of the PDF spent at the top, once that stay reached 5 seconds; a long stay comes in
  // parts, settled with paper.focus
  | { kind: "paper.dwell"; at: number; paperId: string; page: number; seconds: number }
  // The view was scrolled to its end (the digest's last lines came into view)
  | { kind: "paper.end"; at: number; paperId: string; view: PaperView }
  | { kind: "paper.marked"; at: number; paperId: string; mark: PaperMark }
  | { kind: "highlight.added"; at: number; paperId: string; highlightId: string }
  | { kind: "highlight.removed"; at: number; paperId: string; highlightId: string }
  // The paper's own note, once typing has paused
  | { kind: "note.edited"; at: number; paperId: string }
  | { kind: "doc.opened"; at: number; path: string }
  // Typed by the user (not an agent's edit), once typing has paused; workspace-relative path
  | { kind: "doc.edited"; at: number; path: string }
  // The user left a chat they had written in
  | { kind: "chat.ended"; at: number; chatId: string }

export type ActivityKind = ActivityEvent["kind"]

export type ActivityOf<K extends ActivityKind> = Extract<ActivityEvent, { kind: K }>

// What goes into .owlit/journal.jsonl: every kind, since a kind nobody reads back isn't sent at all
export const JOURNALED_KINDS = [
  "paper.opened",
  "paper.focus",
  "paper.dwell",
  "paper.end",
  "paper.marked",
  "doc.opened",
  "doc.edited",
  "chat.ended",
  "highlight.added",
  "highlight.removed",
  "note.edited",
  "paper.closed",
] as const satisfies readonly ActivityKind[]

// A line of .owlit/journal.jsonl: what the person did, when. Older journals also hold lines of other
// kinds, some signed by the person's Owlit: whoever reads the journal skips a kind it doesn't know.
export type JournalEntry = ActivityEvent & { actor: PersonId }

// ---- What an agent may ask about the user's activity (activity.query, owlit-mcp's activity_read) ----
// Facts, never scores: how long, which pages, how often. Single actions aren't interpreted.

export type ActivityQuery =
  // What the user touched lately, newest first
  | { mode: "recent"; since?: number; limit?: number }
  // What the user spent the most on in a stretch of time
  | { mode: "top"; since?: number; limit?: number }
  // The history of one paper, doc or chat
  | { mode: "of"; paper?: string; doc?: string; chat?: string }
  // What happened, in order: a visit to a paper is one line. actor is activity_read's word, not an id
  | { mode: "log"; since?: number; until?: number; actor?: "user" | "agent"; limit?: number }

export interface PaperActivity {
  kind: "paper"
  id: string
  title: string
  first: number
  last: number
  visits: number
  pdfSeconds: number
  digestSeconds: number
  // Pages that stayed at the top, by 1-based page, in seconds
  pages: Record<number, number>
  highlights: number
  noted: boolean
  // The latest of each, when the user set it in this stretch
  starred?: boolean
  status?: ReadStatus
  tags?: string[]
  // From the whole history, not only this stretch
  trace: ReadTrace
}

// How far the user got with a paper: read (its status is Read: core sets it when they reach the end, or
// they set it), looked at (opened here, not to the end), or none (never opened in owlit). The time and
// pages are the whole journal's.
export interface ReadTrace {
  state: "read" | "looked" | "none"
  pdfSeconds: number
  digestSeconds: number
  // 1-based pages of the PDF that stayed at the top
  pages: number[]
}

export interface DocActivity {
  kind: "doc"
  path: string
  first: number
  last: number
  opens: number
  // Pauses in the user's typing, each one edit
  edits: number
  // Changes an agent made to it
  agentEdits: number
}

export interface ChatActivity {
  kind: "chat"
  id: string
  title: string
  first: number
  last: number
  // Times the user wrote in it and then left it
  sessions: number
}

export type ActivityItem = PaperActivity | DocActivity | ChatActivity

// One line of the log
export interface ActivityLine {
  at: number
  actor: ActorId
  // e.g. "looked at" (a visit to a paper, with seconds and pages), "starred", "highlighted", "edited", "wrote"
  what: string
  paper?: { id: string; title: string }
  doc?: string
  chat?: { id: string; title: string }
  seconds?: number
  pages?: number[]
  // The same thing done again right after, as one line ("edited", 5 times)
  times?: number
  detail?: string
}

export interface ActivityAnswer {
  // false: the user turned off recording in Settings, and nothing is said
  recording: boolean
  since?: number
  items?: ActivityItem[]
  lines?: ActivityLine[]
  // of: a paper's sentences Owlit cited in chats
  cited?: { quote: string; page?: number; chatId: string; chatTitle: string; at: number }[]
  // More happened than was given
  more?: boolean
}
