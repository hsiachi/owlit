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
  // One of Owlit's comments the user dismissed: not shown, and kept so Owlit doesn't say it again
  dismissedAt?: number
  // One of Owlit's comments it folded away itself: the words it was on changed and nobody answered it in
  // a week. Not shown; kept with the doc's comments as history
  foldedAt?: number
}

export interface CommentEntry {
  id: string
  by: "you" | "owlit"
  // Owlit's entries: which agent wrote it ("Claude Code"); the app names it Owlit
  agent?: string
  text: string
  at: number
  editedAt?: number
  // Owlit's entries: the chat that wrote it
  chatId?: string
}

export type CommentAnchor = Pick<DocComment, "quote" | "prefix" | "suffix">

// A note as agents left them before comments: one text, no replies. Still read, as an Owlit comment.
interface LegacyNote extends CommentAnchor {
  id: string
  text: string
  by: string
  chatId?: string
  createdAt: number
}

export function asComment(value: DocComment | LegacyNote): DocComment {
  if ("entries" in value && Array.isArray(value.entries)) return value
  const note = value as LegacyNote
  const entry: CommentEntry = { id: note.id, by: "owlit", agent: note.by, text: note.text, at: note.createdAt, ...(note.chatId ? { chatId: note.chatId } : {}) }
  return { id: note.id, quote: note.quote, prefix: note.prefix, suffix: note.suffix, entries: [entry], createdAt: note.createdAt }
}

// Still open: not resolved, and with something said
export const isOpenComment = (c: DocComment) => !c.resolvedAt && !c.dismissedAt && !c.foldedAt && c.entries.length > 0

// A version kept so an agent's change can be taken back (.owlit/versions/): a doc's text
// before a write, a note an agent left, a paper an agent added, a thread before an agent wrote to it.
// An undo keeps what it replaced as a
// version too (by "undo"), so it can be undone in turn.
export interface VersionInfo {
  id: string
  kind: "file" | "note" | "paper" | "thread" | "memory"
  // file: workspace-relative path; note: the doc's path; paper: the paper's id; thread: its id; memory:
  // the line's id
  path: string
  at: number
  chatId?: string
  by: "agent" | "undo"
  // file: the change created or deleted the file
  existed?: boolean
  deleted?: true
  // note and paper
  op?: "added" | "removed"
}

// What owlit keeps about Owlit and one of your docs (.owlit/docs/owlit.json, moving with the doc):
// whether you keep Owlit out of it, and when Owlit last looked at it on its own
export interface DocOwlit {
  // When you chose Keep Owlit out; absent while Owlit is let in (the default)
  out?: number
  looked?: DocLook
  // Sections Owlit's daily look found half done (an empty heading, a TODO), by a hash of the heading,
  // with when it first found each so: one still half done a week later gets a comment, once
  halfDone?: Record<string, number>
}

// Owlit's last look at a doc: when, the doc's modification time it read, and what came of it
export interface DocLook {
  at: number
  mtime: number
  outcome: "comments" | "nothing"
  // How many comments it left
  count: number
  // The paragraphs it read, as short hashes: the next look reads only the ones not among them
  seen?: string[]
}
