// A workspace is one folder. What lives inside it (docs, library/, knowledge/, .owlit/) travels with
// it; what is derived or tied to this machine lives in the app data directory instead.

export interface WorkspaceInfo {
  // Absolute, as the file system spells it
  path: string
  // The folder's own name
  name: string
}

// .owlit/workspace.json: settings that belong to the workspace and move with it
export interface WorkspaceSettings {
  version: 1
  layout: Record<string, unknown>
}

// settings.json in the app data directory: this machine's settings
export interface AppSettings {
  version: 1
  // Most recent first
  recentWorkspaces: string[]
  lastWorkspace?: string
  // Filled by the agent runtime (T09)
  connectors: Record<string, unknown>
  // Filled by the parsing service (T18)
  parsing: Record<string, unknown>
}

// Top-level names in a workspace that are owlit's or hidden: the Docs tree never shows them
export const DOCS_HIDDEN_FOLDERS = ["library", "knowledge"] as const

// Whether a workspace-relative path ("a/b.md") is outside what Docs shows: under library/ or
// knowledge/ at the root, or under any dot-folder (or a dot-file) at any depth
export function isHiddenFromDocs(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean)
  if (segments.length === 0) return false
  if ((DOCS_HIDDEN_FOLDERS as readonly string[]).includes(segments[0])) return true
  return segments.some((segment) => segment.startsWith("."))
}
