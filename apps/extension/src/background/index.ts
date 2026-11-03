import { t } from "@lingui/core/macro"
import type { ExtensionStatus, OpenAnswer, OpenBody, OpenPage, OwlitIdentity, PairAnswer, PairBody, PairStarted, PaperAnswer, PaperFound, WalkAnswer, WalkNext, WalkStep, WorkAnswer, WorkBlocked, WorkResume } from "@owlit/protocol"
import { ext } from "../lib/browser.ts"
import { browserName } from "../lib/browser-name.ts"
import { clickPlan, pdfAddress } from "../lib/click.ts"
import { afterStatus, outcomeOfError } from "../lib/connect.ts"
import { startI18n } from "../lib/i18n.ts"
import { type Answers, type CardAction, type CardView, type Connection, type GoingOn, type Outcome, type PageState, type PopupState, type Request, type SiteWait, type ToPage } from "../lib/messages.ts"
import { ask as askAny, Elsewhere, OwlitError, Unreachable, type AskInit } from "../lib/owlit.ts"
import { idsInUrl, namesPdf, paperMarkup, paperOfPage, type PagePaper } from "../lib/page.ts"
import { hasKnownSites, mayRead, notYetAllowed } from "../lib/permissions.ts"
import { idsForPdf, pdfSaidKey, pdfSaidOn, pdfTabKey, pdfTabWrite, savesOnArrival, showsPdf, takePdf, takesPdfTab, whyNotTaken, type PdfSaid, type TakeDeps } from "../lib/pdf-tab.ts"
import { badgeOf, cardOf, savedPaper, sayIn, TAKEN, WAITING, walkCard, WORKING } from "../lib/say.ts"
import { serial } from "../lib/serial.ts"
import { isBlocked, isThrough } from "../lib/verdict.ts"
import { doWork } from "../lib/work.ts"

// The extension's background (Chrome's service worker, Firefox's event page): the one place that talks to
// owlit and fetches with the user's cookies. The toolbar button has no popup of its own: its click does the
// page's one thing here (lib/click.ts), and what comes of it is said in a card in the page (content/card.ts)
// or, where none can be drawn, in the popup opened for that tab (lib/say.ts). Both browsers stop the
// background when idle, so what must outlast that is in storage (the token and the setting in local, each
// tab's page in session) and listeners are added at the top level, where a restarted background finds
// them again.

startI18n()

// While owlit isn't running, a look every 30 s (the shortest alarm Chrome allows; Firefox would take
// shorter, but one pace for both) and at every tab switch
const RECONNECT = "reconnect"

interface Local {
  token?: string
  // The owlit that gave the token
  owlit?: OwlitIdentity
  // "Take PDFs I open for papers in my Library"; unset is on
  takePdfs?: boolean
}
const local = () => ext.storage.local.get(["token", "owlit", "takePdfs"]) as Promise<Local>
// Forgotten by the owlit it was paired with
const unpair = () => ext.storage.local.remove(["token", "owlit"])

// Every request with the token goes to the owlit that gave it: another one on the port (a preview, a
// second copy) is Elsewhere, and asked nothing
async function ask<T>(route: string, init: AskInit = {}): Promise<T> {
  return askAny<T>(route, init.token ? { ...init, owlit: (await local()).owlit?.id } : init)
}
const takePdfsOn = async () => (await local()).takePdfs !== false

// What reads and writes the same session keys (a tab's PDF, the PDFs answered for, owlit going on at a
// site) runs through this one chain, so no read lands between another's read and its write
const session = serial()

// ---- Being connected

let pairing: Promise<Connection> | null = null
let problem: "refused" | "expired" | "no-window" | undefined

async function connection(): Promise<Connection> {
  if (pairing) return { state: "pairing" }
  const kept = await local()
  let answer: Parameters<typeof afterStatus>[0]
  try {
    answer = { status: await ask<ExtensionStatus>("/status", { token: kept.token }) }
  } catch (error) {
    answer = { error }
  }
  const step = afterStatus(answer, { ...kept, problem })
  if (step.unpair) await unpair()
  if (step.remember) await ext.storage.local.set({ owlit: step.remember })
  if (step.reconnect) void ext.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
  else if (step.connection.state === "connected") void ext.alarms.clear(RECONNECT)
  if (step.work) keepAsking()
  return step.connection
}

// Asks owlit's window, then waits for the answer a while at a time; the popup may close meanwhile
function pair(): Promise<Connection> {
  pairing ??= (async () => {
    problem = undefined
    try {
      const started = await ask<PairStarted>("/pair", { json: { browser: browserName(), extensionVersion: ext.runtime.getManifest().version } satisfies PairBody })
      for (;;) {
        const answer = await ask<PairAnswer>(`/pair/${encodeURIComponent(started.pairing)}`)
        if (answer.state === "allowed") {
          await ext.storage.local.set({ token: answer.token, owlit: answer.owlit })
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
type Page = Omit<PageState, "inLibrary">

async function rememberPage(tabId: number, page: Page) {
  await ext.storage.session.set({ [pageKey(tabId)]: page })
}

// The PDF a tab loaded last, by its address, once the writes queued before the read have landed
const pdfTabOf = (tabId: number) => session(async () => (await ext.storage.session.get(pdfTabKey(tabId)))[pdfTabKey(tabId)] as string | undefined)

// The pages a tab's PDF may have come from: the tab's own page before it (a PDF viewer runs no content
// script, so the tab's kept page is still the one before), and the page of the tab that opened it
async function cameFrom(tabId: number, openerTabId: number | undefined): Promise<(Page | undefined)[]> {
  const keys = [pageKey(tabId), ...(openerTabId !== undefined ? [pageKey(openerTabId)] : [])]
  const kept = await ext.storage.session.get(keys)
  return keys.map((key) => kept[key] as Page | undefined)
}

// What a tab shows, as far as owlit cares; null for the browser's own pages and a tab gone
async function pageOf(tabId: number): Promise<Page | null> {
  const tab = await ext.tabs.get(tabId).catch(() => undefined)
  if (!tab?.url || !/^https?:/.test(tab.url)) return null
  const kept = (await ext.storage.session.get(pageKey(tabId)))[pageKey(tabId)] as Page | undefined
  if (kept?.url === tab.url) return kept
  const url = tab.url
  const host = new URL(url).hostname
  // A PDF, named by its address or by the page it was opened from
  const pdfPage = async (pdfTab: boolean) => {
    const ids = pdfTab ? idsForPdf(url, await cameFrom(tabId, tab.openerTabId)) : idsInUrl(url)
    return { url, host, pdfTab, paper: ids.doi || ids.arxiv ? { ...ids, authors: [] } : undefined }
  }
  // Asked before any script: a PDF viewer that lets one in shows no paper's head
  if (showsPdf(url, await pdfTabOf(tabId))) return pdfPage(true)
  // A site the content script doesn't run on: the click lent the extension this tab (activeTab)
  try {
    const [result] = await ext.scripting.executeScript({ target: { tabId }, func: paperMarkup })
    const page = { url, host, pdfTab: false, paper: paperOfPage(String(result?.result ?? ""), url) }
    await rememberPage(tabId, page)
    return page
  } catch {
    // The browser's PDF viewer runs no script. On a site the extension may not read no response was
    // seen, and only the address says it is a PDF.
    return pdfPage(namesPdf(url))
  }
}

// The page's paper in the Library, and whether owlit's queue for the extension holds it
async function find(page: { url: string; paper?: PagePaper }, token: string) {
  const query = new URLSearchParams()
  if (page.paper?.doi) query.set("doi", page.paper.doi)
  if (page.paper?.arxiv) query.set("arxiv", page.paper.arxiv)
  if (page.url) query.set("url", page.url)
  // What finds a page that names no id again
  if (page.paper?.title) query.set("title", page.paper.title.slice(0, 1000))
  return ask<PaperFound>(`/papers?${query}`, { token })
}
const lookUp = async (page: { url: string; paper?: PagePaper }, token: string) => (await find(page, token)).paper

// The toolbar button's mark for a tab: a Library paper there lacks its PDF. With "Take PDFs I open" on,
// the PDF the page names is fetched for it then and there (pdf-tab.ts savesOnArrival).
async function mark(tabId: number, page: { url: string; paper?: PagePaper }) {
  const { token } = await local()
  if (!token || !page.paper) return setBadge(tabId, "")
  const paper = await lookUp(page, token).catch(() => null)
  await setBadge(tabId, paper && !paper.hasPdf ? "•" : "", WAITING)
  const address = page.paper.pdfUrl
  if (!paper || !address) return
  const saves = savesOnArrival({ inLibrary: paper, pdfUrl: address, takePdfs: await takePdfsOn(), permitted: await permitted(address), answered: await answered.has(address) })
  if (!saves) return
  const result = await putPdf(paper.id, address, token).catch(() => undefined)
  // A PDF that didn't come (a paywall's page, owlit away) is tried again at the next visit; owlit's
  // answer is kept
  if (result === "saved" || result === "not-this-paper") await answered.add(address)
  if (result !== "saved") return
  await setBadge(tabId, "✓", TAKEN)
  if ((await walkOn(paper.id)) === tabId) return
  await drawCard(tabId, cardOf({ kind: "saved", paperId: paper.id }))
}

async function setBadge(tabId: number, text: string, color = WAITING) {
  await ext.action.setBadgeText({ tabId, text }).catch(() => undefined)
  if (text) await ext.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined)
}

const permitted = (url: string) => ext.permissions.contains({ origins: [`${new URL(url).origin}/*`] }).catch(() => false)

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

async function putPdf(id: string, url: string, token: string): Promise<"saved" | "not-a-pdf" | "not-this-paper"> {
  const pdf = await fetchPdf(url)
  if (!pdf) return "not-a-pdf"
  try {
    await ask<PaperAnswer>(`/papers/${encodeURIComponent(id)}/pdf`, { method: "PUT", token, pdf })
    return "saved"
  } catch (error) {
    if (error instanceof OwlitError && error.reason === "not-this-paper") return "not-this-paper"
    // owlit's own route placed it while this one was fetched (arXiv's, for a paper just added): the paper
    // has its PDF all the same
    if (error instanceof OwlitError && error.reason === "has-pdf") return "saved"
    throw error
  }
}

// The PDFs owlit answered for in this browser session (pdf-tab.ts takePdf)
const answeredKey = "taken"
const answered: TakeDeps["answered"] = {
  has: (url) => session(async () => (((await ext.storage.session.get(answeredKey))[answeredKey] ?? []) as string[]).includes(url)),
  add: (url) =>
    session(async () => {
      const all = ((await ext.storage.session.get(answeredKey))[answeredKey] ?? []) as string[]
      await ext.storage.session.set({ [answeredKey]: [...all.slice(-200), url] })
    }),
}

const takeDeps = (token: string, cache: RequestCache): Omit<TakeDeps, "answered"> => ({
  fetchPdf: (url) => fetchPdf(url, cache),
  lookUp: (ids) => lookUp({ url: "", paper: { ...ids, authors: [] } }, token),
  put: (paperId, pdf) => (paperId ? ask<PaperAnswer>(`/papers/${encodeURIComponent(paperId)}/pdf`, { method: "PUT", token, pdf }) : ask<PaperAnswer>("/pdfs", { method: "PUT", token, pdf })),
})

// What the click does on a tab, and how it ended
async function act(tabId: number): Promise<Outcome> {
  try {
    const conn = await connection()
    const { token } = await local()
    const page = await pageOf(tabId)
    const inLibrary = conn.state === "connected" && conn.workspace && token && page && (page.paper || page.pdfTab) ? await lookUp(page, token) : undefined
    const plan = clickPlan({ connection: conn, page: page && { ...page, inLibrary } })
    if (plan.do === "say") return plan.outcome
    if (!page || !token) return { kind: "no-paper" }
    if (plan.do === "add") return await add(page, token)
    const address = pdfAddress(page)!
    if (!(await permitted(address))) return { kind: "needs-site", host: new URL(address).hostname }
    if (plan.do === "save") {
      const result = await putPdf(plan.paperId, address, token)
      if (result === "not-a-pdf") return { kind: "no-pdf", host: new URL(address).hostname }
      if (result === "not-this-paper") return { kind: "not-this-paper" }
      // The PDF tab's own PDF: the popup says so from now on, not why it wasn't saved
      if (page.pdfTab) await keepPdfSaid(tabId, page.url, { kind: "taken", paperId: plan.paperId, title: inLibrary?.title ?? "" })
      return { kind: "saved", paperId: plan.paperId }
    }
    // A PDF tab that names no paper: owlit tells by its first pages whose it is. Asked again whatever
    // was answered for it before, since the person pressed for it.
    const taken = await takePdf(page.url, {}, { ...takeDeps(token, "force-cache"), answered: { has: async () => false, add: answered.add } })
    if ("taken" in taken) {
      const outcome: Outcome = { kind: "taken", paperId: taken.taken.id, title: taken.taken.title }
      await keepPdfSaid(tabId, page.url, outcome)
      return outcome
    }
    if ("had" in taken) return { kind: "has-pdf", paperId: taken.had.id }
    if ("refused" in taken) return outcomeOfError(taken.refused)
    if ("missed" in taken && taken.missed) return outcomeOfError(taken.missed)
    return { kind: "no-pdf", host: page.host }
  } catch (error) {
    if (!(error instanceof OwlitError) && !(error instanceof Unreachable)) console.error("[owlit] the button's work failed", error)
    return outcomeOfError(error)
  }
}

async function add(page: Page, token: string): Promise<Outcome> {
  const { paper } = await ask<PaperAnswer>("/papers", { token, json: { ...page.paper, url: page.url } })
  const address = pdfAddress(page)
  if (paper.hasPdf) return { kind: "added", pdf: "saved", paperId: paper.id }
  if (!address) return { kind: "added", pdf: "none-named", paperId: paper.id }
  const host = new URL(address).hostname
  if (!(await permitted(address))) return { kind: "added", pdf: "not-allowed", host, paperId: paper.id }
  return { kind: "added", pdf: await putPdf(paper.id, address, token), host, paperId: paper.id }
}

// A click at a time per tab: a second press while the first works does nothing
const working = new Set<number>()

async function click(tabId: number, windowId: number) {
  if (working.has(tabId)) return
  working.add(tabId)
  const before = await ext.action.getBadgeText({ tabId }).catch(() => "")
  await setBadge(tabId, "…", WORKING)
  try {
    const outcome = await act(tabId)
    const badge = badgeOf(outcome)
    await (badge ? setBadge(tabId, badge.text, badge.color) : setBadge(tabId, before))
    // Saved on the walk's page: the walk goes on, and the next paper's card counts it
    const saved = savedPaper(outcome)
    if (saved && (await walkOn(saved)) === tabId) return
    await speak(tabId, windowId, outcome)
  } finally {
    working.delete(tabId)
  }
}

ext.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void click(tab.id, tab.windowId)
})

// ---- Saying it

const saidKey = (tabId: number) => `said:${tabId}`

// Said where placesFor puts it. When neither the card nor the popup could be shown, the popup waits on the
// button for this tab, and the next press opens it.
async function speak(tabId: number, windowId: number, outcome: Outcome) {
  if (await sayIn(outcome, (place) => (place === "card" ? drawCard(tabId, cardOf(outcome)) : openPopup(tabId, windowId, outcome)))) return
  await ext.storage.session.set({ [saidKey(tabId)]: outcome })
  await ext.action.setPopup({ tabId, popup: "popup.html" }).catch(() => undefined)
}

// The popup, opened for this tab with what the click came to. Chrome opens one without a click from 127,
// Firefox only while a click is being handled; where it can't, the tab's popup is taken back, so the next
// press acts again. The popup takes it back itself once it opens.
async function openPopup(tabId: number, windowId: number, outcome: Outcome): Promise<boolean> {
  await ext.storage.session.set({ [saidKey(tabId)]: outcome })
  if (typeof ext.action.openPopup !== "function") return false
  await ext.action.setPopup({ tabId, popup: "popup.html" }).catch(() => undefined)
  try {
    await ext.action.openPopup({ windowId })
    return true
  } catch {
    await ext.action.setPopup({ tabId, popup: "" }).catch(() => undefined)
    return false
  }
}

// The card in the tab's page; false where none can be drawn. A page the content script isn't on yet (a
// site it isn't listed for, a tab open before the extension was) gets it now, as far as the extension may
// run there: after a click, activeTab lets it.
async function drawCard(tabId: number, card: CardView | null): Promise<boolean> {
  const message: ToPage = { kind: "card", card }
  const tell = async () => (await ext.tabs.sendMessage(tabId, message)) === true
  try {
    return await tell()
  } catch {
    const url = (await ext.tabs.get(tabId).catch(() => undefined))?.url
    if (url) injected.set(tabId, url)
    try {
      await ext.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
      return await tell()
    } catch {
      injected.delete(tabId)
      return false
    }
  }
}

// Tabs the content script was injected into to draw a card, with the page's address: its first report of
// that page is already the click's, so it doesn't mark the page again (taking the click's ✓) or draw the
// wait card over the card the click drew
const injected = new Map<number, string>()

// owlit to the front, on a Library paper when one is named; false when owlit couldn't show it
async function openInOwlit(paperId?: string): Promise<boolean> {
  const { token } = await local()
  if (!token) return false
  return (await ask<OpenAnswer>("/open", { token, json: { paper: paperId } satisfies OpenBody }).catch(() => ({ shown: false }))).shown
}

// The extension's own page that asks the browser for a site (a permission is asked only from a click on
// one of its pages). From a click (tabId), the click's work is done again once the site is allowed.
async function openAllowPage(host: string, query: Record<string, string>) {
  const tab = await ext.tabs.create({ url: ext.runtime.getURL(`allow.html?${new URLSearchParams({ host, ...query })}`), active: true })
  if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
}

async function cardAction(action: CardAction, tab: chrome.tabs.Tab | undefined) {
  const tabId = tab?.id
  switch (action.kind) {
    case "open-paper":
    case "open-owlit":
      if (!(await openInOwlit(action.kind === "open-paper" ? action.paperId : undefined)) && tabId !== undefined) await drawCard(tabId, cardOf({ kind: "offline" }))
      return
    case "allow": {
      const waiting = (await waits()).find((w) => w.kind === "permission" && w.host === action.host)
      await openAllowPage(action.host, tabId !== undefined && !waiting ? { tab: String(tabId) } : { papers: String(waiting?.papers ?? 0) })
      return
    }
    case "walk":
      if (tabId !== undefined) await walkNext(action, tabId)
      return
    // Turned on from a PDF it would have taken: this one is taken now, as the button would
    case "take-pdfs":
      await ext.storage.local.set({ takePdfs: true })
      if (tabId !== undefined && tab?.windowId !== undefined) await click(tabId, tab.windowId)
      return
    case "connect": {
      if (tabId === undefined) return
      await drawCard(tabId, cardOf({ kind: "pairing" }))
      const connected = (await pair()).state === "connected"
      // Connected: what the person pressed the button for in the first place
      if (connected && tab?.windowId !== undefined) await click(tabId, tab.windowId)
      else await drawCard(tabId, cardOf(outcomeOfConnection(await connection())))
      return
    }
  }
}

const outcomeOfConnection = (conn: Connection): Outcome => {
  if (conn.state === "connected") return conn.workspace === null ? { kind: "no-workspace" } : { kind: "connected" }
  if (conn.state === "offline") return { kind: "offline" }
  if (conn.state === "elsewhere") return { kind: "elsewhere", name: conn.name }
  if (conn.state === "pairing") return { kind: "pairing" }
  return { kind: "unpaired" }
}

// ---- PDF tabs, taken without a click

// Seen only on sites the extension may read: those are the ones it can fetch again with cookies. Through
// the session chain, so the tab's "complete" below reads the PDF only once its response's write landed.
ext.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return
    const write = pdfTabWrite(details.tabId, details.url, details.responseHeaders)
    void session(() => ("set" in write ? ext.storage.session.set(write.set) : ext.storage.session.remove(write.remove)))
  },
  { urls: ["https://*/*", "http://*/*"], types: ["main_frame"] },
  ["responseHeaders"],
)

// What became of a tab's PDF, kept for the popup (pdf-tab.ts pdfSaidOn)
const keepPdfSaid = (tabId: number, url: string, outcome: Outcome) => session(() => ext.storage.session.set({ [pdfSaidKey(tabId)]: { url, outcome } satisfies PdfSaid }))
const pdfSaidOf = async (tabId: number) => (await ext.storage.session.get(pdfSaidKey(tabId)))[pdfSaidKey(tabId)] as PdfSaid | undefined

// A tab that finished loading a PDF. Taken for owlit when the user lets it (pdf-tab.ts takesPdfTab); when
// it isn't, and it is the PDF of a Library paper still without one, the button marks it "!" and the popup
// says why, with its fix. Any other PDF on the web is left alone.
async function pdfTab(tabId: number, url: string, tab: chrome.tabs.Tab) {
  const { token } = await local()
  if (!token || (await connection()).state !== "connected") return
  const ids = idsForPdf(url, await cameFrom(tabId, tab.openerTabId))
  const takePdfs = await takePdfsOn()
  const allowed = await permitted(url)
  if (!takesPdfTab({ url, contentType: "application/pdf" }, { connected: true, takePdfs, permitted: allowed })) {
    const why = whyNotTaken({ takePdfs, permitted: allowed })
    if (!why || (!ids.doi && !ids.arxiv)) return
    const paper = await lookUp({ url: "", paper: { ...ids, authors: [] } }, token).catch(() => null)
    if (!paper || paper.hasPdf) return
    const outcome: Outcome = why === "off" ? { kind: "not-saved", why, paperId: paper.id } : { kind: "not-saved", why, host: new URL(url).hostname, paperId: paper.id }
    await keepPdfSaid(tabId, url, outcome)
    return setBadge(tabId, "!", WAITING)
  }
  // From the cache: the tab has just loaded it
  const taken = await takePdf(url, ids, { ...takeDeps(token, "force-cache"), answered })
  if ("missed" in taken && taken.missed && !(taken.missed instanceof OwlitError) && !(taken.missed instanceof Unreachable)) console.error("[owlit] couldn't hand a PDF to owlit", taken.missed)
  // owlit's no for the paper the PDF was opened from; a PDF owlit couldn't place by its first pages is
  // no Library paper's, and nothing is said
  if ("refused" in taken && (ids.doi || ids.arxiv) && taken.refused instanceof OwlitError && taken.refused.reason === "not-this-paper") {
    await keepPdfSaid(tabId, url, { kind: "not-this-paper" })
    return setBadge(tabId, "!", WAITING)
  }
  if (!("taken" in taken)) return
  const outcome: Outcome = { kind: "taken", paperId: taken.taken.id, title: taken.taken.title }
  await keepPdfSaid(tabId, url, outcome)
  await setBadge(tabId, "✓", TAKEN)
  // The PDF the walk's tab opened: the tab goes on to the next paper, whose card counts this one saved
  if ((await walkOn(taken.taken.id)) === tabId) return
  // Said in the page where the PDF viewer takes a card. Else in the popup, opened by itself where the
  // browser opens one without a click and only on the tab in front, since it opens on whichever tab that
  // is; it opens once per PDF, as a PDF is taken once a session (takePdf's answered). Else the system says it.
  if (await drawCard(tabId, cardOf(outcome))) return
  if (tab.active && (await openPopup(tabId, tab.windowId, outcome))) return
  void ext.notifications.create(`taken:${tabId}:${Date.now()}`, { type: "basic", iconUrl: ext.runtime.getURL("icons/128.png"), title: t`owlit took this PDF`, message: taken.taken.title }).catch(() => undefined)
}

ext.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Gone from the PDF it said something about: its "!" or "✓" goes with it (the page's own mark comes
  // after this, from its content script)
  if (change.url) {
    const to = change.url
    void (async () => {
      const kept = await pdfSaidOf(tabId)
      if (!kept || pdfSaidOn(to, kept)) return
      await session(() => ext.storage.session.remove(pdfSaidKey(tabId)))
      await setBadge(tabId, "")
    })()
  }
  if (change.status !== "complete" || !tab.url) return
  const url = tab.url
  void (async () => {
    const pdfUrl = await pdfTabOf(tabId)
    if (pdfUrl && pdfUrl === url) {
      // A PDF that came at a site waiting for a check or a sign-in: the user is past it
      const wait = waitAt(await waits(), new URL(url).hostname)
      if (wait) await resume(wait.host, tabId).catch(() => undefined)
      return pdfTab(tabId, url, tab)
    }
    // A site the extension may not read shows it no response, and only the address says it is a PDF
    if (/^https?:/.test(url) && namesPdf(url) && !(await permitted(url))) return pdfTab(tabId, url, tab)
    await showWalk(tabId).catch(() => undefined)
    await watchForThrough(tabId, url)
  })()
})

ext.tabs.onRemoved.addListener((tabId) => {
  void session(() => ext.storage.session.remove([pageKey(tabId), pdfTabKey(tabId), saidKey(tabId), pdfSaidKey(tabId)]))
  // The walk's tab closed: the walk is put away here; owlit keeps where it stood until another one starts
  void (async () => {
    if ((await walkOf())?.tabId === tabId) await ext.storage.session.remove(walkKey)
  })()
})

// ---- Fetching for owlit

// Kept in session storage, so a restarted worker still knows where to watch
type Waits = WorkAnswer["waits"]
const waitsKey = "waits"
const waits = async () => ((await ext.storage.session.get(waitsKey))[waitsKey] ?? []) as Waits
// owlit going on at the sites the person got through at, counted as their PDFs come
const goingKey = "going"
const going = async () => ((await ext.storage.session.get(goingKey))[goingKey] ?? []) as GoingOn[]
// Restarts the asking if the worker was stopped meanwhile
const WORK = "work"

// Where the extension's own fetches were sent on (work.ts, FetchDeps.redirectedTo): fetch hides an opaque
// redirect's target, webRequest shows it, for the worker's own requests too (no tab, started by the
// extension: Chrome names the initiator, Firefox originUrl). The newest per address, a few hundred in
// all; a stopped worker loses them with the fetch that would have asked.
const redirects = new Map<string, string>()
const REDIRECTS_KEPT = 500
const ownOrigin = new URL(ext.runtime.getURL("/")).origin
ext.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const from = details.initiator ?? (details as { originUrl?: string }).originUrl
    if (details.tabId !== -1 || (from && new URL(from).origin !== ownOrigin)) return
    redirects.delete(details.url)
    redirects.set(details.url, details.redirectUrl)
    if (redirects.size > REDIRECTS_KEPT) redirects.delete(redirects.keys().next().value!)
  },
  { urls: ["https://*/*", "http://*/*"], types: ["xmlhttprequest"] },
)
const redirectedTo = (url: string) => redirects.get(url)

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
        for (const page of answer.open ?? []) void openPage(page).catch((error) => console.error("[owlit] couldn't open the page owlit asked for", error))
        for (const item of answer.work) {
          void doWork(item, { fetch: (url, init) => fetch(url, init), permitted, inTab, redirectedTo, ask, token })
            .then((result) => ("pdf" in result ? cameAt(item.host) : undefined))
            .catch((error) => console.error("[owlit] couldn't fetch for owlit", error))
        }
      }
    } catch (error) {
      if (error instanceof OwlitError && error.status === 401) await unpair()
      else if (error instanceof Unreachable || error instanceof Elsewhere) void ext.alarms.create(RECONNECT, { periodInMinutes: 0.5 })
      else console.error("[owlit] asking owlit for work failed", error)
    } finally {
      asking = null
    }
  })()
}

// A PDF came from a site owlit went on at: one more of its papers counted, and the count gone once all came
const cameAt = (host: string) =>
  session(async () => {
    const all = (await going()).map((g) => (g.host === host ? { ...g, done: g.done + 1 } : g)).filter((g) => g.done < g.total)
    await ext.storage.session.set({ [goingKey]: all })
  })

// A page the user asked owlit for, from a waiting line in owlit's window: opened here, in the browser with
// their access, and brought to the front
async function openPage(page: OpenPage) {
  if (page.kind === "permission") return openAllowPage(page.host, { papers: String(page.papers) })
  const tab = await ext.tabs.create({ url: page.kind === "walk" ? page.step.url : page.url, active: true })
  if (page.kind === "walk" && tab.id !== undefined) await ext.storage.session.set({ [walkKey]: { tabId: tab.id, paperId: page.step.paperId } satisfies Walk })
  if (tab.windowId !== undefined) await ext.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
}

// ---- Downloading by hand, one paper at a time

// The walk through the papers to download by hand (owlit's WalkStep) goes on in one tab: the one it was
// opened in, and the paper whose page the tab was sent to. Each next paper's page replaces the last in
// that tab, so the walk never leaves a pile of tabs, and a PDF the user opened in a tab of its own stays
// where it is while the walk's tab moves on behind it.
interface Walk {
  tabId: number
  paperId: string
}
const walkKey = "walk"
const walkOf = async () => (await ext.storage.session.get(walkKey))[walkKey] as Walk | undefined

// Goes to owlit's step in the walk's tab: a paper's page, or at the end, how it went, said in the page
// or, where the tab shows a PDF and takes no card, by the system. No step: owlit has no walk on (another
// workspace, a restart), and the tab is left as it is.
async function walkTo(step: WalkStep | null, tabId: number) {
  if (step?.kind !== "paper") {
    await ext.storage.session.remove(walkKey)
    if (!step) return
    const card = walkCard(step)
    if (await drawCard(tabId, card)) return
    void ext.notifications.create(`walk:${Date.now()}`, { type: "basic", iconUrl: ext.runtime.getURL("icons/128.png"), title: "owlit", message: card.text }).catch(() => undefined)
    return
  }
  // The tab closed meanwhile: the walk goes on in a new one
  const tab = (await ext.tabs.update(tabId, { url: step.url }).catch(() => undefined)) ?? (await ext.tabs.create({ url: step.url, active: true }))
  if (tab.id !== undefined) await ext.storage.session.set({ [walkKey]: { tabId: tab.id, paperId: step.paperId } satisfies Walk })
}

// A page loaded in the walk's tab: the card says where the walk stands there. A paper that got its PDF
// meanwhile some other way (dropped in owlit) is passed over by owlit, and the tab goes on.
async function showWalk(tabId: number) {
  const walk = await walkOf()
  const { token } = await local()
  if (walk?.tabId !== tabId || !token) return
  const { step } = await ask<WalkAnswer>("/walk", { token })
  if (step?.kind === "paper" && step.paperId === walk.paperId) await drawCard(tabId, walkCard(step))
  else await walkTo(step, tabId)
}

// A Library paper's PDF saved: when it is the paper the walk is on, the walk goes on in its tab. The
// walk's tab when it went on, which then says nothing more about the PDF: the next card counts it.
async function walkOn(paperId: string): Promise<number | undefined> {
  const walk = await walkOf()
  const { token } = await local()
  if (walk?.paperId !== paperId || !token) return undefined
  try {
    const { step } = await ask<WalkAnswer>("/walk", { token })
    await walkTo(step, walk.tabId)
    return walk.tabId
  } catch {
    return undefined
  }
}

// The card's Skip or Next paper. A card left in a tab the walk has moved out of (a newer walk took
// another) moves nothing.
async function walkNext(action: Extract<CardAction, { kind: "walk" }>, tabId: number) {
  const { token } = await local()
  if ((await walkOf())?.tabId !== tabId || !token) return
  const { step } = await ask<WalkAnswer>("/walk/next", { token, json: { paperId: action.paperId, skip: action.skip } satisfies WalkNext })
  await walkTo(step, tabId)
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

async function resume(host: string, tabId?: number) {
  const { token } = await local()
  if (!token) return
  const wait = (await waits()).find((w) => w.host === host)
  await ask("/work/resume", { token, json: { host } satisfies WorkResume })
  await ext.storage.session.set({ [waitsKey]: (await waits()).filter((w) => w.host !== host) })
  if (!wait) return
  await session(async () => ext.storage.session.set({ [goingKey]: [...(await going()).filter((g) => g.host !== host), { host, done: 0, total: wait.papers }] }))
  if (tabId !== undefined) await drawCard(tabId, cardOf({ kind: "through", host, papers: wait.papers }))
}

// The page the user opened at a site paused for a check or a sign-in is the site's block instead: owlit
// hears it, so its line asks for another network rather than a check no one can pass, and the card here
// says the same
async function blocked(host: string, url: string, tabId: number) {
  const { token } = await local()
  if (!token) return
  await ask("/work/blocked", { token, json: { host, url } satisfies WorkBlocked })
  const all = (await waits()).map((w) => (w.host === host ? { ...w, kind: "blocked" as const } : w))
  await ext.storage.session.set({ [waitsKey]: all })
  const wait = all.find((w) => w.host === host)
  if (wait) await drawCard(tabId, cardOf({ kind: "wait", wait: siteWait(wait) }))
}

// A page that finished loading at a site paused for a check or a sign-in: once it is neither, the user
// got through, and owlit goes on there. A check often finishes in the page it stands in (Cloudflare's
// swaps the article in without loading a new page), so the tab is looked at again for a while; a block
// stays as it is, so it is told once and the looking ends.
const THROUGH_LOOKS = 20
const THROUGH_EVERY_MS = 3000
const watching = new Set<number>()

// Whether a page the tab shows is past what its site waits for: neither a check, a block nor a sign-in
const pastIn = (seen: { url: string; html: string }, wait: Waits[number]) => isThrough({ url: seen.url, status: 0, html: seen.html, proxy: wait.proxied ? { host: wait.host } : undefined })

// The same, for a tab the popup or a page's report finds at a waiting site: owlit goes on there at once.
// A check Cloudflare passes in the page it stands in loads no new page, and the watch above may have
// ended before the user got to it.
async function pastAt(tabId: number, wait: Waits[number]): Promise<boolean> {
  const seen = await htmlOf(tabId)
  if (!seen || !pastIn(seen, wait)) return false
  await resume(wait.host, tabId).catch(() => undefined)
  return true
}

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
      if (pastIn(seen, wait)) {
        await resume(wait.host, tabId).catch(() => undefined)
        return
      }
      if (isBlocked(seen)) {
        if (wait.kind !== "blocked") await blocked(wait.host, seen.url, tabId).catch(() => undefined)
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

// A site the user let the extension read: the content script runs there from then on, as on the
// publishers' sites the manifest lists
async function registerGranted() {
  const listed = new Set(ext.runtime.getManifest().content_scripts?.flatMap((c) => c.matches ?? []))
  const granted = ((await ext.permissions.getAll()).origins ?? []).filter((o) => /^https:\/\/[^*]/.test(o) && !listed.has(o))
  await ext.scripting.unregisterContentScripts({ ids: ["granted"] }).catch(() => undefined)
  if (granted.length) await ext.scripting.registerContentScripts([{ id: "granted", matches: granted, js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true }])
}
const registered = () => void registerGranted().catch((error) => console.error("[owlit] couldn't run on the sites allowed", error))

// owlit's papers waiting for a site the extension may now read: owlit goes on there. Here as well as from
// the Allow page, since Firefox may close a page while its permission question is open, and then the
// page never sends its own "allowed".
async function resumePermitted() {
  for (const wait of (await waits()).filter((w) => w.kind === "permission")) {
    if (await mayRead(ext.permissions, wait.host)) await resume(wait.host).catch(() => undefined)
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
  const all = conn.state === "connected" ? await waits() : []
  const asked = all.filter((w) => w.kind === "permission").map(({ host, papers }) => ({ host, papers }))
  const { needed: needs, allowed } = await notYetAllowed(ext.permissions, asked)
  for (const host of allowed) void resume(host).catch(() => undefined)
  const said = (await ext.storage.session.get(saidKey(tabId)))[saidKey(tabId)] as Outcome | undefined
  const page = await pageOf(tabId)
  const base = { connection: conn, takePdfs, knownSites, needs, said }
  if (!page) return { ...base, page: null }
  // A wait this page is past isn't said: owlit goes on there at once
  let wait = waitAt(all, page.host)
  if (wait && (await pastAt(tabId, wait))) wait = undefined
  const goingOn = (await going()).find((g) => page.host === g.host || page.host.endsWith(`.${g.host}`))
  const { token } = await local()
  const found = conn.state === "connected" && conn.workspace && token && (page.paper || page.pdfTab) ? await find(page, token).catch(() => undefined) : undefined
  const pdfTab = pdfSaidOn(page.url, await pdfSaidOf(tabId))
  const biggest = biggestWait(all, page.host)
  return {
    ...base,
    page: { ...page, inLibrary: found?.paper },
    wait: wait && siteWait(wait),
    going: goingOn,
    ...(pdfTab ? { pdfTab } : {}),
    ...(found?.getting ? { getting: { papers: found.getting, ...(biggest ? { wait: siteWait(biggest) } : {}) } } : {}),
  }
}

async function answer(request: Request, sender: chrome.runtime.MessageSender): Promise<Answers[Request["kind"]]> {
  switch (request.kind) {
    case "state": {
      const state = await popupState(request.tabId)
      // Said once: the popup shows it now, and the button acts again from the next press
      await ext.storage.session.remove(saidKey(request.tabId))
      await ext.action.setPopup({ tabId: request.tabId, popup: "" }).catch(() => undefined)
      return state
    }
    case "connect":
      return pair()
    case "act": {
      const outcome = await act(request.tabId)
      const badge = badgeOf(outcome)
      if (badge) await setBadge(request.tabId, badge.text, badge.color)
      const saved = savedPaper(outcome)
      if (saved) void walkOn(saved)
      return outcome
    }
    case "takePdfs":
      await ext.storage.local.set({ takePdfs: request.on })
      return null
    case "allowed": {
      // Asked for on the Allow page (a permission can only be asked from a click); held, owlit goes on there
      if (await mayRead(ext.permissions, request.host)) await resume(request.host).catch(() => undefined)
      // From a click that needed the site: back to that tab, and the click's work done again
      if (request.tabId !== undefined) {
        const tab = await ext.tabs.update(request.tabId, { active: true }).catch(() => undefined)
        if (tab?.windowId !== undefined) {
          await ext.windows.update(tab.windowId, { focused: true }).catch(() => undefined)
          await click(request.tabId, tab.windowId)
        }
      }
      return null
    }
    case "page": {
      const tabId = sender.tab?.id
      if (tabId === undefined || !/^https?:/.test(request.url)) return null
      const page = { url: request.url, host: new URL(request.url).hostname, pdfTab: false, paper: paperOfPage(request.html, request.url) }
      await rememberPage(tabId, page)
      const drawing = injected.get(tabId)
      injected.delete(tabId)
      if (drawing === request.url) return null
      await mark(tabId, page)
      // The walk's tab has its own card, which a site's wait would draw over
      if ((await walkOf())?.tabId !== tabId) await sayWait(tabId, page.host)
      return null
    }
    case "card":
      await cardAction(request.action, sender.tab)
      return null
    case "open":
      return openInOwlit(request.paperId)
    case "closed":
      await session(async () => {
        const all = ((await ext.storage.session.get(closedKey))[closedKey] ?? []) as string[]
        await ext.storage.session.set({ [closedKey]: [...all.filter((k) => k !== request.key), request.key] })
      })
      return null
  }
}

// Cards the person closed in this browser session, by their key
const closedKey = "closedCards"

// The sign-in or check a site this tab is on waits for, if any: the site itself or a host under it (a
// proxy's rewritten publisher hosts are under the proxy's). A site waiting to be allowed runs no content
// script, and the popup lists it apart.
function waitAt(all: Waits, host: string) {
  return all.find((w) => w.kind !== "permission" && (host === w.host || host.endsWith(`.${w.host}`)))
}

const siteWait = ({ kind, host, papers, proxied }: Waits[number]): SiteWait => ({ kind, host, papers, proxied })

// The site wait that holds up the most papers, but for the one at this host
function biggestWait(all: Waits, host: string) {
  const elsewhere = all.filter((w) => host !== w.host && !host.endsWith(`.${w.host}`))
  return elsewhere.sort((a, b) => b.papers - a.papers)[0]
}

// A page at a site that waits on the person: the card says what for, until they close it; a page past it
// (the article, once a check let the user through) lets owlit go on instead
async function sayWait(tabId: number, host: string) {
  const wait = waitAt(await waits(), host)
  if (!wait || (await pastAt(tabId, wait))) return
  const card = cardOf({ kind: "wait", wait: siteWait(wait) })
  const closed = ((await ext.storage.session.get(closedKey))[closedKey] ?? []) as string[]
  if (card.key && closed.includes(card.key)) return
  await drawCard(tabId, card)
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

// ---- The button's menu

// The one setting, on the button's right-click menu: the popup only opens when something needs deciding
const TAKE_PDFS = "take-pdfs"
async function makeMenu() {
  await ext.contextMenus.removeAll()
  ext.contextMenus.create({ id: TAKE_PDFS, type: "checkbox", contexts: ["action"], checked: await takePdfsOn(), title: t`Take PDFs I open for papers in my Library` })
}
ext.runtime.onInstalled.addListener(() => void makeMenu().catch((error) => console.error("[owlit] couldn't make the button's menu", error)))
ext.runtime.onStartup.addListener(() => void makeMenu().catch(() => undefined))
ext.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === TAKE_PDFS) void ext.storage.local.set({ takePdfs: !!info.checked })
})
// Changed in the popup: the menu's tick follows
ext.storage.local.onChanged.addListener((changes) => {
  if ("takePdfs" in changes) void ext.contextMenus.update(TAKE_PDFS, { checked: changes.takePdfs.newValue !== false }).catch(() => undefined)
})
