import { shell } from "electron"
import { execFile } from "node:child_process"

// A page opened in the browser the owlit extension was paired in: the user's sign-in has to happen where
// the extension and their access are, which needn't be the default browser. macOS opens an app by its
// bundle id: the one core saw the extension's requests come from (core extension/browser-app.ts), else
// the one for the name the extension gives itself (apps/extension/src/lib/browser-name.ts). Elsewhere,
// and for a browser known neither way, the default browser opens it.
const BUNDLE_IDS: Record<string, string> = {
  Chrome: "com.google.Chrome",
  Edge: "com.microsoft.edgemac",
  Brave: "com.brave.Browser",
  Arc: "company.thebrowser.Browser",
  Dia: "company.thebrowser.dia",
  Vivaldi: "com.vivaldi.Vivaldi",
  Opera: "com.operasoftware.Opera",
  Chromium: "org.chromium.Chromium",
  Firefox: "org.mozilla.firefox",
  Safari: "com.apple.Safari",
}

export async function openInBrowser(url: string, browser: { app?: string; name?: string }) {
  // `open` runs whatever a file: or custom-scheme link names; core only means web pages here
  if (!/^https?:\/\//i.test(url)) throw new Error(`Not a web page: ${url}`)
  // open fails when the app isn't installed under that id: then the default browser
  if (await openApp(browser, [url])) return
  await shell.openExternal(url)
}

// The browser brought to the front, for a page its extension opens. Only macOS is done: elsewhere the
// extension's own window focus is all there is
export async function showBrowser(browser: { app?: string; name?: string }) {
  await openApp(browser, [])
}

function openApp(browser: { app?: string; name?: string }, args: string[]) {
  const bundle = browser.app ?? (browser.name && BUNDLE_IDS[browser.name])
  if (process.platform !== "darwin" || !bundle) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => execFile("open", ["-b", bundle, ...args], (error) => resolve(!error)))
}
