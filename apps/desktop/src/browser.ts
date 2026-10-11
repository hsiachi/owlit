// The browser core uses for publishers that hand a PDF only to a real browser, in one persistent
// session (cookies and library logins survive restarts). Nobody looking, it works in a window that is
// never shown and only visits the hosts it was told about; a page that wants a person ends that run
// (core notes it for Check now). With the user there, the page shows inside owlit's own window, in the
// room the renderer reserved for it, and waits for them.

import { NeedsUser, type BrowserHost, type BrowserRequest } from "@owlit/core"
import { app, BrowserWindow, session as electronSession, WebContentsView, type Rectangle, type WebContents } from "electron"

const PARTITION = "persist:owlit-browser"
const LOAD_TIMEOUT_MS = 60_000
// Nobody looking: how long a check may take to pass by itself (Cloudflare's often does)
const SETTLE_MS = 20_000
// With the user: how long the page may be out of sight (the renderer reloaded, the paper was left
// without a goodbye) before the run gives up on them
const AWAY_MS = 30_000

// Cloudflare and the like put these in the title or the page. Only the interstitial's own markers:
// Cloudflare loads /cdn-cgi/challenge-platform/ scripts on ordinary article pages too, and pages embed
// invisible Turnstile widgets (cf-chl-widget-…) in their forms (doi.org's error page does)
const CHALLENGE_TITLE = /just a moment|attention required|security check|checking your browser|are you a robot|请稍候|正在验证|verify you are human/i
const CHALLENGE_BODY = /cf-browser-verification|_cf_chl_opt|id="challenge-form"/i
// A captcha or a password field only counts when it is on screen; publishers load reCAPTCHA scripts
// and hidden sign-in forms on ordinary pages
const VISIBLE = `(e) => { const r = e.getBoundingClientRect(); return r.width > 30 && r.height > 10 }`
const VISIBLE_CAPTCHA = `[...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #captcha')].some(${VISIBLE})`
const VISIBLE_PASSWORD = `[...document.querySelectorAll('input[type=password]')].some(${VISIBLE})`

type PageState = "ok" | "challenge" | "login"

export interface PublisherBrowser extends BrowserHost {
  // Where the renderer of `owner` wants the page shown during Check now; null takes it away
  setView(owner: BrowserWindow, bounds: Rectangle | null): void
}

export function createBrowserHost(): PublisherBrowser {
  let hidden: BrowserWindow | null = null
  // Quitting closes it for real; otherwise its close handler would stop the app from quitting
  let quitting = false
  app.on("before-quit", () => {
    quitting = true
  })
  // The hosts the hidden window may visit in the current run, and the last one it was kept from
  let allowed: string[] = []
  let stopped: string | undefined

  // The page the user sees during Check now, and where it goes
  let view: WebContentsView | null = null
  let place: { owner: BrowserWindow; bounds: Rectangle } | null = null
  let shownIn: BrowserWindow | null = null
  // A Check now run is using the view
  let active = false
  // Told when the view has been out of sight for AWAY_MS during a run
  const away = new Set<() => void>()
  let awayTimer: ReturnType<typeof setTimeout> | undefined
  // The view stayed out of sight that long: a check or a sign-in asked for later in the run ends it too
  let wentAway = false
  // Windows whose page reloads take the view away
  const watched = new WeakSet<BrowserWindow>()

  const hiddenWindow = () => {
    if (hidden && !hidden.isDestroyed()) return hidden
    hidden = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      title: "Owlit · Publisher",
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    })
    // Closing it (the library proxy's sign-in) hides it: the session lives on
    hidden.on("close", (event) => {
      if (!quitting && !hidden?.isDestroyed()) {
        event.preventDefault()
        hidden?.hide()
        hidden?.emit("owlit-closed")
      }
    })
    const guard = (event: Electron.Event, url: string) => {
      if (hidden?.isVisible()) return
      const host = hostOf(url)
      if (host && !allowed.some((h) => host === h || (h.startsWith(".") ? host.endsWith(h) : host.endsWith(`.${h}`)))) {
        stopped = host
        event.preventDefault()
      }
    }
    hidden.webContents.on("will-navigate", guard)
    hidden.webContents.on("will-redirect", guard)
    // Pages don't open more windows
    hidden.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    return hidden
  }

  const shownView = () => {
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } })
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    }
    placeView()
    return view
  }

  // Puts the view where the renderer last asked, or takes it away
  function placeView() {
    if (!view) return
    const target = active && place && !place.owner.isDestroyed() ? place : null
    if (shownIn && shownIn !== target?.owner && !shownIn.isDestroyed()) shownIn.contentView.removeChildView(view)
    if (!target) {
      if (shownIn && process.env.OWLIT_LOG_BROWSER) console.log("[publisher-view] removed")
      shownIn = null
      if (active && !awayTimer && !wentAway) {
        awayTimer = setTimeout(() => {
          awayTimer = undefined
          wentAway = true
          away.forEach((tell) => tell())
        }, AWAY_MS)
      }
      return
    }
    clearTimeout(awayTimer)
    awayTimer = undefined
    wentAway = false
    if (shownIn !== target.owner) target.owner.contentView.addChildView(view)
    view.setBounds(target.bounds)
    shownIn = target.owner
    if (process.env.OWLIT_LOG_BROWSER) console.log("[publisher-view]", JSON.stringify(target.bounds))
  }

  async function fetchPdf(request: BrowserRequest): Promise<Uint8Array> {
    let contents: WebContents
    if (request.withUser) {
      active = true
      wentAway = false
      contents = shownView().webContents
    } else {
      contents = hiddenWindow().webContents
      allowed = request.allowHosts
    }
    stopped = undefined
    // OWLIT_LOG_BROWSER: where a run's time goes
    const started = Date.now()
    const trace = (step: string) => process.env.OWLIT_LOG_BROWSER && console.log(`[publisher] +${((Date.now() - started) / 1000).toFixed(1)}s ${step} ${contents.getURL()}`)
    const abort = () => contents.stop()
    request.signal.addEventListener("abort", abort, { once: true })
    try {
      // A redirect the guard stopped fails the load with a bare ERR_FAILED; say where it was going
      await load(contents, request.landing, request.signal).catch((error: Error) => {
        throw stopped ? new Error(`${hostOf(request.landing)} sent the page on to ${stopped}, which owlit doesn't open unattended.`) : error
      })
      trace("opened")
      await waitUntilClear(contents, request)
      trace("clear")
      const pdfUrl = await pdfAddress(contents, request)
      if (!pdfUrl) throw new Error("The publisher's page doesn't link a PDF.")
      let bytes = await fetchWithSession(pdfUrl, request.signal)
      // Some publishers check again at the PDF itself: open it in the page and look once more
      if (!isPdf(bytes)) {
        trace(`no PDF from ${pdfUrl}, opening it`)
        await load(contents, pdfUrl, request.signal).catch(() => undefined)
        await waitUntilClear(contents, request)
        bytes = await fetchWithSession(pdfUrl, request.signal)
      }
      if (!isPdf(bytes)) throw new Error(`${hostOf(pdfUrl)} didn't give a PDF to this reader.`)
      return bytes
    } finally {
      request.signal.removeEventListener("abort", abort)
      if (request.withUser) {
        active = false
        placeView()
        clearTimeout(awayTimer)
        awayTimer = undefined
        // Out of sight, the publisher's page would keep running its scripts until quit
        if (!contents.isDestroyed()) void contents.loadURL("about:blank").catch(() => undefined)
      }
    }
  }

  // A check or a sign-in: nobody looking, give it a moment to pass by itself and otherwise end the run;
  // with the user there, wait for them
  async function waitUntilClear(contents: WebContents, request: BrowserRequest) {
    for (let round = 0; round < 3; round++) {
      request.signal.throwIfAborted()
      const state = await pageState(contents)
      if (state === "ok") return
      if (!request.withUser) {
        await untilClear(contents, request.signal, SETTLE_MS).catch((error) => {
          if (request.signal.aborted) throw error
          throw new NeedsUser(state)
        })
        await settle(contents, request.signal)
        continue
      }
      // The page out of sight too long ends the run; core keeps the note for the next Check now
      if (wentAway) throw new NeedsUser(state)
      let left: () => void = () => {}
      const gone = new Promise<never>((_, reject) => (left = () => reject(new NeedsUser(state))))
      away.add(left)
      try {
        await request.needUser(
          state,
          state === "login" ? "Sign in to the library or publisher on the page." : "The publisher wants to check this is a person.",
          Promise.race([untilClear(contents, request.signal), gone]),
        )
      } finally {
        away.delete(left)
      }
      // Past the check the page goes on to the article: let it arrive before looking for the PDF
      // (2026-10-11: read the moment the user got through, a SAGE page had no PDF link)
      await settle(contents, request.signal)
    }
    const state = await pageState(contents)
    if (state !== "ok") throw request.withUser ? new Error("The publisher kept asking for a check.") : new NeedsUser(state)
  }

  return {
    fetchPdf,
    setView(owner, bounds) {
      place = bounds ? { owner, bounds } : null
      placeView()
      // A reload of owlit's page runs no goodbyes: take the view away when one starts
      if (!watched.has(owner)) {
        watched.add(owner)
        owner.webContents.on("did-start-navigation", (details) => {
          if (details.isMainFrame && !details.isSameDocument && place?.owner === owner) {
            place = null
            placeView()
          }
        })
      }
    },
    async showLogin(url) {
      const w = hiddenWindow()
      await w.loadURL(url).catch(() => undefined)
      w.show()
      w.focus()
      await new Promise<void>((resolve) => w.once("owlit-closed" as never, () => resolve()))
    },
  }
}

// Resolves once the page is clear on two checks in a row (past a redirect; not waiting on isLoading(),
// which some publishers' pages never leave), or rejects after `timeoutMs`
function untilClear(contents: WebContents, signal: AbortSignal, timeoutMs?: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => finish(new Error("The page didn't move on.")), timeoutMs) : undefined
    let clear = 0
    const poll = setInterval(async () => {
      if (contents.isDestroyed()) return finish(new Error("The page went away."))
      clear = (await pageState(contents)) === "ok" ? clear + 1 : 0
      if (clear >= 2) finish()
    }, 1000)
    const aborted = () => finish(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    function finish(error?: unknown) {
      clearTimeout(timer)
      clearInterval(poll)
      signal.removeEventListener("abort", aborted)
      if (error) reject(error)
      else resolve()
    }
  })
}

async function load(contents: WebContents, url: string, signal: AbortSignal) {
  await Promise.race([
    contents.loadURL(url).catch((error: Error) => {
      // A redirect the guard stopped, or a download, still leaves a page to look at
      if (!/ERR_ABORTED|ERR_BLOCKED/.test(error.message)) throw error
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${hostOf(url)} took too long to open.`)), LOAD_TIMEOUT_MS)),
  ])
  await settle(contents, signal)
}

// Some pages send the reader on by script once loaded (Elsevier's linkinghub to ScienceDirect): wait
// until the page has stayed put for a moment, ten seconds at most
// (a cancelled run stops waiting)
async function settle(contents: WebContents, signal: AbortSignal) {
  const until = Date.now() + 10_000
  let url = contents.getURL()
  while (Date.now() < until && !contents.isDestroyed() && !signal.aborted) {
    // A check or a sign-in won't turn into the article while this waits: hand it to waitUntilClear at
    // once, so the line above the page says what it wants
    if ((await pageState(contents)) !== "ok") return
    await new Promise((r) => setTimeout(r, 1500))
    if (contents.isDestroyed() || signal.aborted) return
    const now = contents.getURL()
    // isLoadingMainFrame, not isLoading: a page's own late requests (Wiley's) never end
    if (now === url && !contents.isLoadingMainFrame()) return
    url = now
  }
}

async function pageState(contents: WebContents): Promise<PageState> {
  if (contents.isDestroyed()) return "ok"
  const title = contents.getTitle()
  const probe = await contents
    .executeJavaScript(`({ html: document.documentElement.outerHTML.slice(0, 20000), captcha: ${VISIBLE_CAPTCHA}, password: ${VISIBLE_PASSWORD} })`, true)
    .catch(() => ({ html: "", captcha: false, password: false }))
  if (CHALLENGE_TITLE.test(title) || CHALLENGE_BODY.test(probe.html) || probe.captcha) return "challenge"
  if (probe.password) return "login"
  return "ok"
}

// The PDF's address on this page: the one asked for (rebased onto a proxy's host), or citation_pdf_url
async function pdfAddress(contents: WebContents, request: BrowserRequest) {
  const page = contents.getURL()
  if (request.pdf) {
    if (!request.pdfOnPageHost) return request.pdf
    const at = new URL(page)
    const pdf = new URL(request.pdf)
    pdf.protocol = at.protocol
    pdf.host = at.host
    return pdf.toString()
  }
  const found = await contents.executeJavaScript(`document.querySelector('meta[name="citation_pdf_url"]')?.content ?? null`, true).catch(() => null)
  return typeof found === "string" && found ? new URL(found, page).toString() : undefined
}

// The page's own session fetches it, cookies and all
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
