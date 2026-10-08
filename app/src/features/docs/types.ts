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

export const isMarkdown = (path: string) => /\.md$/i.test(path)

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

// What a file is called in the tree and in the header: its name, without the Markdown extension
export const displayName = (path: string) => {
  const name = baseName(path)
  return isMarkdown(name) ? name.slice(0, -3) : name
}
