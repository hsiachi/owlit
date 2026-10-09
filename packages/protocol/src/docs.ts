// Docs are the files of the workspace folder. Until the desktop shell exists, a persisted store stands in
// for the disk; paths and contents are kept exactly as they would be written, so a real file layer can
// replace the store without reshaping anything.

export interface WorkspaceFile {
  id: string
  // Relative to the workspace root, "/"-separated, e.g. "writing/Related work.md"
  path: string
  // Markdown files only; other files are listed but never opened here
  content?: string
  createdAt: number
  modifiedAt: number
  // Set once the user renames the file; until then its name follows the first line
  nameLocked?: boolean
}

// A note an agent left on a passage of a doc. It lives beside the file, never in it, and finds its passage
// again by the quoted words plus a little of the text on either side.
export interface AgentNote {
  id: string
  quote: string
  prefix: string
  suffix: string
  text: string
  // Who wrote it, e.g. "Claude Code"
  by: string
  chatId?: string
  createdAt: number
}
