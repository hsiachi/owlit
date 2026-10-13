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
  // A real browser session (the desktop app's hidden window) for publishers that want cookies, a
  // passed challenge or a library login before they hand over a PDF
  browser?: BrowserHost
  // Seals keys before they are written to settings.json (the desktop app: the system keychain). Without
  // one, keys are written as they are.
  secrets?: SecretBox
  // The system's preferred languages, most preferred first (BCP 47): what reading notes are written in
  // until Settings says otherwise
  languages?(): string[]
  // Opens a web page in the user's own browser
  openExternal?(url: string): Promise<void>
  // The folder the user's browser saves downloads to
  downloadsDir?(): string
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
  // Sites (registrable domains) the page may not go on to while nobody is looking: one that just asked
  // for a person, which the library proxy would only lead back to
  avoidSites?: string[]
  // Sites that asked the user for a check or a sign-in in this run, shared by its routes: each site
  // asks once, and asking again means it won't let this browser through
  askedSites?: Set<string>
  signal: AbortSignal
  // The user asked to see the page (Check now): it shows where the app reserved room for it, and a
  // check or a sign-in waits for them instead of ending the run
  withUser?: boolean
  // With the user: the page wants them (a challenge, a sign-in form). `settled` resolves when the page
  // moves on, and needUser resolves once the task may go on.
  needUser(reason: PublisherNeed, detail: string, settled: Promise<void>): Promise<void>
  // What happened on the way, for publisher-log.jsonl
  report?(event: BrowserEvent): void
}

// One step of a browser run, as the log keeps it: how often sites ask, and whether it passes
export type BrowserEvent =
  | { kind: "opened"; host: string; status?: number }
  // A check (or a sign-in) is on the page
  | { kind: "asked"; host: string; reason: PublisherNeed }
  | { kind: "cleared"; host: string; by: "itself" | "user" }
  // The check came back after it had cleared
  | { kind: "back"; host: string }
  | { kind: "pdf"; host: string; bytes: number }

export type PublisherNeed = "login" | "challenge"

// The publisher's page wants a person (a check, a sign-in) and nobody was looking
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

// A site asked for a check again right after it was passed: it isn't letting this browser through for
// now, and asking the user once more would only repeat that
export class Refused extends Error {
  readonly host: string
  constructor(host: string) {
    super(`${host} kept asking for a check after it was passed.`)
    this.name = "Refused"
    this.host = host
  }
}
