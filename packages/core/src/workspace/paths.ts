// The workspace's own state folder, inside it
export const OWLIT_DIR = ".owlit"

// The folders owlit keeps in .owlit/, the Owlit engine's transcripts (engine/) among them. An agent reads
// none of them with its own tools but the files attached in chats (agents/profiles.ts); a folder named
// in the code and missing here fails profiles.test.ts.
export const OWLIT_FOLDERS = ["chats", "docs", "engine", "papers", "seen", "shares", "threads", "trash", "versions"] as const

// Whether a workspace-relative path is in owlit's own part of the folder, .owlit/ or library/. By its first
// segment whatever its case: macOS's file system takes Library/ for library/ and .OWLIT/ for .owlit/.
export function isOwlitPath(rel: string) {
  const top = rel.split("/")[0].toLowerCase()
  return top === OWLIT_DIR || top === "library"
}
