// The hidden browser core uses for publishers that hand a PDF only to a real browser: one window in a
// persistent session (cookies and library logins survive restarts), out of sight unless a page needs
// the user. While hidden it only visits the hosts it was told about.

import type { BrowserHost, BrowserRequest } from "@owlit/core"
import { BrowserWindow, session as electronSession } from "electron"

const PARTITION = "persist:owlit-browser"
const LOAD_TIMEOUT_MS = 60_000
// How long a challenge or a sign-in may wait for the user
const USER_TIMEOUT_MS = 5 * 60_000

// Cloudflare and the like put these in the title or the page. Only the interstitial's own markers:
// Cloudflare loads /cdn-cgi/challenge-platform/ scripts on ordinary article pages too.
const CHALLENGE_TITLE = /just a moment|attention required|security check|checking your browser|请稍候|正在验证|verify you are human/i
const CHALLENGE_BODY = /cf-browser-verification|cf-chl-|_cf_chl_opt|id="challenge-form"/i
// A captcha only counts when it is on screen; publishers load reCAPTCHA scripts on ordinary pages
const VISIBLE_CAPTCHA = `[...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #captcha')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 30 && r.height > 30 })`

type PageState = "ok" | "challenge" | "login"

export function createBrowserHost(): BrowserHost {
  let win: BrowserWindow | null = null
  let allowed: string[] = []
  // A sign-in or challenge the user is looking at: navigation is theirs
  let userAtWindow = false

  const windowFor = () => {
    if (win && !win.isDestroyed()) return win
    win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      title: "owlit · Publisher",
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    })
    // Closing it hides it: the session lives on and the task watching it sees the user is done
    win.on("close", (event) => {
      if (!win?.isDestroyed()) {
        event.preventDefault()
        win?.hide()
        win?.emit("owlit-closed")
      }
    })
    const guard = (event: Electron.Event, url: string) => {
      if (userAtWindow) return
      const host = hostOf(url)
      if (host && !allowed.some((h) => host === h || (h.startsWith(".") ? host.endsWith(h) : host.endsWith(`.${h}`)))) event.preventDefault()
    }
    win.webContents.on("will-navigate", guard)
    win.webContents.on("will-redirect", guard)
    // Pages don't open more windows
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    return win
  }

  async function fetchPdf(request: BrowserRequest): Promise<Uint8Array> {
    const w = windowFor()
    allowed = request.allowHosts
    const abort = () => w.webContents.stop()
    request.signal.addEventListener("abort", abort, { once: true })
    try {
      await load(w, request.landing)
      await waitUntilClear(w, request)
      const pdfUrl = await pdfAddress(w, request)
      if (!pdfUrl) throw new Error("The publisher's page doesn't link a PDF.")
      let bytes = await fetchWithSession(pdfUrl, request.signal)
      // Some publishers check again at the PDF itself: open it in the window and look once more
      if (!isPdf(bytes)) {
        await load(w, pdfUrl).catch(() => undefined)
        await waitUntilClear(w, request)
        bytes = await fetchWithSession(pdfUrl, request.signal)
      }
      if (!isPdf(bytes)) throw new Error(`${hostOf(pdfUrl)} didn't give a PDF to this reader.`)
      return bytes
    } finally {
      request.signal.removeEventListener("abort", abort)
      if (!w.isDestroyed()) w.hide()
      userAtWindow = false
    }
  }

  // While the page shows a challenge or a sign-in form, the window is the user's
  async function waitUntilClear(w: BrowserWindow, request: BrowserRequest) {
    for (let round = 0; round < 3; round++) {
      request.signal.throwIfAborted()
      const state = await pageState(w)
      if (state === "ok") return
      userAtWindow = true
      w.show()
      w.focus()
      const settled = untilClear(w, state, request.signal)
      await request.needUser(
        state,
        state === "login" ? "Sign in to the library or publisher in the window that opened." : "The publisher wants to check this is a person.",
        settled,
      )
      userAtWindow = false
      w.hide()
    }
    if ((await pageState(w)) !== "ok") throw new Error("The publisher kept asking for a check.")
  }

  // Resolves once the page is past the challenge or the sign-in (or the user closed the window)
  function untilClear(w: BrowserWindow, from: PageState, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Gave up waiting for the ${from === "login" ? "sign-in" : "check"} after 5 minutes.`)), USER_TIMEOUT_MS)
      const poll = setInterval(async () => {
        if (w.isDestroyed()) return finish(new Error("The window went away."))
        if (!w.webContents.isLoading() && (await pageState(w)) === "ok") finish()
      }, 1000)
      const closed = () => finish()
      const aborted = () => finish(signal.reason)
      w.once("owlit-closed" as never, closed)
      signal.addEventListener("abort", aborted, { once: true })
      function finish(error?: unknown) {
        clearTimeout(timer)
        clearInterval(poll)
        w.removeListener("owlit-closed" as never, closed)
        signal.removeEventListener("abort", aborted)
        if (error) reject(error)
        else resolve()
      }
    })
  }

  return {
    fetchPdf,
    async showLogin(url) {
      const w = windowFor()
      userAtWindow = true
      await w.loadURL(url).catch(() => undefined)
      w.show()
      w.focus()
      await new Promise<void>((resolve) => w.once("owlit-closed" as never, () => resolve()))
      userAtWindow = false
    },
  }
}

async function load(w: BrowserWindow, url: string) {
  await Promise.race([
    w.loadURL(url).catch((error: Error) => {
      // A redirect the guard stopped, or a download, still leaves a page to look at
      if (!/ERR_ABORTED|ERR_BLOCKED/.test(error.message)) throw error
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${hostOf(url)} took too long to open.`)), LOAD_TIMEOUT_MS)),
  ])
}

async function pageState(w: BrowserWindow): Promise<PageState> {
  if (w.isDestroyed()) return "ok"
  const title = w.webContents.getTitle()
  const probe = await w.webContents
    .executeJavaScript(
      `({ html: document.documentElement.outerHTML.slice(0, 20000), captcha: ${VISIBLE_CAPTCHA}, password: !!document.querySelector('input[type=password]') })`,
      true,
    )
    .catch(() => ({ html: "", captcha: false, password: false }))
  if (CHALLENGE_TITLE.test(title) || CHALLENGE_BODY.test(probe.html) || probe.captcha) return "challenge"
  if (probe.password) return "login"
  return "ok"
}

// The PDF's address on this page: the one asked for (rebased onto a proxy's host), or citation_pdf_url
async function pdfAddress(w: BrowserWindow, request: BrowserRequest) {
  const page = w.webContents.getURL()
  if (request.pdf) {
    if (!request.pdfOnPageHost) return request.pdf
    const at = new URL(page)
    const pdf = new URL(request.pdf)
    pdf.protocol = at.protocol
    pdf.host = at.host
    return pdf.toString()
  }
  const found = await w.webContents
    .executeJavaScript(`document.querySelector('meta[name="citation_pdf_url"]')?.content ?? null`, true)
    .catch(() => null)
  return typeof found === "string" && found ? new URL(found, page).toString() : undefined
}

// The window's own session fetches it, cookies and all
async function fetchWithSession(url: string, signal: AbortSignal) {
  const ses = electronSession.fromPartition(PARTITION)
  const response = await ses.fetch(url, { signal })
  return new Uint8Array(await response.arrayBuffer())
}

const isPdf = (bytes: Uint8Array) => bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-"

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
