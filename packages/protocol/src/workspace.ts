import type { StoredPairing } from "./extension.ts"
import type { InitiativeSettings } from "./initiative.ts"
import type { HighlightColor } from "./library.ts"
import type { InterfaceLanguage } from "./languages.ts"

// A workspace is one folder. What lives inside it (docs, library/, .owlit/) travels with
// it; what is derived or tied to this machine lives in the app data directory instead.

export interface WorkspaceInfo {
  // Absolute, as the file system spells it
  path: string
  // The folder's own name
  name: string
}

// Whether a workspace is open, or one is still opening (at launch, the last one); the window shows the
// welcome page only when neither
export interface WorkspaceState {
  current: WorkspaceInfo | null
  opening: boolean
}

// A recent workspace as the welcome page lists it; missing when the folder is no longer where it was
export interface RecentWorkspace extends WorkspaceInfo {
  missing: boolean
}

// What the welcome page needs: recent workspaces, and where Create a workspace would put a new one (a
// folder name not taken yet)
export interface WelcomeInfo {
  recent: RecentWorkspace[]
  suggestion: { parent: string; name: string }
}

// .owlit/workspace.json: settings that belong to the workspace and move with it
export interface WorkspaceSettings {
  version: 1
  layout: Record<string, unknown>
  // How far Owlit goes here without being asked (Settings › Owlit › On its own); absent: the defaults
  initiative?: Partial<InitiativeSettings>
}

// settings.json in the app data directory: this machine's settings
export interface AppSettings {
  version: 1
  // Most recent first
  recentWorkspaces: string[]
  lastWorkspace?: string
  // When a workspace first opened on this machine: from then on a launch with none open shows the welcome
  // page, not the first-launch flow
  onboardedAt?: number
  // Local agents: the ones the user added, and what each agent last said about itself
  connectors: ConnectorSettings
  // MinerU, which reads PDFs better than pdfium (reading order, tables, formulas, scans)
  parsing: ParsingSettings
  // The services the library asks about papers
  library: LibrarySettings
  // Whether the renderer reports what the user does (the activity stream and journal)
  activity: { enabled: boolean }
  appearance: AppearanceSettings
  profile: ProfileSettings
  // The browser extensions the user allowed to connect
  extension?: { paired: StoredPairing[] }
}

// Who the user is, as far as owlit needs to know
export interface ProfileSettings {
  // What Owlit calls the user: in the Chat greeting, and in what agents are told
  name?: string
}

// How owlit looks on this machine. A paper tone swaps the whole neutral family (surfaces, text, lines);
// marks that carry meaning (star, notes, tags, highlights, warning, red) keep their colours in every tone.
export type ThemeChoice = "system" | "light" | "dark"
export type PaperTone = "warm" | "neutral" | "slate" | "sepia"
export interface AppearanceSettings {
  theme: ThemeChoice
  tone: PaperTone
  // The interface's language; "system" follows the system's languages
  language: InterfaceLanguage
}

export interface ParsingSettings {
  // Where MinerU runs; none set means papers keep pdfium's text
  service?: "cloud" | "self-hosted"
  // self-hosted: the address of its API (default http://127.0.0.1:8000); the cloud is always mineru.net
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
  // Publishers' own APIs, which give the university's network its subscribed PDFs without a browser:
  // Elsevier's API key (dev.elsevier.com) and Wiley's text-and-data-mining token
  elsevierApiKey?: string
  wileyTdmToken?: string
  // The library's proxy, through which publishers see the university's subscription
  proxy?: ProxySettings
  // Digests: the language they are written in (default English), and whether every paper gets
  // one once its text is in (default: only papers the user opens or stars)
  digestLanguage?: string
  digestEveryPaper?: boolean
}

// login-url: <base><path>?url=<target> (EZproxy's /login, Tsinghua's tlink /go); host-rewrite:
// dl.acm.org becomes dl-acm-org.<proxy host>
export interface ProxySettings {
  base: string
  scheme: "login-url" | "host-rewrite"
  path?: string
  // One of PROXY_PRESETS, when it was picked from that list
  preset?: string
}

export interface ConnectorSettings {
  custom?: { id: string; name: string; command: string }[]
  // The agent that writes digests and other background work; the first one set up when absent
  background?: string
  // The model each agent uses for background work, when not its own default (a cheaper one for digests)
  backgroundModels?: Record<string, string>
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
export const DOCS_HIDDEN_FOLDERS = ["library"] as const

// Whether a workspace-relative path ("a/b.md") is outside what Docs shows: under library/ at the root,
// or under any dot-folder (or a dot-file) at any depth
export function isHiddenFromDocs(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean)
  if (segments.length === 0) return false
  if ((DOCS_HIDDEN_FOLDERS as readonly string[]).includes(segments[0])) return true
  return segments.some((segment) => segment.startsWith("."))
}

// What core asks a window to do, and what the window answers with ui.respond. fs.* go to the window
// that has the doc open (agents/fs.ts); the rest go to the window the user is in.
export interface UiActions {
  // The doc's text in its editor; null: not open after all
  "fs.read": { params: { path: string }; result: { content: string | null } }
  // The agent's write, applied in the doc's editor; false: not open after all
  "fs.write": { params: { path: string; content: string; versionId: string }; result: { applied: boolean } }
  // Shows a paper, doc, chat or thread (an owlit:// link). chatId (on open, jump and mark) is
  // the chat whose agent asked: if the user is reading it, it carries on in the agent window.
  open: { params: { uri: string; chatId?: string }; result: { title: string } }
  // Shows a paper or doc at a place: a 1-based page of a paper, or a passage quoted from either. The
  // passage is ringed (paper) or selected (doc); found is false when the quote wasn't there.
  jump: { params: { uri: string; page?: number; quote?: string; chatId?: string }; result: { title: string; found: boolean } }
  // Highlights a quoted passage in a paper; page is 1-based
  mark: { params: { uri: string; quote: string; color?: HighlightColor; chatId?: string }; result: { title: string; highlightId: string; page: number } }
}
export type UiMethod = keyof UiActions

export type UiRequest = { requestId: string; clientId: string } & { [M in UiMethod]: { method: M; params: UiActions[M]["params"] } }[UiMethod]
