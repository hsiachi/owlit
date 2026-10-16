// What the machine offers core beyond plain Node. The desktop app passes Electron's versions; tests
// and, later, the CLI pass their own or nothing.
export interface Host {
  // Moves a file or folder to the system Trash
  trash?(absolutePath: string): Promise<void>
  // Opens a file in the system's app for it
  openPath?(absolutePath: string): Promise<void>
  // Shows a file or folder in the system's file manager (Finder), selected
  revealPath?(absolutePath: string): void
  // fetch that goes the way the system's network goes (its proxy settings, its certificates). Node's
  // own fetch ignores both; Electron's net.fetch follows them.
  fetch?: typeof fetch
  // How the system's network would reach a URL, as a PAC script answers ("PROXY host:port; DIRECT"):
  // agents and npm are told it in their environment (agents/proxy.ts)
  resolveProxy?(url: string): Promise<string>
  // A real browser session (the desktop app's hidden window) for publishers that want cookies, a
  // passed challenge or a library login before they hand over a PDF
  browser?: BrowserHost
  // Seals keys before they are written to settings.json (the desktop app: the system keychain). Without
  // one, keys are written as they are.
  secrets?: SecretBox
  // The system's preferred languages, most preferred first (BCP 47): what digests are written in
  // until Settings says otherwise
  languages?(): string[]
  // Opens a web page in the user's own browser; in the background, the browser stays behind owlit
  openExternal?(url: string, options?: { background?: boolean }): Promise<void>
  // The user's own browser: its name ("Safari"), and bringing it to the front as it is
  browserName?(): Promise<string | undefined>
  showBrowser?(): Promise<void>
  // The user's own browser driven by its scripting, for browsers that have it (Dia, Chrome, Edge,
  // Brave); undefined for others, or when the user didn't let owlit control it
  browserControl?(): Promise<BrowserControl | undefined>
  // The folder the user's browser saves downloads to
  downloadsDir?(): string
  // Owlit's own updates (the desktop app: electron-updater on GitHub Releases)
  updater?: UpdaterHost
}

// What fetches, downloads and installs a newer Owlit. core/updates decides when.
export interface UpdaterHost {
  // Why this copy can't update itself, when it can't: it isn't signed with the Developer ID, or it runs
  // from somewhere it can't replace itself (a dmg, a copy macOS moved aside)
  blocked?(): Promise<"unsigned" | "location" | undefined>
  // Asks the feed. A newer version starts downloading at once and is returned; undefined when this one
  // is the newest. Rejects when the feed can't be read.
  check(): Promise<string | undefined>
  // The download a check started: how far (0–100), done, or failed
  onProgress(listener: (percent: number) => void): void
  onDownloaded(listener: (version: string) => void): void
  onError(listener: (error: Error) => void): void
  // Quits Owlit and puts the downloaded version in place, then starts it
  install(): void
}

// The user's browser, as owlit drives it for a run: a window of its own, tabs in it, and where each tab
// is now. Nothing here brings the browser to the front except focusTab. Each call rejects when the
// browser won't answer (the user said no to owlit controlling it); a window or tab that is gone is
// undefined, not an error.
export interface BrowserControl {
  // A new window behind whatever is in front; its id
  openWindow(): Promise<string>
  // A tab at url in that window, the window's own empty tab closed the first time; its id, or undefined
  // when the window is gone
  openTab(window: string, url: string): Promise<string | undefined>
  // Where the tab is now: its address and title; undefined once it is closed
  tab(window: string, tab: string): Promise<{ url: string; title: string } | undefined>
  closeTab(window: string, tab: string): Promise<void>
  // The browser to the front at this tab
  focusTab(window: string, tab: string): Promise<void>
}

export interface SecretBox {
  // Both throw when the keychain can't be used; open also when the text was sealed elsewhere
  seal(plain: string): string
  open(sealed: string): string
}

export interface BrowserHost {
  // Opens the landing page (as a reader would), then opens the PDF from it and saves what comes back.
  // Rejects with a sentence when the page gives no PDF; with NeedsUser when, nobody looking, the page
  // wants a person and didn't move on by itself; with Refused when a site asks again after it was passed.
  fetchPdf(request: BrowserRequest): Promise<Uint8Array>
  // Shows the window at a page for the user to sign in on (the library proxy); resolves when they close it
  showLogin(url: string): Promise<void>
}

export interface BrowserRequest {
  landing: string
  // The PDF's address; without one, the page's citation_pdf_url, or its own link labelled PDF, is used
  pdf?: string
  // Through a proxy: fetch the PDF's path on the host the page settled on (the proxy's rewrite of it)
  pdfOnPageHost?: boolean
  // Through a proxy: the proxy's own host, where a page that stays is its sign-in, not the article
  proxyHost?: string
  // The hosts the page may visit while nobody is looking (publisher, doi.org, the proxy)
  allowHosts: string[]
  // Sites (registrable domains) the page may not go on to: one that just asked for a person, which the
  // library proxy would only lead back to
  avoidSites?: string[]
  signal: AbortSignal
  // What happened on the way, for publisher-log.jsonl
  report?(event: BrowserEvent): void
}

// One step of a browser run, as the log keeps it: how often sites ask, and whether it passes
export type BrowserEvent =
  | { kind: "opened"; host: string; status?: number }
  // A check (or a sign-in) is on the page
  | { kind: "asked"; host: string; reason: PublisherNeed }
  | { kind: "cleared"; host: string; by: "itself" }
  // The check came back after it had cleared
  | { kind: "back"; host: string }
  | { kind: "pdf"; host: string; bytes: number }

export type PublisherNeed = "login" | "challenge"

// The publisher's page wants a person (a check, a sign-in): the user's own browser is the way
export class NeedsUser extends Error {
  readonly reason: PublisherNeed
  // The host whose page wanted them: the browser's session is shared, so getting past it once is
  // getting past it for every paper it holds
  readonly host?: string
  constructor(reason: PublisherNeed, host?: string) {
    super(reason === "login" ? "The publisher wants you to sign in." : "The publisher wants to check this is a person.")
    this.name = "NeedsUser"
    this.reason = reason
    this.host = host
  }
}

// What the page showed when it gave no PDF, for telling no access from a page with no link on it
// (library/where-it-ended.ts, pageVerdict): where it ended, its title, the main page's status, and
// whether it shows an offer to buy or to get access (a "Get Access" or "Purchase" button on screen)
export interface PageSeen {
  url: string
  title: string
  status?: number
  offersAccess: boolean
}

// The publisher's page gave no PDF; seen is the page it ended on
export class NoPdfOnPage extends Error {
  readonly seen: PageSeen
  constructor(message: string, seen: PageSeen) {
    super(message)
    this.name = "NoPdfOnPage"
    this.seen = seen
  }
}
