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
