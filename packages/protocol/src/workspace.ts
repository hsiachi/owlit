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
  // Local agents: the ones the user added, and what each agent last said about itself
  connectors: ConnectorSettings
  // MinerU, which reads PDFs better than pdfium (reading order, tables, formulas, scans)
  parsing: ParsingSettings
  // The services the library asks about papers
  library: LibrarySettings
  // Whether the renderer reports what the user does (the activity stream and journal)
  activity: { enabled: boolean }
}

export interface ParsingSettings {
  // Where MinerU runs; none set means papers keep pdfium's text
  service?: "cloud" | "self-hosted"
  // cloud: https://mineru.net unless set; self-hosted: the address of its API (http://127.0.0.1:8000)
  url?: string
  // The cloud's API token
  token?: string
  // Papers parsed at once (the parse lane); default 2
  concurrency?: number
  // Parse every PDF once it is in place; off means only when asked. Default on.
  auto?: boolean
}

export interface LibrarySettings {
  // Given to OpenAlex (its polite pool) and Unpaywall, which ask for an address they can write to
  contactEmail?: string
  // OpenAlex's own key, for more than its free daily allowance
  openalexApiKey?: string
  // Semantic Scholar allows far more with a key; without one it often answers "slow down"
  s2ApiKey?: string
}

export interface ConnectorSettings {
  custom?: { id: string; name: string; command: string }[]
  // From the last check: what the agent offers, so the pickers fill without starting it
  probed?: Record<string, ProbedConnector>
}

export interface ProbedConnector {
  checkedAt: number
  version?: string
  models: { id: string; name: string; description?: string }[]
  modes: { id: string; name: string; description?: string }[]
  efforts: { id: string; name: string; description?: string }[]
  defaultModelId?: string
  defaultModeId?: string
  defaultEffortId?: string
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

// Core asking the window that has a doc open to read it or change it in its editor (agents/fs.ts). The
// window answers with ui.respond: fs.read → { content: string | null } (null: not open after all),
// fs.write → { applied: boolean }.
export type UiRequest = { requestId: string; clientId: string } & (
  | { method: "fs.read"; params: { path: string } }
  | { method: "fs.write"; params: { path: string; content: string; versionId: string } }
)
