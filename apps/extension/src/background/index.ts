import { t } from "@lingui/core/macro"
import type { ExtensionPaper, ExtensionStatus, PairAnswer, PairStarted, PaperAnswer, WorkAnswer } from "@owlit/protocol"
import { ext } from "../lib/browser.ts"
import { browserName } from "../lib/browser-name.ts"
import { startI18n } from "../lib/i18n.ts"
import { originsOf, type Answers, type Connection, type Outcome, type PageState, type PopupState, type Request } from "../lib/messages.ts"
import { ask, OwlitError, Unreachable } from "../lib/owlit.ts"
import { idsInUrl, paperOfPage, type PagePaper } from "../lib/page.ts"
import { hasKnownSites, notYetAllowed } from "../lib/permissions.ts"
import { contentTypeOf, isPdfResponse, takesPdfTab } from "../lib/pdf-tab.ts"
import { isThrough } from "../lib/verdict.ts"
import { doWork } from "../lib/work.ts"

// The extension's background (Chrome's service worker, Firefox's event page): the one place that talks to
// owlit and fetches with the user's cookies. The popup and the content script only ask it. Both browsers
// stop it when idle, so what must outlast that is in storage (the token and the setting in local, each
// tab's page in session) and listeners are added at the top level, where a restarted background finds
// them again.

startI18n()

// While owlit isn't running, a look every 30 s (the shortest alarm Chrome allows; Firefox would take
// shorter, but one pace for both) and at every tab switch
const RECONNECT = "reconnect"
// Badge marks: a Library paper without its PDF (warning), a PDF owlit took (owlit's green); DESIGN.md's
// tokens in sRGB, since a badge takes no oklch
const WAITING = "#b6873c"
const TAKEN = "#2f7a52"

interface Local {
  token?: string
  // "Take PDFs I open for papers in my Library"; unset is on
  takePdfs?: boolean
}
const local = () => ext.storage.local.get(["token", "takePdfs"]) as Promise<Local>
const takePdfsOn = async () => (await local()).takePdfs !== false

// ---- Being connected

let pairing: Promise<Connection> | null = null
let problem: "refused" | "expired" | "no-window" | undefined

async function connection(): Promise<Connection> {
  const { token } = await local()
  if (pairing) return { state: "pairing" }
  try {
    const status = await ask<ExtensionStatus>("/status", { token })
    void ext.alarms.clear(RECONNECT)
    keepAsking()
    return { state: "connected", workspace: status.workspace?.name ?? null }
  } catch (error) {
    if (error instanceof OwlitError && error.status === 401) {
      // Forgotten in owlit's Settings, or never paired
      if (token) await ext.storage.local.remove("token")
      return problem ? { state: "unpaired", problem } : { state: "unpaired" }
    }
    if (!(error instanceof Unreachable)) throw error
    if (token) void ext.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
    return { state: "offline", paired: !!token }
  }
}

// Asks owlit's window, then waits for the answer a while at a time; the popup may close meanwhile
function pair(): Promise<Connection> {
  pairing ??= (async () => {
    problem = undefined
    try {
      const started = await ask<PairStarted>("/pair", { json: { browser: browserName(), extensionVersion: ext.runtime.getManifest().version } })
      for (;;) {
        const answer = await ask<PairAnswer>(`/pair/${encodeURIComponent(started.pairing)}`)
        if (answer.state === "allowed") {
          await ext.storage.local.set({ token: answer.token })
          break
        }
        // A storage call between holds keeps Chrome from taking the worker for idle
        await ext.storage.session.set({ pairingSince: Date.now() })
      }
    } catch (error) {
      if (error instanceof OwlitError && (error.reason === "refused" || error.reason === "expired" || error.reason === "no-window")) problem = error.reason
      else if (!(error instanceof Unreachable)) console.error("[owlit] pairing failed", error)
    } finally {
      pairing = null
    }
    return connection()
  })()
  return pairing
}

// ---- Pages

const pageKey = (tabId: number) => `page:${tabId}`

async function rememberPage(tabId: number, page: Omit<PageState, "inLibrary">) {
  await ext.storage.session.set({ [pageKey(tabId)]: page })
}

async function pageOf(tabId: number): Promise<Omit<PageState, "inLibrary"> | null> {
  const tab = await ext.tabs.get(tabId).catch(() => undefined)
  if (!tab?.url || !/^https?:/.test(tab.url)) return null
  const kept = (await ext.storage.session.get(pageKey(tabId)))[pageKey(tabId)] as Omit<PageState, "inLibrary"> | undefined
  if (kept?.url === tab.url) return kept
  const host = new URL(tab.url).hostname
  // A site the content script doesn't run on: the popup's click lent the extension this tab (activeTab)
  try {
    const [result] = await ext.scripting.executeScript({ target: { tabId }, func: () => document.head?.outerHTML ?? "" })
    const page = { url: tab.url, host, pdfTab: false, paper: paperOfPage(String(result?.result ?? ""), tab.url) }
    await rememberPage(tabId, page)
    return page
  } catch {
    // The browser's PDF viewer runs no script: a PDF named by its address
    const ids = idsInUrl(tab.url)
    const pdfTab = (await pdfTabs()).has(tabId) || /\.pdf($|\?)|\/pdf\//i.test(new URL(tab.url).pathname)
    return { url: tab.url, host, pdfTab, paper: ids.doi || ids.arxiv ? { ...ids, authors: [] } : undefined }
  }
}

async function lookUp(page: { url: string; paper?: PagePaper }, token: string) {
  const query = new URLSearchParams()
  if (page.paper?.doi) query.set("doi", page.paper.doi)
  if (page.paper?.arxiv) query.set("arxiv", page.paper.arxiv)
  query.set("url", page.url)
  return (await ask<{ paper: ExtensionPaper | null }>(`/papers?${query}`, { token })).paper
}

// The toolbar button's mark for a tab: a Library paper there lacks its PDF
async function mark(tabId: number, page: { url: string; paper?: PagePaper }) {
  const { token } = await local()
  if (!token || !page.paper) return setBadge(tabId, "")
  const paper = await lookUp(page, token).catch(() => null)
  await setBadge(tabId, paper && !paper.hasPdf ? "•" : "", WAITING)
}

async function setBadge(tabId: number, text: string, color = WAITING) {
  await ext.action.setBadgeText({ tabId, text }).catch(() => undefined)
  if (text) await ext.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined)
}

// ---- The button's work

// The PDF at an address, fetched with the user's cookies (and, for a tab, from the browser's cache)
async function fetchPdf(url: string, cache: RequestCache = "default"): Promise<ArrayBuffer | undefined> {
  try {
    const response = await fetch(url, { credentials: "include", cache, redirect: "follow" })
    if (!response.ok) return undefined
    const bytes = await response.arrayBuffer()
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 5))
    return head === "%PDF-" ? bytes : undefined
  } catch {
    return undefined
  }
}

const failed = (error: unknown): Outcome => {
  if (error instanceof Unreachable) return { kind: "offline" }
  if (error instanceof OwlitError) {
    if (error.reason === "no-workspace") return { kind: "no-workspace" }
    if (error.reason === "not-paired") return { kind: "unpaired" }
    if (error.reason === "not-this-paper") return { kind: "not-this-paper" }
    if (error.reason === "has-pdf") return { kind: "has-pdf" }
    return { kind: "failed", message: error.message }
  }
  return { kind: "failed", message: String(error) }
}

// Where the page's PDF is: the address it names, or the tab itself when it shows one
const pdfAddress = (page: Omit<PageState, "inLibrary">) => page.paper?.pdfUrl ?? (page.pdfTab ? page.url : undefined)

async function putPdf(id: string, url: string, token: string): Promise<"saved" | "not-a-pdf" | "not-this-paper"> {
  const pdf = await fetchPdf(url)
  if (!pdf) return "not-a-pdf"
  try {
    await ask<PaperAnswer>(`/papers/${encodeURIComponent(id)}/pdf`, { method: "PUT", token, pdf })
    return "saved"
  } catch (error) {
    if (error instanceof OwlitError && error.reason === "not-this-paper") return "not-this-paper"
    throw error
  }
}

async function add(tabId: number): Promise<Outcome> {
  const { token } = await local()
  if (!token) return { kind: "unpaired" }
  const page = await pageOf(tabId)
  if (!page?.paper) return { kind: "failed", message: t`This page doesn't show a paper.` }
  try {
    const { paper } = await ask<PaperAnswer>("/papers", { token, json: { ...page.paper, url: page.url } })
    const address = pdfAddress(page)
    let pdf: "saved" | "none-named" | "not-a-pdf" | "not-this-paper" = "none-named"
    if (paper.hasPdf) pdf = "saved"
    else if (address) pdf = await putPdf(paper.id, address, token)
    await setBadge(tabId, pdf === "saved" ? "" : "•", WAITING)
    return { kind: "added", pdf, host: address ? new URL(address).hostname : page.host }
  } catch (error) {
    return failed(error)
  }
}

async function save(tabId: number): Promise<Outcome> {
  const { token } = await local()
  if (!token) return { kind: "unpaired" }
  const page = await pageOf(tabId)
  const address = page && pdfAddress(page)
  if (!page || !address) return { kind: "failed", message: t`This page names no PDF.` }
  try {
    const paper = await lookUp(page, token)
    if (!paper) return { kind: "failed", message: t`This paper isn't in your Library.` }
    if (paper.hasPdf) return { kind: "has-pdf" }
    const result = await putPdf(paper.id, address, token)
    if (result === "not-a-pdf") return { kind: "no-pdf", host: new URL(address).hostname }
    if (result === "not-this-paper") return { kind: "not-this-paper" }
    await setBadge(tabId, "")
    return { kind: "saved" }
  } catch (error) {
    return failed(error)
  }
}

// ---- PDF tabs, taken without a click

const pdfTabsKey = "pdfTabs"
const pdfTabs = async () => new Map(Object.entries(((await ext.storage.session.get(pdfTabsKey))[pdfTabsKey] ?? {}) as Record<string, string>).map(([k, v]) => [Number(k), v]))
// Taken already in this browser session, so a reload doesn't send it again
const takenKey = "taken"

// Seen only on sites the extension may read: those are the ones it can fetch again with cookies
ext.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return
    void (async () => {
      const tabs = await pdfTabs()
      if (isPdfResponse(details.url, contentTypeOf(details.responseHeaders))) tabs.set(details.tabId, details.url)
      else tabs.delete(details.tabId)
      await ext.storage.session.set({ [pdfTabsKey]: Object.fromEntries(tabs) })
    })()
  },
  { urls: ["https://*/*", "http://*/*"], types: ["main_frame"] },
  ["responseHeaders"],
)

async function takePdfTab(tabId: number, url: string) {
  const { token } = await local()
  const connected = !!token && (await connection()).state === "connected"
  const permitted = await ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] })
  if (!takesPdfTab({ url, contentType: "application/pdf" }, { connected, takePdfs: await takePdfsOn(), permitted })) return
  const taken = ((await ext.storage.session.get(takenKey))[takenKey] ?? []) as string[]
  if (taken.includes(url)) return
  await ext.storage.session.set({ [takenKey]: [...taken.slice(-200), url] })
  // From the cache: the tab has just loaded it
  const pdf = await fetchPdf(url, "force-cache")
  if (!pdf || !token) return
  try {
    const ids = idsInUrl(url)
    const named = ids.doi || ids.arxiv ? await lookUp({ url, paper: { ...ids, authors: [] } }, token) : null
    if (named?.hasPdf) return
    const { paper } = named
      ? await ask<PaperAnswer>(`/papers/${encodeURIComponent(named.id)}/pdf`, { method: "PUT", token, pdf })
      : await ask<PaperAnswer>("/pdfs", { method: "PUT", token, pdf })
    // Chrome's PDF viewer runs no content script, so the page can't say it: the system and the badge do
    void ext.notifications.create(`taken:${tabId}:${Date.now()}`, { type: "basic", iconUrl: ext.runtime.getURL("icons/128.png"), title: t`owlit took this PDF`, message: paper.title }).catch(() => undefined)
    await setBadge(tabId, "✓", TAKEN)
  } catch (error) {
    // Not a Library paper's, or another paper's: left alone
    if (!(error instanceof OwlitError)) console.error("[owlit] couldn't hand a PDF to owlit", error)
  }
}

ext.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url) return
  void (async () => {
    const pdfUrl = (await pdfTabs()).get(tabId)
    if (pdfUrl && pdfUrl === tab.url) await takePdfTab(tabId, pdfUrl)
    else await watchForThrough(tabId, tab.url!)
  })()
})

ext.tabs.onRemoved.addListener((tabId) => {
  void ext.storage.session.remove(pageKey(tabId))
})

// ---- Fetching for owlit

// Kept in session storage, so a restarted worker still knows where to watch
type Waits = WorkAnswer["waits"]
const waitsKey = "waits"
const waits = async () => ((await ext.storage.session.get(waitsKey))[waitsKey] ?? []) as Waits
// Restarts the asking if the worker was stopped meanwhile
const WORK = "work"

const permitted = (url: string) => ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] }).catch(() => false)

let asking: Promise<void> | null = null

// One GET /work at a time, held open by owlit until something is due; each paper it hands over is
// fetched beside it, at owlit's pace (owlit gives one per site at a time). Ends when owlit can't be
// reached or forgot this browser; the alarm or the next connection starts it again.
function keepAsking() {
  asking ??= (async () => {
    try {
      for (;;) {
        const { token } = await local()
        if (!token) return
        const answer = await ask<WorkAnswer>("/work", { token })
        // An extension call between holds also keeps Chrome from taking the worker for idle. Firefox may
        // still unload its event page between holds; the WORK alarm loads it and asks again
        await ext.storage.session.set({ [waitsKey]: answer.waits })
        for (const item of answer.work) {
          void doWork(item, { fetch: (url, init) => fetch(url, init), permitted, inTab, ask, token }).catch((error) => console.error("[owlit] couldn't fetch for owlit", error))
        }
      }
    } catch (error) {
      if (error instanceof OwlitError && error.status === 401) await ext.storage.local.remove("token")
      else if (error instanceof Unreachable) void ext.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
      else console.error("[owlit] asking owlit for work failed", error)
    } finally {
      asking = null
    }
  })()
}

// The page's HTML, as far as the verdict reads it; undefined when the extension may not read the tab
async function htmlOf(tabId: number): Promise<{ url: string; html: string } | undefined> {
  try {
    const [result] = await ext.scripting.executeScript({
      target: { tabId },
      func: () => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 500_000) }),
    })
    return result?.result as { url: string; html: string } | undefined
  } catch {
    return undefined
  }
}

// A fetch run inside an open tab at this host that is past its check (work.ts, FetchDeps.inTab). The
// page fetches with its own standing at the site; the bytes come back base64, since what a script in a
// tab returns must be plain data.
async function inTab(host: string): Promise<typeof fetch | undefined> {
  for (const tab of await ext.tabs.query({ url: [`https://${host}/*`, `http://${host}/*`] })) {
    if (tab.id === undefined) continue
    const seen = await htmlOf(tab.id)
    if (!seen || !isThrough({ url: seen.url, status: 0, html: seen.html })) continue
    const tabId = tab.id
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const [result] = await ext.scripting.executeScript({
        target: { tabId },
        args: [String(input), init?.redirect ?? "follow"],
        func: async (url: string, redirect: RequestRedirect) => {
          const response = await fetch(url, { credentials: "include", redirect })
          const bytes = new Uint8Array(await response.arrayBuffer())
          let binary = ""
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return { status: response.status, url: response.url, type: response.type, contentType: response.headers.get("content-type") ?? "", body: btoa(binary) }
        },
      })
      const got = result?.result as { status: number; url: string; type: string; contentType: string; body: string } | undefined
      if (!got) throw new TypeError("The tab went away")
      const body = Uint8Array.from(atob(got.body), (c) => c.charCodeAt(0))
      const response = new Response(got.status === 0 || got.status === 204 ? null : body, { status: got.status || 200, headers: { "content-type": got.contentType } })
      Object.defineProperty(response, "url", { value: got.url })
      return response
    }) as typeof fetch
  }
  return undefined
}

// The wait at a site this tab is on, if any: the site itself or a host under it (a proxy's rewritten
// publisher hosts are under the proxy's)
const waitAt = (all: Waits, host: string) => all.find((w) => w.kind !== "permission" && (host === w.host || host.endsWith(`.${w.host}`)))

async function resume(host: string) {
  const { token } = await local()
  if (!token) return
  await ask("/work/resume", { token, json: { host } })
  await ext.storage.session.set({ [waitsKey]: (await waits()).filter((w) => w.host !== host) })
}

// A page that finished loading at a site paused for a check or a sign-in: once it is neither, the user
// got through, and owlit goes on there. A check often finishes in the page it stands in (Cloudflare's
// swaps the article in without loading a new page), so the tab is looked at again for a while.
const THROUGH_LOOKS = 20
const THROUGH_EVERY_MS = 3000
const watching = new Set<number>()

async function watchForThrough(tabId: number, url: string) {
  if (!/^https?:/.test(url) || watching.has(tabId)) return
  const wait = waitAt(await waits(), new URL(url).hostname)
  if (!wait) return
  watching.add(tabId)
  try {
    for (let look = 0; look < THROUGH_LOOKS; look++) {
      if (look) await new Promise((resolve) => setTimeout(resolve, THROUGH_EVERY_MS))
      const tab = await ext.tabs.get(tabId).catch(() => undefined)
      // Gone, or gone elsewhere
      if (!tab?.url || !waitAt([wait], new URL(tab.url).hostname)) return
      const seen = await htmlOf(tabId)
      if (!seen) return
      const proxy = wait.proxied ? { host: wait.host } : undefined
      if (isThrough({ url: seen.url, status: 0, html: seen.html, proxy })) {
        await resume(wait.host).catch(() => undefined)
        return
      }
    }
  } finally {
    watching.delete(tabId)
  }
}

// ---- Staying connected

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT) void connection()
  if (alarm.name === WORK) keepAsking()
})
// Every time the worker starts: Chrome stops it when idle, and a stopped worker asks for no work
void ext.alarms.create(WORK, { periodInMinutes: 0.5 })
keepAsking()

ext.tabs.onActivated.addListener(() => {
  void (async () => {
    if (!(await local()).token) return
    const alarm = await ext.alarms.get(RECONNECT)
    if (alarm) await connection()
  })()
})

ext.runtime.onStartup.addListener(() => void connection())

// A site the user let the extension read from the popup: the content script runs there from then on, as
// on the publishers' sites the manifest lists
async function registerGranted() {
  const listed = new Set(ext.runtime.getManifest().content_scripts?.flatMap((c) => c.matches ?? []))
  const granted = ((await ext.permissions.getAll()).origins ?? []).filter((o) => /^https:\/\/[^*]/.test(o) && !listed.has(o))
  await ext.scripting.unregisterContentScripts({ ids: ["granted"] }).catch(() => undefined)
  if (granted.length) await ext.scripting.registerContentScripts([{ id: "granted", matches: granted, js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }])
}
const registered = () => void registerGranted().catch((error) => console.error("[owlit] couldn't run on the sites allowed", error))

// owlit's papers waiting for a site the extension may now read: owlit goes on there. Here as well as from
// the popup, since Firefox may close the popup while its permission question is open, and then the
// popup never sends its own "allowed".
async function resumePermitted() {
  for (const wait of (await waits()).filter((w) => w.kind === "permission")) {
    if (await ext.permissions.contains({ origins: originsOf(wait.host) }).catch(() => false)) await resume(wait.host).catch(() => undefined)
  }
}

ext.permissions.onAdded.addListener(() => {
  registered()
  void resumePermitted()
})
ext.permissions.onRemoved.addListener(registered)
ext.runtime.onInstalled.addListener(registered)

// ---- Messages

async function popupState(tabId: number): Promise<PopupState> {
  const [conn, takePdfs, knownSites] = await Promise.all([connection(), takePdfsOn(), hasKnownSites(ext.permissions, ext.runtime.getManifest())])
  const asked = conn.state === "connected" ? (await waits()).filter((w) => w.kind === "permission").map(({ host, papers }) => ({ host, papers })) : []
  const { needed: needs, allowed } = await notYetAllowed(ext.permissions, asked)
  for (const host of allowed) void resume(host).catch(() => undefined)
  const page = await pageOf(tabId)
  if (!page) return { connection: conn, page: null, takePdfs, knownSites, needs }
  const { token } = await local()
  const inLibrary = conn.state === "connected" && conn.workspace && token && (page.paper || page.pdfTab) ? await lookUp(page, token).catch(() => undefined) : undefined
  return { connection: conn, page: { ...page, inLibrary }, takePdfs, knownSites, needs }
}

async function answer(request: Request, sender: chrome.runtime.MessageSender): Promise<Answers[Request["kind"]]> {
  switch (request.kind) {
    case "state":
      return popupState(request.tabId)
    case "connect":
      return pair()
    case "add":
      return add(request.tabId)
    case "save":
      return save(request.tabId)
    case "takePdfs":
      await ext.storage.local.set({ takePdfs: request.on })
      return null
    case "allowed":
      // Asked for in the popup (a permission can only be asked from a click); held, owlit goes on there
      if (await ext.permissions.contains({ origins: originsOf(request.host) })) await resume(request.host).catch(() => undefined)
      return null
    case "page": {
      const tabId = sender.tab?.id
      if (tabId === undefined || !/^https?:/.test(request.url)) return null
      const page = { url: request.url, host: new URL(request.url).hostname, pdfTab: false, paper: paperOfPage(request.html, request.url) }
      await rememberPage(tabId, page)
      await mark(tabId, page)
      return null
    }
  }
}

ext.runtime.onMessage.addListener((request: Request, sender, respond) => {
  // Only the extension's own pages and content scripts reach here; nothing a web page sends
  if (sender.id !== ext.runtime.id) return false
  answer(request, sender).then(respond, (error) => {
    console.error("[owlit]", error)
    respond(null)
  })
  return true
})
