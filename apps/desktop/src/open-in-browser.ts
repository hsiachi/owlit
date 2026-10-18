import { shell } from "electron"
import { execFile } from "node:child_process"

// A page opened in the browser the owlit extension was paired in, by the name the extension gives it
// (apps/extension/src/lib/browser-name.ts): the user's sign-in has to happen where the extension and
// their access are, which needn't be the default browser. macOS opens an app by its bundle id; elsewhere,
// and for a browser not listed here, the default browser opens it.
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

export async function openInBrowser(url: string, browser: string | undefined) {
  const bundle = browser && BUNDLE_IDS[browser]
  if (process.platform === "darwin" && bundle) {
    // open fails when the app isn't installed under that id: then the default browser
    const opened = await new Promise<boolean>((resolve) => execFile("open", ["-b", bundle, url], (error) => resolve(!error)))
    if (opened) return
  }
  await shell.openExternal(url)
}
