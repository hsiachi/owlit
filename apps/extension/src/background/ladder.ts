import type { GateKey, WorkItem } from "@owlit/protocol"
import { ext } from "../lib/browser.ts"
import { serial } from "../lib/serial.ts"
import { isCheck, isInteractive, isThrough, siteOf } from "../lib/verdict.ts"
import { fetchFor, said, type Fetched, type FetchDeps } from "../lib/work.ts"

// How the extension fetches one of owlit's papers, step by step:
// 1. The background's own fetch, with the user's cookies. Skipped for a publisher whose check always
//    turns it away (WorkItem.inTab), when a tab will fetch instead.
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
}

// The page's HTML, as far as the verdict reads it; undefined when the extension may not read the tab.
// The verdict reads the PDF links too, and ACM's sit past the first megabyte of its article pages.
const DOCUMENT_MAX_CHARS = 4_000_000
export async function documentOf(tabId: number): Promise<{ url: string; html: string } | undefined> {
  try {
    const [result] = await ext.scripting.executeScript({
      target: { tabId },
      args: [DOCUMENT_MAX_CHARS],
      func: (max: number) => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, max) }),
    })
    return result?.result as { url: string; html: string } | undefined
  } catch {
    return undefined
  }
}

// ---- Redirects

// Where a fetch of the extension's was sent on (work.ts, FetchDeps.redirectedTo): fetch hides an opaque
// redirect's target, webRequest shows it. The worker's own requests (no tab; Chrome names the
// initiator, Firefox originUrl), and those of its own tabs' fetches: a PDF on another host (OUP's on
// Silverchair's) is reached by the tab's fetch without following, which webRequest shows the signed
// address of, and the worker fetches that. The newest per address, a few hundred in all.
const redirects = new Map<string, string>()
const REDIRECTS_KEPT = 500
const ownOrigin = () => new URL(ext.runtime.getURL("/")).origin
ext.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const from = details.initiator ?? (details as { originUrl?: string }).originUrl
    const worker = details.tabId === -1 && (!from || new URL(from).origin === ownOrigin())
    if (!worker && !workTabIds.has(details.tabId)) return
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

// One paper at a time per gate: its tab is the one place they are fetched from
const gates = new Map<GateKey, ReturnType<typeof serial>>()
const running = new Set<GateKey>()
const inLine = (gate: GateKey) => {
  let chain = gates.get(gate)
  if (!chain) gates.set(gate, (chain = serial()))
  return chain
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
export async function fetchLadder(item: WorkItem, deps: FetchDeps): Promise<Fetched> {
  // Without a tab of its own to fetch in, a tab-only publisher's paper is fetched as any other: through
  // the library's proxy its first answer may be the proxy's sign-in, and either way the ending names
  // the gate whose wait the paper goes under. A page the extension may not read is never opened in a
  // tab, which it couldn't read either: the background's fetch says so (no-permission).
  const skip = item.inTab && item.userStarted && (await deps.permitted(item.url))
  const worker = skip ? undefined : await fetchFor(item, deps)
  if (worker && !("ended" in worker && worker.ended === "check")) return worker
  if (!item.userStarted) return worker!
  await tabsLoaded
  return inLine(item.gate)(async () => {
    running.add(item.gate)
    try {
      // A tab that went away under it (the user closed it), or whose page couldn't be read, says nothing
      // of the paper: the check the background met, when it met one; else offline, which owlit asks for
      // again. Never a check made up at the paper's address, which through a proxy is the proxy's and
      // would hold every paper through it.
      return (await inOwnTab(item, deps)) ?? worker ?? { ended: "offline", host: hostOf(item.url) }
    } finally {
      running.delete(item.gate)
      setTimeout(() => void closeIdleTabs(), TAB_TIMES.idleMs + 1)
    }
  })
}

// The paper fetched from inside its gate's tab, opened for it or kept from the gate's last paper;
// undefined when the tab went away under it (the user closed it)
async function inOwnTab(item: WorkItem, deps: FetchDeps): Promise<Fetched | undefined> {
  const gate = item.gate
  let tab = await reusable(item)
  const reused = !!tab
  if (tab) {
    // The gate's next paper, at a reader's pace, its page loaded in the same tab: a check met there
    // again is the site's word that this is enough for now
    await sleep(Math.max(0, tab.lastAt + TAB_TIMES.gapMs - Date.now()))
    await ext.tabs.update(tab.tabId, { url: item.url }).catch(() => undefined)
    await loaded(tab.tabId)
  } else {
    const opened = await ext.tabs.create({ url: item.url, active: false })
    if (opened.id === undefined) return undefined
    tab = { tabId: opened.id, shown: false, lastAt: 0 }
    await keepTab(gate, tab)
    await loaded(tab.tabId)
  }
  const landed = await ext.tabs.get(tab.tabId).catch(() => undefined)
  if (!landed) {
    await keepTab(gate, undefined)
    return undefined
  }
  // Landed where the extension may not read (a proxy sends the browser on to a publisher the user
  // hasn't allowed): that site, to allow. The browser tells a tab's address only on a site the
  // extension may read, so one it doesn't tell is named by the gate's own site, never by the proxy's.
  if (!landed.url || !(await deps.permitted(landed.url))) {
    await letGo(gate, tab)
    const host = landed.url ? hostOf(landed.url) : item.sites?.[0]
    return host ? { ended: "no-permission", host } : undefined
  }
  const passed = await pass(tab, item, { once: reused })
  if (passed !== "through") {
    await letGo(gate, tab)
    return passed
  }
  // Fetched from where the paper's page landed: through a library proxy that sends the browser on to
  // the publisher (tlink), the proxy's address is another origin than the tab's, and only the tab's own
  // origin is fetched from inside it
  const at = (await ext.tabs.get(tab.tabId).catch(() => undefined))?.url
  const here = at && hostOf(at) !== hostOf(item.url) ? { ...item, url: at, proxied: false } : item
  const got = await fetchFor(here, { ...deps, fetch: tabFetch(tab.tabId), inTab: undefined })
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
  await keepTab(gate, tab.shown ? undefined : { ...tab, lastAt: Date.now() })
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
  if (!tab.shown && host && sites.some((site) => host === site || host.endsWith(`.${site}`))) return tab
  await keepTab(item.gate, undefined)
  return undefined
}

// Until the tab's page has loaded, or a while
function loaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      ext.tabs.onUpdated.removeListener(heard)
      ext.tabs.onRemoved.removeListener(gone)
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
    void ext.tabs
      .get(tabId)
      .then((tab) => tab.status === "complete" && done())
      .catch(done)
  })
}

// The tab's page past its check: "through", or what stands in the way as owlit hears it. A managed check
// is given its time hidden, then once in front; anything else in the way is the user's at once.
// once: a look and no more, on a tab whose check was passed before.
async function pass(tab: WorkTab, item: WorkItem, { once = false } = {}): Promise<"through" | Fetched | undefined> {
  const proxy = item.proxied ? { host: hostOf(item.url), entry: item.url } : undefined
  let until = Date.now() + TAB_TIMES.hiddenMs
  for (;;) {
    const seen = await documentOf(tab.tabId)
    if (!seen) return undefined
    const page = { url: seen.url, status: 0, html: seen.html, proxy }
    if (isThrough(page)) return "through"
    if (once || !isCheck(page) || isInteractive(page)) return said(page)
    if (Date.now() >= until) {
      if (tab.shown) return said(page)
      tab.shown = true
      // Kept so at once: a worker restarted meanwhile never closes it as idle
      await keepTab(item.gate, { ...tab })
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
  if (!tab.shown) await ext.tabs.remove(tab.tabId).catch(() => undefined)
}

// The gates' tabs with no paper of theirs going and none for a while: closed, but for one brought to the
// front, which is the user's and only forgotten
export async function closeIdleTabs() {
  const now = Date.now()
  for (const [gate, tab] of Object.entries(await tabsKept()) as [GateKey, WorkTab][]) {
    if (running.has(gate)) continue
    if (tab.shown) await keepTab(gate, undefined)
    else if (now - tab.lastAt >= TAB_TIMES.idleMs) {
      await keepTab(gate, undefined)
      await ext.tabs.remove(tab.tabId).catch(() => undefined)
    }
  }
}

// The user closed one of the gates' tabs
ext.tabs.onRemoved.addListener((tabId) => {
  if (!workTabIds.has(tabId)) return
  void (async () => {
    for (const [gate, tab] of Object.entries(await tabsKept()) as [GateKey, WorkTab][]) if (tab.tabId === tabId) await keepTab(gate, undefined)
  })()
})

// A fetch run inside a tab: the page fetches with its own standing at the site (same origin, its
// cookies, its Referer). An address of another origin is fetched by the background: the tab's fetch
// would need that site's CORS, and the address is one a redirect the tab saw signed (Silverchair's).
// The bytes come back base64, since what a script in a tab returns must be plain data.
export function tabFetch(tabId: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const tab = await ext.tabs.get(tabId).catch(() => undefined)
    if (!tab?.url) throw new TypeError("The tab went away")
    if (new URL(url).origin !== new URL(tab.url).origin) return fetch(url, { ...init, credentials: "include", cache: "no-store" })
    const redirect = init?.redirect ?? "follow"
    const [result] = await ext.scripting.executeScript({
      target: { tabId },
      args: [url, redirect],
      func: async (url: string, redirect: RequestRedirect) => {
        try {
          const response = await fetch(url, { credentials: "include", cache: "no-store", redirect })
          const bytes = new Uint8Array(await response.arrayBuffer())
          let binary = ""
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return { status: response.status, url: response.url, type: response.type, contentType: response.headers.get("content-type") ?? "", body: btoa(binary) }
        } catch (error) {
          return { error: String(error) }
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
  }) as typeof fetch
}
