import type { ActorId } from "./changes.ts"

// Docs are the files of the workspace folder, read and written by core. Paths are workspace-relative and
// "/"-separated; contents are kept exactly as they are on disk, byte for byte.

export interface WorkspaceFile {
  // Given by core when it first sees the path and kept through renames and moves core makes, for as long
  // as core runs; not stored anywhere
  id: string
  // Relative to the workspace root, "/"-separated, e.g. "writing/Related work.md"
  path: string
  // Markdown files only; other files are listed but never opened here
  content?: string
  createdAt: number
  // The file's mtime in ms, as core last saw it; a write must name it to be accepted
  modifiedAt: number
  // Set once the user renames the file; until then its name follows the first line
  nameLocked?: boolean
}

// A file as core sees it after a change, without its text
export type DocStat = Omit<WorkspaceFile, "content">

export interface DocsListing {
  files: WorkspaceFile[]
  // Every folder Docs shows, empty or not
  folders: string[]
}

// What changed in the workspace outside core (another editor, Finder, git), settled into one message.
// A renamed or moved file is in changed with its id and new path.
export interface DocsChange {
  // Files that appeared or changed, as they are now, Markdown with its text
  changed: WorkspaceFile[]
  // Files that are gone; id is "" for a file core never listed
  deleted: { id: string; path: string }[]
  folders: { created: string[]; deleted: string[] }
  // Too much changed at once to describe: list everything again
  reload?: boolean
}

// The data of a Conflict error from docs.write: the file as it is on disk now; content and modifiedAt
// are null when the file is gone
export interface DocConflict {
  path: string
  content: string | null
  modifiedAt: number | null
}

// A comment on a passage of a doc: the entry that started it, then replies, flat and in order, as Google
// Docs and Feishu keep them. Owlit's comments and your own are the same thing; a shared doc's readers'
// comments live on the share server (ShareComment) and are drawn with these. A comment lives beside the
// file, never in it, and finds its passage again by the quoted words plus a little text on either side.
export interface DocComment {
  id: string
  quote: string
  prefix: string
  suffix: string
  entries: CommentEntry[]
  createdAt: number
  // Put away; kept, so Owlit can read what was said and dismissed
  resolvedAt?: number
  // One of Owlit's comments it folded away itself: the words it was on changed and nobody answered it in
  // a week. Not shown; kept with the doc's comments as history
  foldedAt?: number
  // Carried over from a record of what people said (a meeting, reviews): its first entry is the point as
  // they made it, placed by Owlit; a second entry by Owlit is Owlit's own word on it. path is the record
  source?: { path: string; label: string }
}

export interface CommentEntry {
  id: string
  // Set by core from whoever wrote it, never by the client
  by: ActorId
  // Owlit's entries: which agent wrote it ("Claude Code"); the app names it Owlit
  agent?: string
  text: string
  at: number
  editedAt?: number
  // Owlit's own first entry, rewritten when a reply showed it wrong: what it first said
  was?: string
  // Owlit's entries: the chat that wrote it
  chatId?: string
}

export type CommentAnchor = Pick<DocComment, "quote" | "prefix" | "suffix">

// A comment as a client sends it: core sets each new entry's author, so by is left out or ignored
export type CommentInput = Omit<DocComment, "entries"> & { entries: (Omit<CommentEntry, "by"> & { by?: ActorId })[] }

// Still open: not resolved, and with something said
export const isOpenComment = (c: DocComment) => !c.resolvedAt && !c.foldedAt && c.entries.length > 0

// What a citation in a doc rests on, from what core saw Owlit read when it wrote it (never the agent's
// word), else from the paper alone:
// read: its sentence is on pages Owlit had read. in-paper: its sentence is in the text, on pages no
// recorded read covers (or whose reads were lost): neutral, nothing said about reading. abstract: its
// sentence is the abstract's. not-found: its sentence is in neither the text nor the abstract. no-text:
// it has a sentence, owlit has no text of the paper and the abstract doesn't hold it. whole: no
// sentence, and Owlit had read the paper (how far: owlitRead). not-read: no sentence, and Owlit had read
// nothing of it. bare: no sentence, and what Owlit read isn't known (a citation from before this was
// recorded, from a program outside owlit, or from a chat whose reads were lost).
export type CitationState = "read" | "in-paper" | "abstract" | "not-found" | "no-text" | "whole" | "not-read" | "bare"

// Who put a citation in the doc, as the change log saw the write that brought it: unknown for one
// written before owlit kept this, or by a write it didn't see
export type CitationAuthor = "owlit" | "person" | "other" | "unknown"

// Where a citation's sentence sits: in the text (its page and the section heading above it) or in the
// abstract (abstract, no page), with one sentence either side, cut to about 95 characters with "…". A
// table right before or after shows as "[Table 3]".
export interface CitationPassage {
  page?: number
  section?: string
  before?: string
  after?: string
  abstract?: true
}

// A work the cited sentence itself cites: its marker as written ("(Reicherts et al., 2021)", "[12]"),
// and for a numbered one, the start of that entry in the paper's reference list when owlit finds it
export interface CitedWork {
  marker: string
  reference?: string
}

// How far Owlit had read the paper when it wrote the citation: its whole text, part of it (with the pages
// its reads named, when they named any), or only Owlit's digest of it
export interface OwlitReading {
  depth: "full" | "part" | "digest"
  pages?: string
}

export interface DocCitation {
  // The link's place in the text it was found in: from its "[" to its ")"
  from: number
  to: number
  // As the link names them
  paperId: string
  page?: number
  quote?: string
  // The Library's id for the paper; absent when it isn't in the Library
  libraryId?: string
  by: CitationAuthor
  // null for a citation the person typed or edited: it has no Owlit state
  state: CitationState | null
  passage?: CitationPassage
  // Whether owlit has the paper's text (text.md)
  hasText: boolean
  // Owlit's, when it had read anything of the paper
  owlitRead?: OwlitReading
  citesOther?: CitedWork[]
  // The chat whose write brought it, and when
  chatId?: string
  at?: number
}

// Citations by state, over every citation in the doc (each link counts, the same paper cited twice is
// two). notReadInPaper: those whose state says the paper's text wasn't read where they rest (abstract,
// not-found, no-text, not-read, bare); in-paper and whole are not among them, nor the person's own.
export interface CitationCounts {
  total: number
  read: number
  inPaper: number
  abstract: number
  notFound: number
  noText: number
  whole: number
  notRead: number
  bare: number
  person: number
  notReadInPaper: number
}

export interface DocCitations {
  citations: DocCitation[]
  counts: CitationCounts
}
