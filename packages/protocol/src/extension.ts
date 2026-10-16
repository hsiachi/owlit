// What owlit's browser extension and owlit say to each other over the local port, and what the window
// shows of it. The extension runs in the user's own browser with their sign-ins; core serves it on
// 127.0.0.1 only, to browser extensions only, and only after the user allowed one in the window.

// Fixed, so an extension finds owlit without being told where to look. Not 23119, Zotero's connector's.
export const EXTENSION_PORT = 21837

// A browser extension the user allowed, as settings.json keeps it: the token itself is never kept,
// only its SHA-256 (hex)
export interface StoredPairing {
  id: string
  browser: string
  tokenSha256: string
  pairedAt: number
  // The last request it made, kept at most once a minute
  lastSeenAt?: number
}

export interface ExtensionPairing {
  id: string
  browser: string
  pairedAt: number
  lastSeenAt?: number
}

// What Settings and the pairing question show
export interface ExtensionView {
  // The port is open for the extension
  serving: boolean
  // Another program (another owlit, say) has the port; owlit tries again every 30 s
  portTaken: boolean
  paired: ExtensionPairing[]
  // Extensions waiting for the user to say whether they may connect, oldest first
  asking: { id: string; browser: string; at: number }[]
}

// ---- Over the port. Errors are JSON too: { reason, message } with message one sentence for the user.

export type ExtensionErrorReason =
  | "not-an-extension"
  | "not-paired"
  | "no-window"
  | "no-workspace"
  | "refused"
  | "expired"
  | "not-found"
  | "not-a-pdf"
  | "not-this-paper"
  | "has-pdf"
  | "not-a-library-paper"
  | "too-large"
  | "bad-request"
  | "failed"

export interface ExtensionError {
  reason: ExtensionErrorReason
  message: string
}

// POST /pair
export interface PairBody {
  // As the user knows it: Chrome, Edge, Arc, Dia
  browser: string
  extensionVersion?: string
}
// 202: the question is in the owlit window; GET /pair/:pairing answers once the user did
export interface PairStarted {
  pairing: string
  // How long the question stays open, in ms
  expiresIn: number
}
// GET /pair/:pairing. Held open a while for an answer; "waiting" when none came yet, then asked again.
// Refused (403) and expired (408) come as errors.
export type PairAnswer = { state: "waiting" } | { state: "allowed"; token: string }

// GET /status
export interface ExtensionStatus {
  version: string
  workspace: { name: string } | null
  // When this extension was allowed
  connectedAt: number
}

// A paper as the extension shows it
export interface ExtensionPaper {
  id: string
  title: string
  hasPdf: boolean
}

// GET /papers?doi=&arxiv=&url= → { paper: ExtensionPaper | null }
// POST /papers: what the page says about its paper. The DOI or arXiv id is looked up as the app's Add
// does; the rest stands in when nothing resolves.
export interface AddPaperBody {
  doi?: string
  arxiv?: string
  url?: string
  title?: string
  authors?: string[]
  year?: number
  venue?: string
  pdfUrl?: string
}
// POST /papers, PUT /papers/:id/pdf, PUT /pdfs
export interface PaperAnswer {
  paper: ExtensionPaper
}
