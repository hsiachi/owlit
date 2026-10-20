// What owlit's browser extension and owlit say to each other over the local port, and what the window
// shows of it. The extension runs in the user's own browser with their sign-ins; core serves it on
// 127.0.0.1 only, to browser extensions only, and only after the user allowed one in the window.

// Fixed, so an extension finds owlit without being told where to look. Not 23119, Zotero's connector's.
// Only the installed owlit serves it.
export const EXTENSION_PORT = 21837
// What an owlit run from a checkout (Owlit Dev) serves instead, for an extension built for it
// (apps/extension's build:dev), so the extension in the user's browser never reaches a preview
export const EXTENSION_DEV_PORT = 21838

// Which owlit answers on the port: its id (AppSettings.owlitId) and its name as the menu bar says it
// (Owlit, Owlit Dev (pdf-flow)). Sent on every answer to an extension, paired or not, in these headers:
// an extension's pairing belongs to one owlit, and another one on the port is told apart by them.
export interface OwlitIdentity {
  id: string
  name: string
}
export const OWLIT_ID_HEADER = "x-owlit-id"
export const OWLIT_NAME_HEADER = "x-owlit-name"

// A browser extension the user allowed, as settings.json keeps it: the token itself is never kept,
// only its SHA-256 (hex)
export interface StoredPairing {
  id: string
  // As the user knows it: the app's own name when the system could tell (app), else what the extension said
  browser: string
  // The bundle id of the app its requests came from (company.thebrowser.dia), where the system can tell
  // (macOS): sign-ins open there
  app?: string
  // The extension that asked (chrome-extension://<id>, moz-extension://<uuid>), from its requests' Origin
  // or, where the browser sends none, its x-owlit-extension header; absent when it gave neither. Its
  // token is taken only from the same one.
  origin?: string
  tokenSha256: string
  pairedAt: number
  // The last request it made, kept at most once a minute
  lastSeenAt?: number
}

export interface ExtensionPairing {
  id: string
  browser: string
  origin?: string
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
  asking: { id: string; browser: string; origin?: string; at: number }[]
  // Sites whose papers the extension can't fetch until the user does something there, one per site
  waits: ExtensionWait[]
}

// A site paused for the user: a sign-in (the library's, through its proxy, or the publisher's), a check,
// or the extension not yet allowed to read it. One covers every paper waiting there; it goes by itself
// once the user is through and owlit goes on.
export interface ExtensionWait {
  kind: "sign-in" | "check" | "permission"
  // The site, as the queue paces it: the publisher's registrable domain, or the library proxy's host.
  // For a permission, the site to allow, which through the proxy is the publisher's, not the proxy's
  host: string
  // Papers waiting there
  papers: number
  // What to open in the user's browser for it: the proxy's sign-in page, or the page that asked
  url: string
  // The user pressed Find PDF or Look again on one of those papers since owlit started: it waits on them
  askedFor: boolean
  // Fetched through the library's proxy: a sign-in there is the library's, else the site's own
  proxied: boolean
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
export type PairAnswer = { state: "waiting" } | { state: "allowed"; token: string; owlit: OwlitIdentity }

// GET /status
export interface ExtensionStatus {
  version: string
  workspace: { name: string } | null
  // When this extension was allowed
  connectedAt: number
  owlit: OwlitIdentity
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

// POST /open: brings owlit to the front, showing the Library paper when one is named (the card's and the
// popup's Open, Open owlit). shown: false when the paper isn't in the open workspace's Library, or no
// window could show it.
export interface OpenBody {
  paper?: string
}
export interface OpenAnswer {
  shown: boolean
}

// ---- Fetching for owlit. owlit decides what and when; the extension fetches nothing else.

// A paper owlit's own routes couldn't get, for the extension to fetch with the user's cookies
export interface WorkItem {
  id: string
  paperId: string
  // The publisher's article page, through the library's proxy when one is set
  url: string
  // The publisher's PDF itself, when owlit knows its address; tried first
  pdfUrl?: string
  // The site it is paced and paused by: the publisher's registrable domain, or the proxy's host
  host: string
  proxied: boolean
}

// GET /work, held open a while: the papers due now (none when the hold ran out), and the sites paused
// for the user, so the extension knows where to watch for them getting through
export interface WorkAnswer {
  work: WorkItem[]
  waits: { kind: ExtensionWait["kind"]; host: string; papers: number; proxied: boolean }[]
  // Pages the user asked owlit to open for a site that waits on them: the extension opens each in its
  // own browser, the one with the user's access. The answer comes at once when there is one.
  open: OpenPage[]
}

// A sign-in or a check: the page that asked, or the proxy's sign-in. Being allowed to read a site: the
// extension's own page with one Allow button, for the papers waiting there.
export type OpenPage = { kind: "sign-in" | "check"; host: string; url: string } | { kind: "permission"; host: string; papers: number }

// extension.open: who opened the page for a site that waits on the user. extension: the extension, in
// its browser; browser: owlit, in the browser the extension was paired in, since none is connected now;
// none: nothing could (being allowed to read a site needs the extension).
export interface ExtensionOpened {
  by: "extension" | "browser" | "none"
  browser?: string
}

// How a fetch ended without a PDF. The extension reports only this word, the host, the page's title and
// its final address, never the page's text.
export type WorkEnding = "no-copy" | "no-access" | "not-offered" | "not-there" | "check" | "sign-in" | "offline" | "no-permission"

// POST /work/:id, as JSON when no PDF came (a PDF comes as application/pdf)
export interface WorkEnded {
  ended: WorkEnding
  host: string
  title?: string
  url?: string
}

// POST /work/resume: the user got through at this site (a page there loaded that is neither a check nor
// a sign-in, or the extension was allowed there)
export interface WorkResume {
  host: string
}
