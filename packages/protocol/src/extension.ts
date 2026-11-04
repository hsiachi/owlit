import type { GateKey, LaneKey, WaitId } from "./pdf-keys.ts"
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
  // An extension asks for work now (ExtensionWork.connected): without one, what is with the extension
  // waits for the browser to open
  connected: boolean
  // Extensions waiting for the user to say whether they may connect, oldest first
  asking: { id: string; browser: string; origin?: string; at: number }[]
  // Sites whose papers the extension can't fetch until the user does something there, one per site
  waits: ExtensionWait[]
  // Waits the user got through, while their papers go on (and until the window puts the line away,
  // extension.dismissGoing); a wait that is up again carries its own going instead
  going: GoingOn[]
  // Get PDFs in the open workspace: the one going on, else the last one, until it is put away; a new one
  // replaces the one that ended (PdfRunView)
  runs: PdfRunView[]
}

// A site paused for the user: a sign-in (the library's, through its proxy, or the publisher's), a check,
// the site's firewall blocking their browser (another network gets past it), or the extension not yet
// allowed to read it. One covers every paper waiting there; it goes by itself once the user is through
// and owlit goes on.
export interface ExtensionWait {
  // The gate it waits at, one wait per gate (pdf-keys.ts); what every join with a paper goes by
  id: WaitId
  kind: "sign-in" | "check" | "blocked" | "permission"
  // Where the user acts, as shown: the page's host (sciencedirect.com, misq.umn.edu), the whole site to
  // allow for a permission (apa.org), the library proxy's host for its own sign-in; never an identity
  // provider's
  at: string
  // The same as at, for the extension, which names waits by host (WorkAnswer.waits, WorkResume)
  host: string
  // Hosts where a page that loaded shows the user got through (keys.ts watchOf)
  watch: string[]
  // Papers whose fetch it is in the way of: those whose gate it is, and every paper of a lane it holds
  // (the proxy's own sign-in)
  papers: number
  // What to open in the user's browser for it: the proxy's sign-in page, or the page that asked
  url: string
  // The user pressed Find PDF or Look again on one of the papers there, or behind it, since owlit
  // started: it waits on them
  askedFor: boolean
  // The wait is the library proxy's own: a sign-in there is the library's, else the site's own
  proxied: boolean
  // When it began; with id, what its follow-ups below are kept by, so an earlier wait's never attach to it
  since: number
  // The user had its page opened in their browser (extension.open), and which browser: the button then
  // says what they did there. Gone once they say they got through, or the wait's kind changes.
  opened?: { at: number; browser?: string }
  // The user said they got through (extension.resume); again: the same wait came back after it, since a
  // paper owlit went on with met the same page
  retried?: { at: number; again: boolean }
  going?: WaitGoing
}

// After the user got through at a wait (they said so, or the extension saw it): the papers that went on,
// and how many of them came back with their PDF and have ended either way, counted from the papers
// themselves
export interface WaitGoing {
  at: number
  ids: string[]
  saved: number
  ended: number
}

// A wait that went, with its papers going on. watch: the hosts its pages are at (ExtensionWait.watch),
// where the extension's popup says so; absent from an owlit that sends none
export interface GoingOn extends Pick<ExtensionWait, "kind" | "at" | "proxied" | "since"> {
  wait: WaitId
  watch?: string[]
  going: WaitGoing
}

// One Get PDFs (library.fetchPdfs), as core counts it from its papers every time it is shown: never a
// count kept on the side. A second Get PDFs while one goes on adds to it.
export interface PdfRunView {
  id: string
  started: number
  // Its papers still in the library, and how many
  ids: string[]
  total: number
  // PDFs placed since it started by owlit's own search or the extension; byYou: by the user (dropped,
  // chosen, opened by hand)
  saved: number
  byYou: number
  // Papers under a wait for the user, by the wait (ExtensionWait.id), the most papers first
  waits: { wait: WaitId; papers: number; ids: string[] }[]
  // Papers to download by hand, and at which sites, the most papers first
  manual: { ids: string[]; sites: { host: string; papers: number }[] }
  // No PDF to be had (the tries ended so); the user found none on its page; the user stopped it
  none: number
  skipped: number
  stopped: number
  // Being fetched now (getting); in line, or not handed over yet (going); closed: in line with no
  // extension connected, so nothing moves until the browser opens again; away: never handed over, since
  // no extension was connected by their turn, until asked for again
  getting: number
  going: number
  closed: number
  // In line, held back by a host that didn't answer their last fetch (PdfState.extension.unreachable),
  // by that host; until: when the last of them may go; trying: once the run has ended, owlit's retry of
  // one of them is going on now (the run stays ended)
  unreachable: { at: string; until: number; papers: number; ids: string[]; trying?: true }[]
  away: number
  // Something is going
  running: boolean
  stoppedAt?: number
  // When nothing was going any more, the first time; absent while something is going again
  endedAt?: number
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

// GET /papers?doi=&arxiv=&url=. getting: the papers owlit's queue for the extension holds, when this paper
// is one of them
export interface PaperFound {
  paper: ExtensionPaper | null
  getting?: number
}

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
  // `<paperId>#<attempt>`, posted back with the answer (POST /work/:id); opaque to the extension
  id: string
  paperId: string
  // Rises with each hand-out of the paper; the one id names
  attempt: number
  // The publisher's article page, through the library's proxy when one is set
  url: string
  // The publisher's PDF itself, when owlit knows its address; tried first
  pdfUrl?: string
  // Whose pace it follows (the proxy's, or its gate), and who can stop it (pdf-keys.ts): the extension
  // keeps one tab per gate for the papers it fetches in a tab
  lane: LaneKey
  gate: GateKey
  // The lane's host, for an extension that keys by host
  host: string
  proxied: boolean
  // The gate's publisher always turns away the extension's own fetch: only a tab of the site fetches it
  inTab?: true
  // The user started what this fetch is part of (Get PDFs, Find PDF, Look again, getting through at a
  // wait): only then may the extension open a tab of its own for it
  userStarted?: true
  // The gate's sites (registrable domains), the one to allow first: where its tab may stand, and the
  // site to name when that tab lands where the extension may not read
  sites?: string[]
}

// A wait as the extension needs it: where to watch for the user getting through (watch), and, for a
// site it may not read, the sites to ask the browser for (allow: the gate's hosts and the hosts its PDFs
// come from, as registrable domains). since: with id, which wait it is (one that went and came back at the
// same gate keeps its since); absent from an owlit that sends none.
export type WorkWait = Pick<ExtensionWait, "id" | "kind" | "at" | "host" | "watch" | "papers" | "proxied"> & Partial<Pick<ExtensionWait, "since">> & { allow: string[] }

// GET /work, held open a while: the papers due now (none when the hold ran out), and the sites paused
// for the user, so the extension knows where to watch for them getting through
export interface WorkAnswer {
  work: WorkItem[]
  waits: WorkWait[]
  // Pages the user asked owlit to open for a site that waits on them: the extension opens each in its
  // own browser, the one with the user's access. The answer comes at once when there is one.
  open: OpenPage[]
  // The waits the user got through, with their papers going on, counted by core (ExtensionView.going);
  // absent from an owlit that kept no such count
  going?: GoingOn[]
  // The endings POST /work/:id accepts (WORK_ENDINGS); absent from an owlit that takes only
  // LEGACY_WORK_ENDINGS
  endings?: WorkEnding[]
}

// A sign-in or a check: the page that asked, or the proxy's sign-in. Being allowed to read a site: the
// extension's own page with one Allow button, for the papers waiting there. A walk: the first paper's
// page of a walk through the manual downloads (WalkStep), in a tab of its own.
// wait: the wait it is for (ExtensionWait.id), by which the extension finds its own tab at that check;
// absent from an owlit that names none.
export type OpenPage =
  | { kind: "sign-in" | "check" | "blocked"; host: string; url: string; wait?: WaitId }
  | { kind: "permission"; host: string; papers: number }
  | { kind: "walk"; step: Extract<WalkStep, { kind: "paper" }> }

// extension.open: who opened the page for a site that waits on the user. extension: the extension, in
// its browser; browser: owlit, in the browser the extension was paired in, since none is connected now;
// none: nothing could (being allowed to read a site needs the extension).
export interface ExtensionOpened {
  by: "extension" | "browser" | "none"
  browser?: string
}

// How a fetch ended without a PDF. The extension reports only this word, the host, the page's title and
// its final address, never the page's text. unreadable: the page wasn't the paper's and said nothing the
// extension knows (a page built by its scripts, which the extension never runs, or a "Please wait"), so
// whether the site has a copy is unknown.
export const WORK_ENDINGS = ["no-copy", "no-access", "not-offered", "not-there", "check", "blocked", "sign-in", "offline", "no-permission", "unreadable"] as const
export type WorkEnding = (typeof WORK_ENDINGS)[number]
// What an owlit whose GET /work names no endings accepts (0.2.x): it refuses any other with a 400
export const LEGACY_WORK_ENDINGS: readonly WorkEnding[] = ["no-copy", "no-access", "not-offered", "not-there", "check", "blocked", "sign-in", "offline", "no-permission"]

// POST /work/:id, as JSON when no PDF came (a PDF comes as application/pdf)
export interface WorkEnded {
  ended: WorkEnding
  host: string
  title?: string
  url?: string
}

// POST /work/resume: the user got through at this wait (a page it watches loaded that is neither a
// check nor a sign-in, or the extension was allowed there). { host } is what an extension that keys
// waits by host sends, which core still matches through the waits' watch while such extensions are out.
export type WorkResume = { wait: WaitId } | { host: string }

// GET /work/:id: whether owlit still waits for this work item's answer (the attempt is the one out, and
// its paper still has no PDF). The extension asks before each fetch it makes for the item in a tab, and
// before handing over a PDF: the paper may have got its PDF meanwhile (the user opened the page and the
// extension took it). An owlit that knows no such route answers 404, which counts as still waiting.
export interface WorkWanted {
  wanted: boolean
}

// POST /work/blocked: a page the user opened at a wait for a check or a sign-in shows the site's firewall
// blocking them; the wait is for a way past the block instead, with that page to open. { host, url } as
// WorkResume's { host }.
export type WorkBlocked = { wait: WaitId; url: string } | { host: string; url: string }

// ---- Downloading by hand, one paper at a time

// Where the walk through the papers to download by hand stands (extension.walk): owlit holds it, one at
// a time, and the extension shows it in the tab it opened for it. paper: the one to download now, at its
// page; n of total, counting from 1; saved: how many of the walk's papers have their PDF now. done: the
// walk ended, with how many were saved; owlit forgets it then.
export type WalkStep = { kind: "paper"; paperId: string; url: string; n: number; total: number; saved: number } | { kind: "done"; saved: number; total: number }

// GET /walk: the step now, or null when no walk is on. A paper that got its PDF meanwhile (in the walk's
// tab, or any other way) is passed over.
export interface WalkAnswer {
  step: WalkStep | null
}

// POST /walk/next: on from this paper (Next paper), or, with skip, after noting that the user found no
// PDF on its page. A paper that isn't the walk's now (a press that came twice) moves nothing.
export interface WalkNext {
  paperId: string
  skip?: boolean
}
