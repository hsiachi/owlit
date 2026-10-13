// The browser core uses for publishers that hand a PDF only to a real browser, in one persistent
// session (cookies and library logins survive restarts). Nobody looking, it works in a window that is
// never shown and only visits the hosts it was told about; a page that wants a person ends that run
// (core notes it for Check now). With the user there, the page shows inside owlit's own window, in the
// room the renderer reserved for it, and waits for them.
//
// It goes about it as a reader would, so sites have no reason to take it for a script: the PDF is
// opened from the article page, as a click on its link opens it, and saved from that one response;
// a site that asks for a person and asks again once that was done is left alone (2026-10-13: Cloudflare
// in front of ScienceDirect and the ACM put up a new check every time the old one was passed, five
// times in one Check now).

import { t } from "@lingui/core/macro"
import { NeedsUser, pdfLinkOn, Refused, siteOf, type BrowserHost, type BrowserRequest } from "@owlit/core"
import { app, BrowserWindow, session as electronSession, WebContentsView, type DownloadItem, type Rectangle, type WebContents } from "electron"
import { readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const PARTITION = "persist:owlit-browser"
const LOAD_TIMEOUT_MS = 60_000
// Nobody looking: how long a check may take to pass by itself (Cloudflare's often does)
const SETTLE_MS = 20_000
// With the user: how long the page may be out of sight (the renderer reloaded, the paper was left
// without a goodbye) before the run gives up on them
const AWAY_MS = 30_000
// A page without citation_pdf_url: how long its own PDF link may take to appear
const PDF_LINK_WAIT_MS = 15_000
// Opening the PDF: how long the page may stay put without a download starting before it counts as no
// PDF, and how long the download itself may take
const PDF_QUIET_MS = 4_000
const PDF_START_MS = 30_000
const PDF_DOWNLOAD_MS = 180_000
const MAX_PDF_BYTES = 200 * 1024 * 1024

// Cloudflare and the like put these in the title or the page. Only the interstitial's own markers:
// Cloudflare loads /cdn-cgi/challenge-platform/ scripts on ordinary article pages too and sets
// window._cf_chl_opt there (T&F's article pages, 2026-10-13), and pages embed invisible Turnstile
// widgets (cf-chl-widget-…) in their forms (doi.org's error page does)
const CHALLENGE_TITLE = /just a moment|attention required|security check|checking your browser|are you a robot|请稍候|正在验证|verify you are human/i
// A captcha or a password field only counts when it is on screen; publishers load reCAPTCHA scripts
// and hidden sign-in forms on ordinary pages. One small look per poll, not a copy of the page.
const VISIBLE = `(e) => { const r = e.getBoundingClientRect(); return r.width > 30 && r.height > 10 }`
const PAGE_PROBE = `(() => {
  const visible = ${VISIBLE}
  return {
    challenge: !!(document.getElementById("challenge-form") || document.querySelector(".cf-browser-verification")),
    captcha: [...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, #captcha')].some(visible),
    password: [...document.querySelectorAll("input[type=password]")].some(visible),
  }
})()`

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
  // The hosts the hidden window may visit in the current run, the sites it may not go on to, and the
  // last host it was kept from
  let allowed: string[] = []
  let avoided: string[] = []
  let stopped: { host: string; avoided: boolean } | undefined

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
  // Downloads go to the run working in that page; one nobody waits for isn't saved
  const downloads = new Map<number, (item: DownloadItem) => void>()
  let sessionReady = false

  const prepareSession = () => {
    if (sessionReady) return
    sessionReady = true
    const ses = electronSession.fromPartition(PARTITION)
    // A PDF the page opens is saved, not shown: the response a click on its link gets, taken as it comes
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders ?? {}
      const type = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1]?.[0] ?? ""
      if (details.resourceType !== "mainFrame" || !/application\/(pdf|x-pdf)/i.test(type)) return callback({})
      const kept = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-disposition"))
      callback({ responseHeaders: { ...kept, "Content-Disposition": ["attachment"] } })
    })
    ses.on("will-download", (event, item, contents) => {
      const take = contents ? downloads.get(contents.id) : undefined
      if (take) take(item)
      else event.preventDefault()
    })
  }

  // The PDF this page downloads during a run, whoever started it (owlit, or the user clicking the
  // page's own link during Check now)
  function catchPdf(contents: WebContents) {
    let resolve!: (bytes: Uint8Array) => void
    const pdf = new Promise<Uint8Array>((r) => (resolve = r))
    const items = new Set<DownloadItem>()
    let got = false
    downloads.set(contents.id, (item) => {
      if (got) return item.cancel()
      items.add(item)
      const file = path.join(os.tmpdir(), `owlit-pdf-${process.pid}-${Date.now()}-${items.size}`)
      item.setSavePath(file)
      item.on("updated", () => {
        if (item.getReceivedBytes() > MAX_PDF_BYTES) item.cancel()
      })
      item.once("done", async (_event, state) => {
        const bytes = state === "completed" ? await readFile(file).catch(() => undefined) : undefined
        await rm(file, { force: true }).catch(() => undefined)
        items.delete(item)
        if (bytes && isPdf(bytes) && !got) {
          got = true
          resolve(new Uint8Array(bytes))
        }
      })
    })
    return {
      pdf,
      // A download is under way, or one gave the PDF
      busy: () => got || items.size > 0,
      dispose() {
        if (downloads.get(contents.id)) downloads.delete(contents.id)
        for (const item of items) item.cancel()
      },
    }
  }

  const hiddenWindow = () => {
    if (hidden && !hidden.isDestroyed()) return hidden
    hidden = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      title: t({ message: "Owlit · Publisher", comment: "title of the window that shows a publisher's or library's sign-in page" }),
      // Never shown, so Chromium would slow its timers to a crawl: a check's script runs at its own pace
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false },
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
      if (!host) return
      const avoid = avoided.includes(siteOf(host))
      if (avoid || !allowed.some((h) => host === h || (h.startsWith(".") ? host.endsWith(h) : host.endsWith(`.${h}`)))) {
        stopped = { host, avoided: avoid }
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
    prepareSession()
    let contents: WebContents
    if (request.withUser) {
      active = true
      wentAway = false
      contents = shownView().webContents
    } else {
      contents = hiddenWindow().webContents
      allowed = request.allowHosts
      avoided = request.avoidSites ?? []
    }
    stopped = undefined
    // OWLIT_LOG_BROWSER: where a run's time goes
    const started = Date.now()
    const trace = (step: string) => process.env.OWLIT_LOG_BROWSER && console.log(`[publisher] +${((Date.now() - started) / 1000).toFixed(1)}s ${step} ${contents.getURL()}`)
    const run: Run = { asked: request.askedSites ?? new Set(), cleared: new Set() }
    // The run's own signal: ended once the PDF is in, however it came
    const done = new AbortController()
    const signal = AbortSignal.any([request.signal, done.signal])
    const steps: BrowserRequest = { ...request, signal }
    const abort = () => contents.stop()
    signal.addEventListener("abort", abort, { once: true })
    const opened = (_event: Electron.Event, url: string, status: number) => request.report?.({ kind: "opened", host: hostOf(url), status })
    contents.on("did-navigate", opened)
    const caught = catchPdf(contents)
    const steered = (async () => {
      // A redirect the guard stopped fails the load with a bare ERR_FAILED; say where it was going
      await load(contents, request.landing, steps).catch((error: Error) => {
        if (stopped?.avoided) throw new Error(`The library proxy led straight back to ${stopped.host}, which had just asked for a person.`)
        throw stopped ? new Error(`${hostOf(request.landing)} sent the page on to ${stopped.host}, which owlit doesn't open unattended.`) : error
      })
      trace("opened")
      await waitUntilClear(contents, steps, run)
      trace("clear")
      if (caught.busy()) return caught.pdf
      const pdfUrl = await pdfAddress(contents, steps)
      if (!pdfUrl) throw new Error("The publisher's page doesn't link a PDF.")
      trace(`opening ${pdfUrl}`)
      return openPdf(contents, pdfUrl, steps, run, caught)
    })()
    // A run that lost the race keeps going until its signal says stop: its failure is nobody's news
    steered.catch(() => undefined)
    try {
      const bytes = await Promise.race([caught.pdf, steered])
      request.report?.({ kind: "pdf", host: hostOf(contents.getURL()) || hostOf(request.landing), bytes: bytes.length })
      return bytes
    } finally {
      done.abort()
      signal.removeEventListener("abort", abort)
      contents.off("did-navigate", opened)
      caught.dispose()
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

  // Opens the PDF from the page, as its link would, and waits for what comes back to be saved. A check
  // in the way is met once; a page that is plainly no PDF isn't asked again.
  async function openPdf(contents: WebContents, url: string, request: BrowserRequest, run: Run, caught: ReturnType<typeof catchPdf>) {
    const referrer = contents.getURL()
    const open = () => void contents.loadURL(url, { httpReferrer: referrer }).catch(() => undefined)
    open()
    let bytes = await pdfWithin(contents, request, caught)
    if (!bytes && (await pageState(contents, request)) !== "ok") {
      await waitUntilClear(contents, request, run)
      // Past a check the page usually asks for the PDF again by itself; if not, it is opened once more
      bytes = await pdfWithin(contents, request, caught)
      if (!bytes) {
        open()
        bytes = await pdfWithin(contents, request, caught)
      }
      // A check back again ends the run here (NeedsUser, Refused)
      if (!bytes) await waitUntilClear(contents, request, run)
    }
    if (!bytes) throw new Error(`${hostOf(url)} didn't give a PDF to this reader.`)
    return bytes
  }

  // A check or a sign-in: nobody looking, give it a moment to pass by itself and otherwise end the run;
  // with the user there, wait for them. Either way a check that comes back once it was passed is
  // final: waiting or asking again only repeats it.
  async function waitUntilClear(contents: WebContents, request: BrowserRequest, run: Run) {
    for (let round = 0; round < 3; round++) {
      request.signal.throwIfAborted()
      const state = await pageState(contents, request)
      if (state === "ok") return
      const host = hostOf(contents.getURL())
      const site = siteOf(host)
      request.report?.({ kind: "asked", host, reason: state })
      if (!request.withUser) {
        if (run.cleared.has(site)) {
          request.report?.({ kind: "back", host })
          throw new NeedsUser(state, host)
        }
        await untilClear(contents, request, SETTLE_MS).catch((error) => {
          if (request.signal.aborted) throw error
          throw new NeedsUser(state, host)
        })
        run.cleared.add(site)
        request.report?.({ kind: "cleared", host, by: "itself" })
        await settle(contents, request)
        continue
      }
      // The page out of sight too long ends the run; core keeps the note for the next Check now
      if (wentAway) throw new NeedsUser(state, host)
      // A sign-in may take several pages; a check asked of the user once is enough
      if (state === "challenge" && run.asked.has(site)) {
        request.report?.({ kind: "back", host })
        throw new Refused(host)
      }
      if (state === "challenge") run.asked.add(site)
      let left: () => void = () => {}
      const gone = new Promise<never>((_, reject) => (left = () => reject(new NeedsUser(state, host))))
      away.add(left)
      try {
        await request.needUser(
          state,
          state === "login" ? t`Sign in to the library or publisher on the page.` : t`The publisher wants to check this is a person.`,
          Promise.race([untilClear(contents, request), gone]),
        )
      } finally {
        away.delete(left)
      }
      request.report?.({ kind: "cleared", host, by: "user" })
      // Past the check the page goes on to the article: let it arrive before looking for the PDF
      // (2026-10-11: read the moment the user got through, a SAGE page had no PDF link)
      await settle(contents, request)
    }
    const state = await pageState(contents, request)
    if (state === "ok") return
    const host = hostOf(contents.getURL())
    throw request.withUser && state === "challenge" ? new Refused(host) : new NeedsUser(state, host)
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
function untilClear(contents: WebContents, request: BrowserRequest, timeoutMs?: number) {
  const { signal } = request
  return new Promise<void>((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => finish(new Error("The page didn't move on.")), timeoutMs) : undefined
    let clear = 0
    const poll = setInterval(async () => {
      if (contents.isDestroyed()) return finish(new Error("The page went away."))
      clear = (await pageState(contents, request)) === "ok" ? clear + 1 : 0
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

async function load(contents: WebContents, url: string, request: BrowserRequest) {
  await Promise.race([
    contents.loadURL(url).catch((error: Error) => {
      // A redirect the guard stopped, or a download, still leaves a page to look at
      if (!/ERR_ABORTED|ERR_BLOCKED/.test(error.message)) throw error
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${hostOf(url)} took too long to open.`)), LOAD_TIMEOUT_MS)),
  ])
  await settle(contents, request)
}

// Some pages send the reader on by script once loaded (Elsevier's linkinghub to ScienceDirect): wait
// until the page has stayed put for a moment, ten seconds at most
// (a cancelled run stops waiting)
async function settle(contents: WebContents, request: BrowserRequest) {
  const { signal } = request
  const until = Date.now() + 10_000
  let url = contents.getURL()
  while (Date.now() < until && !contents.isDestroyed() && !signal.aborted) {
    // A check or a sign-in won't turn into the article while this waits: hand it to waitUntilClear at
    // once, so the line above the page says what it wants
    if ((await pageState(contents, request)) !== "ok") return
    await new Promise((r) => setTimeout(r, 1500))
    if (contents.isDestroyed() || signal.aborted) return
    const now = contents.getURL()
    // isLoadingMainFrame, not isLoading: a page's own late requests (Wiley's) never end
    if (now === url && !contents.isLoadingMainFrame()) return
    url = now
  }
}

async function pageState(contents: WebContents, request: BrowserRequest): Promise<PageState> {
  if (contents.isDestroyed()) return "ok"
  if (onProxySignIn(contents.getURL(), request)) return "login"
  const title = contents.getTitle()
  const probe = await contents.executeJavaScript(PAGE_PROBE, true).catch(() => ({ challenge: false, captcha: false, password: false }))
  if (CHALLENGE_TITLE.test(title) || probe.challenge || probe.captcha) return "challenge"
  if (probe.password) return "login"
  return "ok"
}

// Through the library proxy, a page still on the proxy's own entry (or a login path on its host) is its
// sign-in, not the article: signed out, Tsinghua's tlink answers /go?url= with a gateway page of
// sign-in buttons and no password field, and the PDF's path rebased onto it is no PDF (2026-10-12)
function onProxySignIn(url: string, request: BrowserRequest) {
  if (!request.proxyHost) return false
  let at: URL, entry: URL
  try {
    at = new URL(url)
    entry = new URL(request.landing)
  } catch {
    return false
  }
  if (at.hostname !== request.proxyHost) return false
  return (entry.hostname === at.hostname && entry.pathname === at.pathname) || /log-?in|sign-?in|sso|\/cas\b/i.test(at.pathname)
}

// The PDF's address on this page: the one asked for (rebased onto a proxy's host), citation_pdf_url, or
// the page's own PDF link
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
  // A page that builds itself by script (APA PsycNet) has its PDF link only seconds after it loaded:
  // look again for a while before saying it has none
  const until = Date.now() + PDF_LINK_WAIT_MS
  for (;;) {
    if (contents.isDestroyed() || request.signal.aborted) return undefined
    const found = await contents.executeJavaScript(`document.querySelector('meta[name="citation_pdf_url"]')?.content ?? null`, true).catch(() => null)
    if (typeof found === "string" && found) return new URL(found, contents.getURL()).toString()
    const links = await contents
      .executeJavaScript(`[...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent ?? "", href: a.href }))`, true)
      .catch(() => [])
    const link = pdfLinkOn(contents.getURL(), Array.isArray(links) ? links : [])
    if (link || Date.now() >= until) return link
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// The PDF the page is downloading, once it is in; undefined when the page settled without starting one
async function pdfWithin(contents: WebContents, request: BrowserRequest, caught: { pdf: Promise<Uint8Array>; busy(): boolean }) {
  const until = Date.now() + PDF_START_MS
  let url = contents.getURL()
  let quietSince = Date.now()
  while (Date.now() < until && !contents.isDestroyed()) {
    request.signal.throwIfAborted()
    if (caught.busy()) {
      return Promise.race([
        caught.pdf,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The PDF took too long to download.")), PDF_DOWNLOAD_MS)),
      ])
    }
    await new Promise((r) => setTimeout(r, 500))
    const now = contents.getURL()
    if (now !== url || contents.isLoadingMainFrame()) {
      url = now
      quietSince = Date.now()
    } else if (Date.now() - quietSince >= PDF_QUIET_MS) break
  }
  return caught.busy() ? caught.pdf : undefined
}

// What one run has seen: sites whose check the user was asked to pass, and checks that passed by
// themselves
interface Run {
  asked: Set<string>
  cleared: Set<string>
}

const isPdf = (bytes: Uint8Array) => bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-"

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}
