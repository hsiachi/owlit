// Docs wire types live in @owlit/protocol; the path helpers below are the app's own.

export type { WorkspaceFile, AgentNote } from "@owlit/protocol"

export const isMarkdown = (path: string) => /\.md$/i.test(path)

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

// What a file is called in the tree and in the header: its name, without the Markdown extension
export const displayName = (path: string) => {
  const name = baseName(path)
  return isMarkdown(name) ? name.slice(0, -3) : name
}

// How a doc is mentioned and linked: its path under owlit://docs/
export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`
