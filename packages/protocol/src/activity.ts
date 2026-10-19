import type { ActorId, OwlitId, PersonId } from "./changes.ts"
import type { EvaluationRecord, FeedbackRecord, JournaledCoreEvent, LookedRecord } from "./initiative.ts"
import type { ReadStatus } from "./library.ts"

// What the user does in the interface, as the renderer reports it to core. It feeds the workspace
// journal (core's reading.ts reads what was read from there) and, later, a live agent that follows
// along. Every event carries the time it happened, in ms since the epoch.

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
  // The view was scrolled to its end (the digest's last lines came into view)
  | { kind: "paper.end"; at: number; paperId: string; view: PaperView }
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
  // The window has been in the background this long
  | { kind: "idle"; at: number; seconds: number }
  // The window came to the front again after an idle stretch this long
  | { kind: "back"; at: number; seconds: number }

export type ActivityKind = ActivityEvent["kind"]

export type ActivityOf<K extends ActivityKind> = Extract<ActivityEvent, { kind: K }>

// What goes into .owlit/journal.jsonl. The rest (page turns, removing a highlight, sending a message) is
// only for live listeners. Closing a doc, the window going idle and coming back are kept because Owlit's
// rules wait on them (initiative.ts, presence.ts), and a replay has to hear what they heard.
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
  "note.edited",
  "paper.closed",
  "doc.closed",
  "idle",
  "back",
] as const satisfies readonly ActivityKind[]

// A line of .owlit/journal.jsonl: who did what, when. Owlit's own decisions (each rule's evaluation, with
// or without an action) and what the user did with its work are there too, so its initiative can be
// looked back on and replayed. The window's events are the person's; what core heard, looked at and
// decided is that person's Owlit's.
export type JournalEntry =
  | (ActivityEvent & { actor: PersonId })
  | (EvaluationRecord & { actor: OwlitId })
  | (LookedRecord & { actor: OwlitId })
  | (JournaledCoreEvent & { actor: OwlitId })
  | (FeedbackRecord & { actor: PersonId })

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
