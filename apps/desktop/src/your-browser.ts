// The user's own browser driven by AppleScript, for runs that get PDFs there (core's papers.fromBrowser):
// a window for the run, tabs in it, where each tab is now, and closing or focusing one. Nothing here
// activates the browser except focusTab, so a run goes on behind whatever the user is doing (in Dia,
// neither a new window nor a new tab comes to the front).
//
// Two dialects: Dia's, and Chrome's, which Edge and Brave share. Only Dia's was tried; the others follow
// Chrome's published dictionary. Any other browser (Safari, Arc, Firefox) gets none, and core opens
// links as before. macOS asks the user once whether owlit may control the browser; a no makes every
// call reject, and core falls back to links for the rest of the run.

import type { BrowserControl } from "@owlit/core"
import { app } from "electron"
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

const DIALECTS: Record<string, "dia" | "chrome"> = {
  "company.thebrowser.dia": "dia",
  "com.google.Chrome": "chrome",
  "com.microsoft.edgemac": "chrome",
  "com.brave.Browser": "chrome",
}

// The default browser's control, if owlit knows how to drive it
export async function browserControl(): Promise<BrowserControl | undefined> {
  const info = await app.getApplicationInfoForProtocol("https://").catch(() => undefined)
  if (!info?.path) return undefined
  const bundle = await bundleId(info.path)
  const dialect = bundle ? DIALECTS[bundle] : undefined
  if (!bundle || !dialect) return undefined
  return dialect === "dia" ? dia(bundle) : chrome(bundle)
}

async function bundleId(appPath: string) {
  try {
    const { stdout } = await run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(appPath, "Contents", "Info.plist")])
    return stdout.trim()
  } catch {
    return undefined
  }
}

// One AppleScript, its result as text. A window or tab that isn't there (-1728, -1719) is undefined;
// anything else, such as the user not letting owlit control the browser (-1743), rejects.
async function script(source: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("osascript", ["-e", source], { timeout: 15_000 })
    return stdout.replace(/\n$/, "")
  } catch (error) {
    const message = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error)
    if (/-1728|-1719|Can’t get|Can't get/.test(message)) return undefined
    throw new Error(message.trim())
  }
}

// A string as an AppleScript literal
const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

// Address and title of a tab, one per line ("" for missing value)
const READ = `set u to URL of t
  if u is missing value then set u to ""
  set n to title of t
  if n is missing value then set n to ""
  return u & linefeed & n`

function parseTab(text: string | undefined) {
  if (text === undefined) return undefined
  const [url = "", ...rest] = text.split("\n")
  return { url, title: rest.join("\n") }
}

function dia(bundle: string): BrowserControl {
  const tell = (body: string) => script(`tell application id ${quote(bundle)}\n${body}\nend tell`)
  const win = (id: string) => `(first window whose id is ${quote(id)})`
  const tab = (w: string, t: string) => `(first tab of ${win(w)} whose id is ${quote(t)})`
  // Windows whose own empty tab was closed already
  const tidied = new Set<string>()
  return {
    async openWindow() {
      const id = await tell(`return id of (make new window)`)
      if (!id) throw new Error("Dia didn't make a window.")
      return id
    },
    async openTab(w, url) {
      const id = await tell(`set t to make new tab at end of tabs of ${win(w)} with properties {URL:${quote(url)}}
  return id of t`)
      if (id && !tidied.has(w)) {
        tidied.add(w)
        // The new window's own empty tab; pinned tabs show in every Dia window and stay
        await tell(`repeat with x in (tabs of ${win(w)})
    if (isPinned of x) is false and (id of x) is not ${quote(id)} then
      set u to URL of x
      if u is missing value or u is "" then close x
    end if
  end repeat`).catch(() => undefined)
      }
      return id
    },
    async tab(w, t) {
      return parseTab(await tell(`set t to ${tab(w, t)}\n  ${READ}`))
    },
    async closeTab(w, t) {
      await tell(`close ${tab(w, t)}`)
    },
    async focusTab(w, t) {
      await tell(`focus ${tab(w, t)}\n  activate`)
    },
  }
}

function chrome(bundle: string): BrowserControl {
  const tell = (body: string) => script(`tell application id ${quote(bundle)}\n${body}\nend tell`)
  const tidied = new Set<string>()
  return {
    async openWindow() {
      const id = await tell(`return id of (make new window)`)
      if (!id) throw new Error("The browser didn't make a window.")
      return id
    },
    async openTab(w, url) {
      const id = await tell(`set t to make new tab at end of tabs of window id ${Number(w)} with properties {URL:${quote(url)}}
  return id of t`)
      if (id && !tidied.has(w)) {
        tidied.add(w)
        await tell(`repeat with x in (tabs of window id ${Number(w)})
    if (id of x) is not ${Number(id)} and (URL of x starts with "chrome://newtab" or URL of x is "about:blank") then close x
  end repeat`).catch(() => undefined)
      }
      return id
    },
    async tab(w, t) {
      return parseTab(await tell(`set t to tab id ${Number(t)} of window id ${Number(w)}\n  ${READ}`))
    },
    async closeTab(w, t) {
      await tell(`close tab id ${Number(t)} of window id ${Number(w)}`)
    },
    async focusTab(w, t) {
      await tell(`set i to 0
  repeat with x in (tabs of window id ${Number(w)})
    set i to i + 1
    if (id of x) is ${Number(t)} then exit repeat
  end repeat
  set active tab index of window id ${Number(w)} to i
  set index of window id ${Number(w)} to 1
  activate`)
    },
  }
}
