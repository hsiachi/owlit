// What the machine offers core beyond plain Node. The desktop app passes Electron's versions; tests
// and, later, the CLI pass their own or nothing.
export interface Host {
  // Moves a file or folder to the system Trash
  trash?(absolutePath: string): Promise<void>
  // Opens a file in the system's app for it
  openPath?(absolutePath: string): Promise<void>
  // fetch that goes the way the system's network goes (its proxy settings, its certificates). Node's
  // own fetch ignores both; Electron's net.fetch follows them.
  fetch?: typeof fetch
  // A real browser session (the desktop app's hidden window) for publishers that want cookies, a
  // passed challenge or a library login before they hand over a PDF
  browser?: BrowserHost
}

export interface BrowserHost {
  // Opens the landing page (as a reader would), then fetches the PDF with that session's cookies.
  // Rejects with a sentence when the page gives no PDF.
  fetchPdf(request: BrowserRequest): Promise<Uint8Array>
  // Shows the window at a page for the user to sign in on (the library proxy); resolves when they close it
  showLogin(url: string): Promise<void>
}

export interface BrowserRequest {
  landing: string
  // The PDF's address; without one, the page's citation_pdf_url is used
  pdf?: string
  // Through a proxy: fetch the PDF's path on the host the page settled on (the proxy's rewrite of it)
  pdfOnPageHost?: boolean
  // The hosts the window may visit while nobody is looking (publisher, doi.org, the proxy)
  allowHosts: string[]
  signal: AbortSignal
  // The page needs the user (a challenge, a sign-in form). The window is shown; `settled` resolves when
  // the page moves on by itself, and needUser resolves once the task may go on.
  needUser(reason: "login" | "challenge", detail: string, settled: Promise<void>): Promise<void>
}
