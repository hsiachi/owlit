// The workspace's own state folder, inside it
export const OWLIT_DIR = ".owlit"

// Whether a workspace-relative path is in owlit's own part of the folder, .owlit/ or library/. By its first
// segment whatever its case: macOS's file system takes Library/ for library/ and .OWLIT/ for .owlit/.
export function isOwlitPath(rel: string) {
  const top = rel.split("/")[0].toLowerCase()
  return top === OWLIT_DIR || top === "library"
}
