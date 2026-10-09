// Docs wire types and path helpers live in @owlit/protocol, shared with core; display helpers are the app's own.

import { baseName, isMarkdown } from "@owlit/protocol"

export type { WorkspaceFile, AgentNote } from "@owlit/protocol"
export { baseName, isMarkdown, isWithin, joinPath, parentPath } from "@owlit/protocol"

// What a file is called in the tree and in the header: its name, without the Markdown extension
export const displayName = (path: string) => {
  const name = baseName(path)
  return isMarkdown(name) ? name.slice(0, -3) : name
}

// How a doc is mentioned and linked: its path under owlit://docs/
export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`
