// Knowledge domain types. A topic is one Markdown file in the workspace's `knowledge/` folder, written by
// Owlit; what the user did to it (edits, removals, what they said) lives beside it in `.owlit/knowledge/`,
// where a rewrite can't touch it. These are the parsed shapes of both.

// A mention inside a line's sources, as written in the file: `[label](owlit://…)`
export interface Ref {
  label: string
  uri: string
}

// Who a line comes from and how. In the file the speaker opens the line ("You:", "Owlit:", "Schick 2023:");
// the verb is written only when it isn't the usual one ("You reported:", "You rewrote:").
export type Verb = "wrote" | "said" | "reported" | "rewrote" | "found" | "says" | "thinks"

export interface Line {
  // Obsidian block id, kept across rewrites: s1, s2…
  id: string
  speaker: string
  verb?: Verb
  text: string
  sources: Ref[]
  // When it holds, as a full sentence ("Only on HotpotQA and FEVER.")
  condition?: string
}

export interface Question {
  id: string
  // Always the user's own words
  text: string
  // One muted sentence on where it stands ("From your proposal. Schick 2023 partly answers it.")
  status?: string
  sources: Ref[]
}

// One row of Sources: when Owlit took something in, what, and how it was used
export interface SourceEntry {
  date: string
  ref: Ref
  how: string
}

export interface Topic {
  // From front matter, so a rename keeps the sidecar and every link
  id: string
  // Workspace-relative file path, "knowledge/When to call a tool.md"
  path: string
  name: string
  summary: string
  questions: Question[]
  lines: Line[]
  sources: SourceEntry[]
  archived: boolean
  // When Owlit last changed the file
  updatedAt: number
}

// ---- Sidecar: .owlit/knowledge/<topic id>.json ----

export interface Change {
  id: string
  at: number
  // The line or question it touched, if one
  lineId?: string
  // "Added", "Rewritten", "Removed"…, as the history shows it
  what: string
  // Why, in the user's terms ("you read Schick 2023 §Limitations")
  why: string
  by: "owlit" | "you"
  // The line before a rewrite, so the history can show it
  before?: string
}

// Something the user said about a line, in a chat or the ask bar
export interface Said {
  at: number
  text: string
  chatId?: string
}

export interface TopicSidecar {
  // Last time the user looked at the topic; lines Owlit changed after it carry the dot
  seenAt: number
  paused?: boolean
  history: Change[]
  // Lines the user rewrote, kept word for word on every run
  edits: Record<string, { text: string; at: number }>
  // Lines the user removed, never brought back
  removed: Record<string, { text: string; at: number }>
  said: Record<string, Said[]>
  // When Owlit last added or changed each line
  changedAt: Record<string, number>
}

// ---- A paper's connections: .owlit/knowledge/papers/<paper id>.json ----

// A passage of the paper, found again in the PDF by its words. `start` and `end` are short phrases that
// open and close it, since a long passage rarely survives the PDF's line breaks as one search.
export interface Passage {
  id: string
  // "§4", "Limitations", "abstract", "p. 5"
  section: string
  text: string
  start: string
  end: string
  // 0-based page where Owlit last found it, tried first
  page?: number
}

// What the user already has, that a passage of this paper relates to
export type Have =
  | { kind: "line"; topicId: string; lineId: string }
  | { kind: "question"; topicId: string; questionId: string }
  | { kind: "doc"; path: string; quote: string; at: number }

export type ConnectionKind = "challenges" | "backs" | "might"

export interface Connection {
  id: string
  kind: ConnectionKind
  have: Have
  // The sentence after the section link: "cuts against it: …"
  relation: string
  passageId: string
  createdAt: number
}

export interface PaperKnowledge {
  passages: Record<string, Passage>
  connections: Connection[]
  // Guesses the user said were not related
  dismissed: string[]
  // Last time the user had the Knowledge tab open on this paper
  seenAt: number
  // A line whose passage the user found and highlighted, waiting for Owlit to rewrite it from there
  found?: Record<string, { topicId: string; passageId: string }>
  // For an abstract-only line ("topic/line"), the passage Owlit thinks says the same thing in the body
  likely?: Record<string, string>
}
