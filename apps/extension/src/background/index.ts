import { t } from "@lingui/core/macro"
import type { ExtensionPaper, ExtensionStatus, PairAnswer, PairStarted, PaperAnswer, WorkAnswer } from "@owlit/protocol"
import { browserName } from "../lib/browser-name.ts"
import { startI18n } from "../lib/i18n.ts"
import { originsOf, type Answers, type Connection, type Outcome, type PageState, type PopupState, type Request } from "../lib/messages.ts"
import { ask, OwlitError, Unreachable } from "../lib/owlit.ts"
import { idsInUrl, paperOfPage, type PagePaper } from "../lib/page.ts"
import { contentTypeOf, isPdfResponse, takesPdfTab } from "../lib/pdf-tab.ts"
import { isThrough } from "../lib/verdict.ts"
import { doWork } from "../lib/work.ts"

// The extension's service worker: the one place that talks to owlit and fetches with the user's cookies.
// The popup and the content script only ask it. Chrome stops it when idle, so what must outlast that is in
// chrome.storage (the token and the setting in local, each tab's page in session) and listeners are
// added at the top level, where a restarted worker finds them again.

startI18n()

// While owlit isn't running, a look every 30 s (the shortest alarm Chrome allows) and at every tab switch
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
const local = () => chrome.storage.local.get(["token", "takePdfs"]) as Promise<Local>
const takePdfsOn = async () => (await local()).takePdfs !== false

// ---- Being connected

let pairing: Promise<Connection> | null = null
let problem: "refused" | "expired" | "no-window" | undefined

async function connection(): Promise<Connection> {
  const { token } = await local()
  if (pairing) return { state: "pairing" }
  try {
    const status = await ask<ExtensionStatus>("/status", { token })
    void chrome.alarms.clear(RECONNECT)
    keepAsking()
    return { state: "connected", workspace: status.workspace?.name ?? null }
  } catch (error) {
    if (error instanceof OwlitError && error.status === 401) {
      // Forgotten in owlit's Settings, or never paired
      if (token) await chrome.storage.local.remove("token")
      return problem ? { state: "unpaired", problem } : { state: "unpaired" }
    }
    if (!(error instanceof Unreachable)) throw error
    if (token) void chrome.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
    return { state: "offline", paired: !!token }
  }
}

// Asks owlit's window, then waits for the answer a while at a time; the popup may close meanwhile
function pair(): Promise<Connection> {
  pairing ??= (async () => {
    problem = undefined
    try {
      const started = await ask<PairStarted>("/pair", { json: { browser: browserName(), extensionVersion: chrome.runtime.getManifest().version } })
      for (;;) {
        const answer = await ask<PairAnswer>(`/pair/${encodeURIComponent(started.pairing)}`)
        if (answer.state === "allowed") {
          await chrome.storage.local.set({ token: answer.token })
          break
        }
        // A storage call between holds keeps Chrome from taking the worker for idle
        await chrome.storage.session.set({ pairingSince: Date.now() })
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
  await chrome.storage.session.set({ [pageKey(tabId)]: page })
}

async function pageOf(tabId: number): Promise<Omit<PageState, "inLibrary"> | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!tab?.url || !/^https?:/.test(tab.url)) return null
  const kept = (await chrome.storage.session.get(pageKey(tabId)))[pageKey(tabId)] as Omit<PageState, "inLibrary"> | undefined
  if (kept?.url === tab.url) return kept
  const host = new URL(tab.url).hostname
  // A site the content script doesn't run on: the popup's click lent the extension this tab (activeTab)
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.head?.outerHTML ?? "" })
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
  await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined)
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined)
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
const pdfTabs = async () => new Map(Object.entries(((await chrome.storage.session.get(pdfTabsKey))[pdfTabsKey] ?? {}) as Record<string, string>).map(([k, v]) => [Number(k), v]))
// Taken already in this browser session, so a reload doesn't send it again
const takenKey = "taken"

// Seen only on sites the extension may read: those are the ones it can fetch again with cookies
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return
    void (async () => {
      const tabs = await pdfTabs()
      if (isPdfResponse(details.url, contentTypeOf(details.responseHeaders))) tabs.set(details.tabId, details.url)
      else tabs.delete(details.tabId)
      await chrome.storage.session.set({ [pdfTabsKey]: Object.fromEntries(tabs) })
    })()
  },
  { urls: ["https://*/*", "http://*/*"], types: ["main_frame"] },
  ["responseHeaders"],
)

async function takePdfTab(tabId: number, url: string) {
  const { token } = await local()
  const connected = !!token && (await connection()).state === "connected"
  const permitted = await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] })
  if (!takesPdfTab({ url, contentType: "application/pdf" }, { connected, takePdfs: await takePdfsOn(), permitted })) return
  const taken = ((await chrome.storage.session.get(takenKey))[takenKey] ?? []) as string[]
  if (taken.includes(url)) return
  await chrome.storage.session.set({ [takenKey]: [...taken.slice(-200), url] })
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
    chrome.notifications.create(`taken:${tabId}:${Date.now()}`, { type: "basic", iconUrl: chrome.runtime.getURL("icons/128.png"), title: t`owlit took this PDF`, message: paper.title })
    await setBadge(tabId, "✓", TAKEN)
  } catch (error) {
    // Not a Library paper's, or another paper's: left alone
    if (!(error instanceof OwlitError)) console.error("[owlit] couldn't hand a PDF to owlit", error)
  }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url) return
  void (async () => {
    const pdfUrl = (await pdfTabs()).get(tabId)
    if (pdfUrl && pdfUrl === tab.url) await takePdfTab(tabId, pdfUrl)
    else await watchForThrough(tabId, tab.url!)
  })()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(pageKey(tabId))
})

// ---- Fetching for owlit

// Kept in session storage, so a restarted worker still knows where to watch
type Waits = WorkAnswer["waits"]
const waitsKey = "waits"
const waits = async () => ((await chrome.storage.session.get(waitsKey))[waitsKey] ?? []) as Waits
// Restarts the asking if the worker was stopped meanwhile
const WORK = "work"

const permitted = (url: string) => chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }).catch(() => false)

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
        // An extension call between holds also keeps Chrome from taking the worker for idle
        await chrome.storage.session.set({ [waitsKey]: answer.waits })
        for (const item of answer.work) {
          void doWork(item, { fetch: (url, init) => fetch(url, init), permitted, ask, token }).catch((error) => console.error("[owlit] couldn't fetch for owlit", error))
        }
      }
    } catch (error) {
      if (error instanceof OwlitError && error.status === 401) await chrome.storage.local.remove("token")
      else if (error instanceof Unreachable) void chrome.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
      else console.error("[owlit] asking owlit for work failed", error)
    } finally {
      asking = null
    }
  })()
}

// The wait at a site this tab is on, if any: the site itself or a host under it (a proxy's rewritten
// publisher hosts are under the proxy's)
const waitAt = (all: Waits, host: string) => all.find((w) => w.kind !== "permission" && (host === w.host || host.endsWith(`.${w.host}`)))

async function resume(host: string) {
  const { token } = await local()
  if (!token) return
  await ask("/work/resume", { token, json: { host } })
  await chrome.storage.session.set({ [waitsKey]: (await waits()).filter((w) => w.host !== host) })
}

// A page that finished loading at a site paused for a check or a sign-in: once it is neither, the user
// got through, and owlit goes on there
async function watchForThrough(tabId: number, url: string) {
  if (!/^https?:/.test(url)) return
  const at = new URL(url).hostname
  const wait = waitAt(await waits(), at)
  if (!wait) return
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 500_000) }),
    })
    const seen = result?.result as { url: string; html: string } | undefined
    if (!seen) return
    const proxy = wait.proxied ? { host: wait.host } : undefined
    if (isThrough({ url: seen.url, status: 0, html: seen.html, proxy })) await resume(wait.host)
  } catch {
    // A page the extension may not read, or one that went away
  }
}

// ---- Staying connected

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT) void connection()
  if (alarm.name === WORK) keepAsking()
})
// Every time the worker starts: Chrome stops it when idle, and a stopped worker asks for no work
void chrome.alarms.create(WORK, { periodInMinutes: 0.5 })
keepAsking()

chrome.tabs.onActivated.addListener(() => {
  void (async () => {
    if (!(await local()).token) return
    const alarm = await chrome.alarms.get(RECONNECT)
    if (alarm) await connection()
  })()
})

chrome.runtime.onStartup.addListener(() => void connection())

// A site the user let the extension read from the popup: the content script runs there from then on, as
// on the publishers' sites the manifest lists
async function registerGranted() {
  const listed = new Set(chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.matches ?? []))
  const granted = ((await chrome.permissions.getAll()).origins ?? []).filter((o) => /^https:\/\/[^*]/.test(o) && !listed.has(o))
  await chrome.scripting.unregisterContentScripts({ ids: ["granted"] }).catch(() => undefined)
  if (granted.length) await chrome.scripting.registerContentScripts([{ id: "granted", matches: granted, js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }])
}
chrome.permissions.onAdded.addListener(() => void registerGranted())
chrome.permissions.onRemoved.addListener(() => void registerGranted())
chrome.runtime.onInstalled.addListener(() => void registerGranted())

// ---- Messages

async function popupState(tabId: number): Promise<PopupState> {
  const [conn, takePdfs] = await Promise.all([connection(), takePdfsOn()])
  const needs = conn.state === "connected" ? (await waits()).filter((w) => w.kind === "permission").map(({ host, papers }) => ({ host, papers })) : []
  const page = await pageOf(tabId)
  if (!page) return { connection: conn, page: null, takePdfs, needs }
  const { token } = await local()
  const inLibrary = conn.state === "connected" && conn.workspace && token && (page.paper || page.pdfTab) ? await lookUp(page, token).catch(() => undefined) : undefined
  return { connection: conn, page: { ...page, inLibrary }, takePdfs, needs }
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
      await chrome.storage.local.set({ takePdfs: request.on })
      return null
    case "allowed":
      // Asked for in the popup (a permission can only be asked from a click); held, owlit goes on there
      if (await chrome.permissions.contains({ origins: originsOf(request.host) })) await resume(request.host).catch(() => undefined)
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

chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  // Only the extension's own pages and content scripts reach here; nothing a web page sends
  if (sender.id !== chrome.runtime.id) return false
  answer(request, sender).then(respond, (error) => {
    console.error("[owlit]", error)
    respond(null)
  })
  return true
})
