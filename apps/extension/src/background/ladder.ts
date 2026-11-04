import type { GateKey, WorkItem } from "@owlit/protocol"
import { ext } from "../lib/browser.ts"
import { serial } from "../lib/serial.ts"
import { inTabItem, proxyHostOf, sameSite } from "../lib/from-tab.ts"
import { isCheck, isInteractive, isStandIn, isThrough, siteOf } from "../lib/verdict.ts"
import { FETCH_MS, fetchFor, said, type Fetched, type FetchDeps } from "../lib/work.ts"

// How the extension fetches one of owlit's papers, step by step:
// 1. The background's own fetch, with the user's cookies. Skipped where a tab is past the gate's check
//    already (the gate's own, or one of the user's), which fetches instead whoever started it; and for a
//    publisher whose check always turns it away (WorkItem.inTab), when a tab will fetch instead.
// 2. On a check, and only inside something the user started (WorkItem.userStarted): a tab of the
//    extension's own, one per gate, opened in the background on the paper's page. A managed check
//    (Cloudflare's "Just a moment") passes by itself in a tab that runs it; the tab is brought to the
//    front once if it hasn't after a while. Past it, the paper is fetched from inside the tab, as the
//    site's own page would (a firewall refuses the background's requests by their shape: Origin
//    chrome-extension://, Sec-Fetch-*, no Referer). The tab is kept for the gate's next papers and
//    closed once they are done; a tab brought to the front is the user's after its paper, and is
//    neither reused nor closed.
// 3. A check only a person passes (a captcha), a sign-in, a block, or a check met again in the tab: told
//    to owlit as it came, which makes the wait the user acts on.
// Outside something the user started no tab is opened: the paper waits under its gate's wait instead.

export const TAB_TIMES = {
  // A managed check passes by itself in a hidden tab; some (OUP's) only once the tab is in front
  hiddenMs: 20_000,
  shownMs: 20_000,
  // How often the tab's document is looked at while its check runs
  lookMs: 1_000,
  // The page's own load, after which it is looked at whatever it reached
  loadMs: 45_000,
  // Between two fetches from the same tab: a reader's pace, not a crawler's
  gapMs: 15_000,
  // A gate's tab with nothing more to fetch is closed this long after its last paper: longer than core's
  // gap between a lane's papers (PROXY_GAP_MS), so the next one finds it open
  idleMs: 60_000,
  // One fetch, in a tab or not: work.ts gives up on it after this, and the page's own fetch after the same
  fetchMs: FETCH_MS,
}

// The page's HTML, as far as the verdict reads it; undefined when the extension may not read the tab.
// The verdict reads the PDF links too, and ACM's sit past the first megabyte of its article pages.
// parsed: the browser has read the whole document (readyState interactive or complete), so what it says
// is the page's; never its load, which a page whose third-party scripts never answer (blocked on the
// network, as in China without a proxy) doesn't finish for minutes with its article there. origin: which
// document it is (performance.timeOrigin), a new one for every page the tab loads.
const DOCUMENT_MAX_CHARS = 4_000_000
export interface TabDocument {
  url: string
  html: string
  parsed: boolean
  origin: number
}
export async function documentOf(tabId: number): Promise<TabDocument | undefined> {
  try {
    const [result] = await ext.scripting.executeScript({
      target: { tabId },
      args: [DOCUMENT_MAX_CHARS],
      func: (max: number) => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, max), parsed: document.readyState !== "loading", origin: performance.timeOrigin }),
    })
    return result?.result as TabDocument | undefined
  } catch {
    return undefined
  }
}

// ---- Redirects

// Where a fetch of the extension's was sent on (work.ts, FetchDeps.redirectedTo): fetch hides an opaque
// redirect's target, webRequest shows it. The worker's own requests (no tab; Chrome names the
// initiator, Firefox originUrl), and those of a fetch the extension injected into a tab (its own tabs',
// or a tab the user has open past a check, FetchDeps.inTab): a PDF on another host (OUP's on
// Silverchair's) is reached by the tab's fetch without following, which webRequest shows the signed
// address of, and the worker fetches that. A tab's requests are taken only from its page's own origin
// and only while an injected fetch runs there, or just after: the user's own browsing in that tab is
// not the extension's. The newest per address, a few hundred in all.
const redirects = new Map<string, string>()
const REDIRECTS_KEPT = 500
// webRequest may tell of a redirect a moment after the injected fetch has its answer (tabFetch waits up
// to a second for it): a tab's requests are still taken this long after
const INJECTED_GRACE_MS = 2_000
const injected = new Map<number, { origin: string; running: number; endedAt: number }>()
const ownOrigin = () => new URL(ext.runtime.getURL("/")).origin
const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : undefined
  } catch {
    return undefined
  }
}
const injecting = (tabId: number, from: string | undefined) => {
  const at = injected.get(tabId)
  if (!at || originOf(from) !== at.origin) return false
  return at.running > 0 || Date.now() - at.endedAt <= INJECTED_GRACE_MS
}
ext.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const from = details.initiator ?? (details as { originUrl?: string }).originUrl
    const worker = details.tabId === -1 && (!from || new URL(from).origin === ownOrigin())
    if (!worker && !workTabIds.has(details.tabId) && !injecting(details.tabId, from)) return
    redirects.delete(details.url)
    redirects.set(details.url, details.redirectUrl)
    if (redirects.size > REDIRECTS_KEPT) redirects.delete(redirects.keys().next().value!)
  },
  { urls: ["https://*/*", "http://*/*"], types: ["xmlhttprequest"] },
)
export const redirectedTo = (url: string) => redirects.get(url)

// ---- The gates' tabs

interface WorkTab {
  tabId: number
  // Brought to the front once for its check: it is the user's to look at now, and handed to them once
  // its paper is fetched
  shown: boolean
  // When its last fetch from inside it ended
  lastAt: number
}
// In session storage, so a restarted worker still knows its tabs (and closes them when idle)
const TABS_KEY = "workTabs"
const tabsKept = async () => ((await ext.storage.session.get(TABS_KEY))[TABS_KEY] ?? {}) as Partial<Record<GateKey, WorkTab>>
const keeping = serial()
const keepTab = (gate: GateKey, tab: WorkTab | undefined) =>
  keeping(async () => {
    const all = await tabsKept()
    if (tab) all[gate] = tab
    else delete all[gate]
    workTabIds.clear()
    for (const kept of Object.values(all)) workTabIds.add(kept!.tabId)
    await ext.storage.session.set({ [TABS_KEY]: all })
  })

// The tabs the extension opened for its fetches, known at once (webRequest's listener can't wait for
// storage): what a page reports there is the extension's, not the user's
export const workTabIds = new Set<number>()
export const tabsLoaded = tabsKept().then((all) => {
  for (const kept of Object.values(all)) workTabIds.add(kept!.tabId)
})

// The extension's tabs brought to the front, for a check, by the user's Open on a wait or by the user's
// own click: the user's to look at from then on, never closed or loaded with another paper by the
// extension. One found in front is theirs too: the click may have come before the worker could hear it.
const SHOWN_KEY = "shownTabs"
const shownTabs = async () => ((await ext.storage.session.get(SHOWN_KEY))[SHOWN_KEY] ?? []) as number[]
const isShown = async (tab: WorkTab) => tab.shown || (await shownTabs()).includes(tab.tabId) || !!(await ext.tabs.get(tab.tabId).catch(() => undefined))?.active
const markShown = (tabId: number) => keeping(async () => ext.storage.session.set({ [SHOWN_KEY]: [...new Set([...(await shownTabs()), tabId])] }))

// Gates whose check the background's own fetch met in this browser session: a tab past it is where
// their papers are fetched (fetchLadder)
const CHECKED_KEY = "checkedGates"
const checkedGates = async () => ((await ext.storage.session.get(CHECKED_KEY))[CHECKED_KEY] ?? []) as GateKey[]
const noteChecked = (gate: GateKey) =>
  keeping(async () => {
    const all = await checkedGates()
    if (!all.includes(gate)) await ext.storage.session.set({ [CHECKED_KEY]: [...all, gate] })
  })

// One paper at a time per gate: its tab is the one place they are fetched from
const gates = new Map<GateKey, ReturnType<typeof serial>>()
const running = new Set<GateKey>()
const inLine = (gate: GateKey) => {
  let chain = gates.get(gate)
  if (!chain) gates.set(gate, (chain = serial()))
  return chain
}

// Gates a tab of the user's got past (index.ts resume) while the gate's own tab, opened for a paper,
// still stood at the check: that tab stops waiting, and the paper is fetched in the user's (pass)
const passedElsewhere = new Set<GateKey>()
export function passedAt(gate: GateKey) {
  if (running.has(gate)) passedElsewhere.add(gate)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

// The fetch ladder for one of owlit's papers. deps: the background's own fetching (FetchDeps), whose
// inTab is a tab the user has open at the site, past its check.
export async function fetchLadder(item: WorkItem, background: FetchDeps): Promise<Fetched> {
  await tabsLoaded
  const deps = { ...background, timeoutMs: TAB_TIMES.fetchMs }
  // A gate whose check turns the background's fetch away, with a tab already past it (the gate's own,
  // kept from its last paper, or one of the user's): the paper is fetched there at once, user-started or
  // not, since no tab is opened for it
  if (item.inTab || (await checkedGates()).includes(item.gate)) {
    if ((await tabsKept())[item.gate]) {
      const got = await inGateLine(item, deps, { open: false })
      if (got) return got
    }
    const theirs = await usersTab(item, deps)
    if (theirs) return fetchFor(inTabItem(item, theirs.url), { ...deps, fetch: whileWanted(theirs.fetch, deps), inTab: undefined })
  }
  // Without a tab of its own to fetch in, a tab-only publisher's paper is fetched as any other: through
  // the library's proxy its first answer may be the proxy's sign-in, and either way the ending names
  // the gate whose wait the paper goes under. A page the extension may not read is never opened in a
  // tab, which it couldn't read either: the background's fetch says so (no-permission).
  const skip = item.inTab && item.userStarted && (await deps.permitted(item.url))
  const worker = skip ? undefined : await fetchFor(item, deps)
  if (worker && "ended" in worker && worker.ended === "check") await noteChecked(item.gate)
  if (worker && !("ended" in worker && worker.ended === "check")) return worker
  if (!item.userStarted) return worker!
  // A tab that went away under it (the user closed it), or whose page couldn't be read, says nothing
  // of the paper: the check the background met, when it met one; else offline, which owlit asks for
  // again. Never a check made up at the paper's address, which through a proxy is the proxy's and
  // would hold every paper through it.
  return (await inGateLine(item, deps, { open: true })) ?? worker ?? { ended: "offline", host: hostOf(item.url) }
}

// A tab the user has open at one of the gate's sites, past its check, to fetch in (FetchDeps.inTab)
async function usersTab(item: WorkItem, deps: FetchDeps) {
  if (!deps.inTab) return undefined
  for (const site of item.sites?.length ? item.sites : [siteOf(hostOf(item.url))]) {
    const tab = await deps.inTab(site)
    if (tab) return tab
  }
  return undefined
}

// The paper fetched in its gate's tab, in the gate's line. open: a tab may be opened for it when none
// is kept; without, undefined when none is
async function inGateLine(item: WorkItem, deps: FetchDeps, { open }: { open: boolean }): Promise<Fetched | undefined> {
  return inLine(item.gate)(async () => {
    running.add(item.gate)
    try {
      return await inOwnTab(item, deps, { open })
    } finally {
      running.delete(item.gate)
      passedElsewhere.delete(item.gate)
      setTimeout(() => void closeIdleTabs(), TAB_TIMES.idleMs + 1)
    }
  })
}

// The paper fetched from inside its gate's tab, opened for it or kept from the gate's last paper;
// undefined when the tab went away under it (the user closed it), or none was kept and open is false
async function inOwnTab(item: WorkItem, deps: FetchDeps, { open }: { open: boolean }): Promise<Fetched | undefined> {
  const gate = item.gate
  // The gate's next paper, at a reader's pace, its page loaded in the same tab: a check met there again
  // is the site's word that this is enough for now
  const kept = await reusable(item)
  if (kept) await sleep(Math.max(0, kept.lastAt + TAB_TIMES.gapMs - Date.now()))
  // Asked after the gap: the user may have taken the tab meanwhile
  let tab = kept && (await reusable(item))
  const reused = !!tab
  if (!tab && !open) return undefined
  // The paper may have its PDF by now (the user opened its page and the extension took it there)
  if (!(await stillWanted(deps))) return notWanted(item)
  if (tab) {
    const before = (await documentOf(tab.tabId))?.origin
    await ext.tabs.update(tab.tabId, { url: item.url }).catch(() => undefined)
    await loaded(tab.tabId, before)
  } else {
    const opened = await ext.tabs.create({ url: item.url, active: false })
    if (opened.id === undefined) return undefined
    tab = { tabId: opened.id, shown: false, lastAt: 0 }
    await keepTab(gate, tab)
    await loaded(tab.tabId)
  }
  const passed = await pass(tab, item, deps, { once: reused })
  if (passed && "theirs" in passed) {
    await letGo(gate, tab)
    return fetchFor(inTabItem(item, passed.theirs.url), { ...deps, fetch: whileWanted(passed.theirs.fetch, deps), inTab: undefined })
  }
  if (!passed || !("through" in passed)) {
    await letGo(gate, tab)
    return passed
  }
  // Fetched from where the paper's page landed, with its addresses moved there (from-tab.ts): through a
  // library proxy that sends the browser on to the publisher (tlink) every address owlit gave is the
  // proxy's, and on a society's host of a publisher (rss.onlinelibrary.wiley.com) owlit's PDF address is
  // the publisher's main host, another origin than the tab's
  const here = inTabItem(item, passed.through.url, passed.through)
  const got = await fetchFor(here, { ...deps, fetch: whileWanted(tabFetch(tab.tabId, { navigate: true, proxyHost: proxyHostOf(item) }), deps), inTab: undefined })
  // The site asks again, or turns the browser away: its own word that this is enough for now
  if ("ended" in got && (got.ended === "check" || got.ended === "blocked" || got.ended === "sign-in")) {
    await letGo(gate, tab)
    return got
  }
  if (!(await ext.tabs.get(tab.tabId).catch(() => undefined))) {
    await keepTab(gate, undefined)
    return "ended" in got && got.ended === "offline" ? undefined : got
  }
  // Brought to the front, it is the user's now: theirs to close, never loaded with another paper
  await keepTab(gate, (await isShown(tab)) ? undefined : { ...tab, lastAt: Date.now() })
  return got
}

// The gate's kept tab, for its next paper, while it is still the extension's to load: open, never
// brought to the front, and still at one of the gate's sites. Any other is forgotten, not closed: the
// user may have taken it elsewhere.
async function reusable(item: WorkItem): Promise<WorkTab | undefined> {
  const tab = (await tabsKept())[item.gate]
  if (!tab) return undefined
  const now = await ext.tabs.get(tab.tabId).catch(() => undefined)
  const host = now?.url ? hostOf(now.url) : ""
  const sites = [...(item.sites ?? []), siteOf(hostOf(item.url))]
  if (!(await isShown(tab)) && host && sites.some((site) => host === site || host.endsWith(`.${site}`))) return tab
  await keepTab(item.gate, undefined)
  return undefined
}

// Until the tab shows a new document the browser has parsed (before: the origin of the one it showed
// before it was sent on), or its load ended, or a while. Never until its load alone: a page whose
// third-party scripts never answer stays loading for minutes with its article there. A page the
// extension may not read tells nothing of its document, and is waited for by its load.
function loaded(tabId: number, before?: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let over = false
    const done = () => {
      if (over) return
      over = true
      ext.tabs.onUpdated.removeListener(heard)
      ext.tabs.onRemoved.removeListener(gone)
      signal?.removeEventListener("abort", done)
      clearTimeout(timer)
      resolve()
    }
    const heard = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") done()
    }
    const gone = (id: number) => {
      if (id === tabId) done()
    }
    const timer = setTimeout(done, TAB_TIMES.loadMs)
    ext.tabs.onUpdated.addListener(heard)
    ext.tabs.onRemoved.addListener(gone)
    signal?.addEventListener("abort", done)
    void (async () => {
      while (!over && !signal?.aborted) {
        const tab = await ext.tabs.get(tabId).catch(() => undefined)
        if (!tab) return done()
        const seen = await documentOf(tabId)
        // The browser's PDF viewer, though, until its PDF is all there (its load has no third-party
        // scripts to wait for): what is read from the cache next is the whole of it
        const viewer = !!seen && /<embed\b[^>]*application\/pdf/i.test(seen.html)
        if (seen?.parsed && seen.origin !== before && seen.url !== "about:blank" && (!viewer || tab.status === "complete")) return done()
        if (!seen && tab.status === "complete") return done()
        await sleep(TAB_TIMES.lookMs)
      }
    })()
  })
}

// The tab's page past its check (through: its document), or what stands in the way as owlit hears it. A
// managed check is given its time hidden, then once in front; anything else in the way is the user's at
// once. A document still being parsed, or a page that stands in while the tab goes on (AWS WAF's
// challenge, which reloads into the paper's page, a "Please wait"), says nothing yet and is looked at
// again in the same time. Judged by the document alone, never by whether the tab is still loading: a
// page whose third-party scripts never answer stays loading for minutes with its article there.
// once: a check met again on a tab whose check was passed before is the site's word at once. theirs: a
// tab of the user's got past the gate's check meanwhile (passedAt), where the paper is fetched instead:
// a check that only a person passes may stand in this tab for its whole time, the user being elsewhere.
// A tab on a site the extension may not read may be on a step of a sign-in, which the tab walks by
// itself, so it is given the same time to leave. Stopped there (a proxy sent the browser on to a
// publisher the user hasn't allowed), that site is the one to allow. The browser tells a tab's address
// only on a site the extension may read, so one it doesn't tell is named by the gate's own site, never
// by the proxy's. A readable tab whose document can't be read is between two pages, and looked at again.
async function pass(tab: WorkTab, item: WorkItem, deps: FetchDeps, { once = false } = {}): Promise<{ through: { url: string; html: string } } | { theirs: { fetch: typeof fetch; url: string } } | Fetched | undefined> {
  const proxy = item.proxied ? { host: hostOf(item.url), entry: item.url } : undefined
  let until = Date.now() + TAB_TIMES.hiddenMs
  for (;;) {
    const now = await ext.tabs.get(tab.tabId).catch(() => undefined)
    if (!now) return undefined
    const readable = !!now.url && (await deps.permitted(now.url))
    const seen = readable ? await documentOf(tab.tabId) : undefined
    if (!seen) {
      if (Date.now() < until) {
        await sleep(TAB_TIMES.lookMs)
        continue
      }
      const host = now.url ? hostOf(now.url) : item.sites?.[0]
      return !readable && host ? { ended: "no-permission", host } : undefined
    }
    const page = { url: seen.url, status: 0, html: seen.html, proxy }
    if (seen.parsed && isThrough(page)) return { through: seen }
    if (passedElsewhere.delete(item.gate)) {
      const theirs = await usersTab(item, deps)
      if (theirs) return { theirs }
    }
    const onItsWay = !seen.parsed || isStandIn(page)
    if (!onItsWay && (once || !isCheck(page) || isInteractive(page))) return said(page)
    if (Date.now() >= until) {
      if (tab.shown || !item.userStarted) return said(page)
      if (!(await stillWanted(deps))) return notWanted(item)
      tab.shown = true
      // Kept so at once: a worker restarted meanwhile never closes it as idle
      await keepTab(item.gate, { ...tab })
      await markShown(tab.tabId)
      await ext.tabs.update(tab.tabId, { active: true }).catch(() => undefined)
      until = Date.now() + TAB_TIMES.shownMs
    }
    await sleep(TAB_TIMES.lookMs)
  }
}

// The gate's tab is done with: closed, unless it was brought to the front, where the user may be acting
// on what stands in it (a captcha, a sign-in); then it is theirs
async function letGo(gate: GateKey, tab: WorkTab) {
  await keepTab(gate, undefined)
  if (!(await isShown(tab))) await ext.tabs.remove(tab.tabId).catch(() => undefined)
}

// The gates' tabs with no paper of theirs going and none for a while: closed, but for one brought to the
// front, which is the user's and only forgotten
export async function closeIdleTabs() {
  const now = Date.now()
  for (const [gate, tab] of Object.entries(await tabsKept()) as [GateKey, WorkTab][]) {
    if (running.has(gate)) continue
    if (await isShown(tab)) await keepTab(gate, undefined)
    else if (now - tab.lastAt >= TAB_TIMES.idleMs) {
      await keepTab(gate, undefined)
      await ext.tabs.remove(tab.tabId).catch(() => undefined)
    }
  }
}

// owlit still waits for the item's answer; asked again before every fetch in a tab (FetchDeps.wanted)
const stillWanted = async (deps: FetchDeps) => !deps.wanted || (await deps.wanted().catch(() => true))
// What a fetch owlit no longer waits for says: nothing was fetched, and owlit, which has the paper's PDF
// already or handed the paper out again, settles it with its answer to this (has-pdf) or lets it go
const notWanted = (item: WorkItem): Fetched => ({ ended: "offline", host: hostOf(item.url) })
// A tab's fetch for an item, made only while owlit still waits for it: one it no longer does fails as
// unanswered, before the site is asked
function whileWanted(fetch: typeof globalThis.fetch, deps: FetchDeps): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (!(await stillWanted(deps))) throw new TypeError("owlit no longer waits for this paper")
    return fetch(input, init)
  }) as typeof globalThis.fetch
}

// A tab of the extension's at this check, for a wait the user opens there (index.ts openPage): the gate's
// tab, brought to the front rather than a second one opened. It is the user's from then on. Found by the
// gate the ladder keeps it for (wait: the wait's id, its gate), whatever the tab shows yet: a tab just
// created has no address the browser has committed to; else, for an owlit that names no wait, a tab of
// the extension's at the host's site.
export async function showWorkTab(host: string, wait?: GateKey): Promise<chrome.tabs.Tab | undefined> {
  const kept = wait && (await tabsKept())[wait]
  if (kept && (await ext.tabs.get(kept.tabId).catch(() => undefined))) {
    await markShown(kept.tabId)
    return ext.tabs.update(kept.tabId, { active: true }).catch(() => undefined)
  }
  const site = siteOf(host)
  const ids = [...new Set([...Object.values(await tabsKept()).map((t) => t!.tabId), ...(await shownTabs())])]
  for (const tabId of ids) {
    const tab = await ext.tabs.get(tabId).catch(() => undefined)
    const at = tab?.url ? hostOf(tab.url) : ""
    if (!tab || !at || (at !== site && !at.endsWith(`.${site}`))) continue
    await markShown(tabId)
    return ext.tabs.update(tabId, { active: true }).catch(() => undefined)
  }
  return undefined
}

// The user clicked one of the gates' tabs. The extension's own fronting lands here too, already marked.
ext.tabs.onActivated.addListener(({ tabId }) => {
  void tabsLoaded.then(() => (workTabIds.has(tabId) ? markShown(tabId) : undefined))
})

// The user closed one of the gates' tabs
ext.tabs.onRemoved.addListener((tabId) => {
  injected.delete(tabId)
  void keeping(async () => {
    const all = await shownTabs()
    if (all.includes(tabId)) await ext.storage.session.set({ [SHOWN_KEY]: all.filter((id) => id !== tabId) })
  })
  if (!workTabIds.has(tabId)) return
  void (async () => {
    for (const [gate, tab] of Object.entries(await tabsKept()) as [GateKey, WorkTab][]) if (tab.tabId === tabId) await keepTab(gate, undefined)
  })()
})

// A fetch run inside a tab: the page fetches with its own standing at the site (same origin, its
// cookies, its Referer). An address of another site is fetched by the background: the tab's fetch
// would need that site's CORS, and the address is one a redirect the tab saw signed (Silverchair's).
// One on another host of the tab's own site is the site's, whose firewall turned the background away
// already: the extension's own tab (navigate) is sent there and reads what loads; a tab of the user's,
// never navigated, fetches the same path on its own host. proxyHost: a host-rewriting proxy's, whose
// names for every publisher share its domain. The bytes come back base64, since what a script in a tab
// returns must be plain data.
export function tabFetch(tabId: number, { navigate = false, proxyHost }: { navigate?: boolean; proxyHost?: string } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? undefined
    signal?.throwIfAborted()
    let url = String(input)
    const tab = await ext.tabs.get(tabId).catch(() => undefined)
    if (!tab?.url) throw new TypeError("The tab went away")
    const cache = init?.cache ?? "no-store"
    const [to, at] = [new URL(url), new URL(tab.url)]
    if (to.origin !== at.origin) {
      if (!sameSite(to.hostname, at.hostname, proxyHost)) return fetch(url, { ...init, credentials: "include", cache })
      if (navigate) return untilAborted(loadInTab(tabId, url, cache, signal), signal)
      url = new URL(`${to.pathname}${to.search}`, at.origin).href
    }
    return untilAborted(
      mark(tabId, at.origin, () => fetchInTab(tabId, url, init?.redirect ?? "follow", cache)),
      signal,
    )
  }) as typeof fetch
}

// What is running in a tab, or its rejection the moment the caller aborts. A signal can't reach into the
// page, so the work itself ends by its own time (fetchInTab); the gate's line doesn't wait for it.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

// Runs an injected fetch in the tab, marked for the webRequest listener as the extension's own
async function mark<T>(tabId: number, origin: string, run: () => Promise<T>): Promise<T> {
  const marked = injected.get(tabId)?.origin === origin ? injected.get(tabId)! : { origin, running: 0, endedAt: 0 }
  marked.running++
  injected.set(tabId, marked)
  try {
    return await run()
  } finally {
    marked.running--
    marked.endedAt = Date.now()
  }
}

// The extension's own tab sent to the address, and what loaded there read as the page itself would: a
// same-origin fetch of its own address, from the cache the load just filled (a PDF isn't asked twice)
async function loadInTab(tabId: number, url: string, cache: RequestCache, signal: AbortSignal | undefined): Promise<Response> {
  const before = (await documentOf(tabId))?.origin
  signal?.throwIfAborted()
  await ext.tabs.update(tabId, { url }).catch(() => undefined)
  await loaded(tabId, before, signal)
  signal?.throwIfAborted()
  const now = await ext.tabs.get(tabId).catch(() => undefined)
  if (!now?.url) throw new TypeError("The tab went away")
  return mark(tabId, new URL(now.url).origin, () => fetchInTab(tabId, now.url!, "follow", cache === "no-store" ? "force-cache" : cache))
}

// The PDF a tab shows, read inside it (a same-origin fetch of its own address, from the cache the viewer
// just filled): the site that let the tab load it may turn away the background's fetch of the same
// address. undefined when it can't be read there, or isn't a PDF.
export async function pdfOfTab(tabId: number, url: string): Promise<ArrayBuffer | undefined> {
  try {
    const response = await tabFetch(tabId)(url, { cache: "force-cache" })
    if (!response.ok) return undefined
    const bytes = await response.arrayBuffer()
    return new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-" ? bytes : undefined
  } catch {
    return undefined
  }
}

// tabFetch's fetch, run in the tab's page
async function fetchInTab(tabId: number, url: string, redirect: RequestRedirect, cache: RequestCache): Promise<Response> {
  const [result] = await ext.scripting.executeScript({
    target: { tabId },
    args: [url, redirect, cache, TAB_TIMES.fetchMs],
    func: async (url: string, redirect: RequestRedirect, cache: RequestCache, timeoutMs: number) => {
      const stop = new AbortController()
      const timer = setTimeout(() => stop.abort(), timeoutMs)
      try {
        const response = await fetch(url, { credentials: "include", cache, redirect, signal: stop.signal })
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ""
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return { status: response.status, url: response.url, type: response.type, contentType: response.headers.get("content-type") ?? "", body: btoa(binary) }
      } catch (error) {
        return { error: String(error) }
      } finally {
        clearTimeout(timer)
      }
    },
  })
  const got = result?.result as { status: number; url: string; type: string; contentType: string; body: string } | { error: string } | undefined
  // A redirect to another origin fails the followed fetch as a network failure does (work.ts asks
  // again without following)
  if (!got || "error" in got) throw new TypeError(got?.error ?? "The tab went away")
  // webRequest tells of the redirect apart from the fetch's answer: a moment for it to arrive
  if (got.type === "opaqueredirect") for (let look = 0; look < 10 && !redirects.has(url); look++) await sleep(100)
  const body = Uint8Array.from(atob(got.body), (c) => c.charCodeAt(0))
  const response = new Response(got.status === 0 || got.status === 204 ? null : body, { status: got.status || 200, headers: { "content-type": got.contentType } })
  Object.defineProperty(response, "url", { value: got.url || url })
  Object.defineProperty(response, "type", { value: got.type })
  return response
}
