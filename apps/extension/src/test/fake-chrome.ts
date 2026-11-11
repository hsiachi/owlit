// A fake of the browser's extension APIs, as much of them as background/index.ts uses, so the background
// can be imported and run in vitest: storage that outlives a restarted worker, alarms, tabs whose
// documents and fetches come from a fake web, executeScript running the real injected function against
// that tab, webRequest's redirect events, and owlit itself on its port. Not a browser: no rendering, no
// CORS but the one rule the fetch ladder depends on (a tab's followed fetch to another origin fails).
//
// Two webs can stand behind it: a Site per host answering at once and asked again at every look at a tab
// (the background's own tests), or one Site for every host that may take its time (packages/pdf-bench's
// FakeWeb), whose page a tab keeps as loaded, as a real tab does.

import { LEGACY_WORK_ENDINGS, type WorkEnding } from "@owlit/protocol"
import { OWLIT_ORIGIN } from "../lib/owlit.ts"

type Listener = (...args: any[]) => unknown
export function event() {
  const listeners = new Set<Listener>()
  return {
    addListener: (listener: Listener) => void listeners.add(listener),
    removeListener: (listener: Listener) => void listeners.delete(listener),
    hasListener: (listener: Listener) => listeners.has(listener),
    emit: (...args: unknown[]) => [...listeners].map((listener) => listener(...args)),
    clear: () => listeners.clear(),
  }
}

function area(data: Record<string, unknown>, onChanged = event()) {
  return {
    data,
    onChanged,
    get: async (keys?: string | string[] | null) => {
      if (keys === undefined || keys === null) return { ...data }
      const wanted = typeof keys === "string" ? [keys] : keys
      return Object.fromEntries(wanted.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))
    },
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, { newValue: unknown }> = {}
      for (const [k, v] of Object.entries(items)) {
        data[k] = structuredClone(v)
        changes[k] = { newValue: v }
      }
      onChanged.emit(changes)
    },
    remove: async (keys: string | string[]) => {
      for (const k of typeof keys === "string" ? [keys] : keys) delete data[k]
    },
  }
}

// ---- The web

export interface Answer {
  status?: number
  html?: string
  pdf?: boolean
  headers?: Record<string, string>
  // A redirect there (302)
  redirect?: string
  // A page whose load never ends in a tab (a third-party script that never answers, as on a network that
  // blocks it): its document is parsed, and the tab stays "loading"
  stalls?: boolean
  // A page whose document is never parsed to its end (a script in its body that never answers): the
  // tab stays "loading", and a script not injected immediately never runs in it
  parserHeld?: boolean
  // A fetch from a tab that never answers, until its own signal aborts it
  hangs?: boolean
  // The PDF's own bytes, where pdf is set; PDF_BYTES otherwise
  bytes?: Uint8Array<ArrayBuffer>
  // Where the page sends its tab on once loaded: a meta refresh's target, or its own address for a managed
  // check that passed in the tab running it
  sendsTo?: string
}
// from: who asks; look: the tab's document looked at (executeScript reading it), not a fetch; signal: the
// request's end, when whoever asked gave up, or the worker that asked stopped
export interface SiteRequest {
  url: URL
  from: "worker" | "tab"
  look?: boolean
  tab?: FakeTab
  signal?: AbortSignal
}
export type Site = (request: SiteRequest) => Answer | undefined
// Every host's answers, which may take their time or fail as a network does
export type Web = (request: SiteRequest) => Promise<Answer>

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfake")

export interface FakeTab {
  id: number
  url: string
  active: boolean
  status: "loading" | "complete"
  // Its document's, as document.readyState says; and which document it is (performance.timeOrigin): a
  // new one for every page the tab loads
  readyState: "loading" | "interactive" | "complete"
  timeOrigin: number
  windowId: number
  openerTabId?: number
  // Where it is going, before the browser committed the address (url is "" until a first page does)
  pendingUrl?: string
  // The page it shows, as loaded (only with a Web); none on the browser's own error page
  document?: Answer
  // The load failed: the browser's error page, which no script may run in
  failed?: boolean
}

export interface Asked {
  route: string
  method: string
  json?: any
  pdf?: boolean
}

// owlit on this machine: GET /work answers what the test gives it, one answer at a time, and holds
// otherwise; every other request is noted and answered as core would. legacy: as an owlit of 0.2.x
// would (packages/core/src/extension/server.ts at v0.2.1): an ending it doesn't know, and a resume or a
// block that names a wait rather than a host, are refused with a 400.
export class FakeOwlit {
  readonly asked: Asked[] = []
  private answers: unknown[] = []
  private holding: ((answer: unknown) => void) | null = null
  private closed = false
  private readonly legacy: boolean
  // While set, POST /work/resume is heard and answered only once it settles
  resumeHeld: Promise<unknown> | undefined
  // Work items owlit no longer waits for (GET /work/:id)
  readonly unwanted = new Set<string>()

  constructor({ legacy = false } = {}) {
    this.legacy = legacy
  }

  give(answer: { work?: unknown[]; waits?: unknown[]; open?: unknown[]; going?: unknown[]; endings?: WorkEnding[] }) {
    const full = { work: [], waits: [], open: [], going: [], ...answer }
    if (this.holding) {
      const hold = this.holding
      this.holding = null
      hold(full)
    } else this.answers.push(full)
  }

  // Nothing answers any more: the background's asking ends
  close() {
    this.closed = true
    this.holding?.(undefined)
    this.holding = null
  }

  // owlit runs again, as after a restart
  reopen() {
    this.closed = false
  }

  posted(prefix: string) {
    return this.asked.filter((a) => a.method !== "GET" && a.route.startsWith(prefix))
  }

  async handle(route: string, init: RequestInit = {}): Promise<Response> {
    if (this.closed) throw new TypeError("Failed to fetch")
    const method = init.method ?? "GET"
    const type = new Headers(init.headers).get("content-type") ?? ""
    if (route.split("?")[0] === "/work" && method === "GET") {
      const answer = this.answers.shift() ?? (await new Promise((resolve) => (this.holding = resolve)))
      if (answer === undefined) throw new TypeError("Failed to fetch")
      return json(answer)
    }
    const body = type.includes("json") ? JSON.parse(String(init.body)) : undefined
    this.asked.push({ route, method, ...(body ? { json: body } : {}), ...(type.includes("pdf") ? { pdf: true } : {}) })
    if (this.legacy && method === "POST" && route.startsWith("/work/")) {
      const refused = route.startsWith("/work/resume") || route.startsWith("/work/blocked") ? typeof body?.host !== "string" : body && !LEGACY_WORK_ENDINGS.includes(body.ended as WorkEnding)
      if (refused) return new Response(JSON.stringify({ reason: "bad-request", message: "owlit couldn't read what the extension sent." }), { status: 400, headers: { "content-type": "application/json" } })
    }
    if (route === "/status") return json({ version: "0", workspace: { name: "w" }, connectedAt: 0, owlit: { id: "owlit-1", name: "owlit" } })
    if (route.startsWith("/work/") && method === "GET") return json({ wanted: !this.unwanted.has(decodeURIComponent(route.slice("/work/".length))) })
    if (route.startsWith("/work/resume")) {
      await this.resumeHeld
      return json({ resumed: true })
    }
    if (route.startsWith("/work/blocked")) return json({ blocked: true })
    if (route.startsWith("/work/")) return json(type.includes("pdf") ? { paper: { id: "p", title: "", hasPdf: true } } : { noted: true })
    if (route.startsWith("/papers") && method === "PUT") return json({ paper: { id: route.split("/")[2], title: "", hasPdf: true } })
    if (route.startsWith("/papers")) return json({ paper: null })
    if (route === "/pdfs") return json({ paper: { id: "placed", title: "", hasPdf: true } })
    if (route === "/walk") return json({ step: null })
    return json({})
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

// ---- The browser

// What answers on owlit's port
export interface Owlit {
  handle(route: string, init?: RequestInit): Promise<Response>
}

// One run of the extension's worker: the APIs its code is given, and its global fetch
export interface FakeWorker {
  chrome: typeof chrome
  fetch: typeof fetch
}

export interface FakeBrowser<O extends Owlit = FakeOwlit> {
  // The storage, kept when the worker stops
  kept: { local: Record<string, unknown>; session: Record<string, unknown> }
  chrome: typeof chrome
  owlit: O
  tabs: Map<number, FakeTab>
  // Every fetch made, by whom
  fetches: { url: string; from: "worker" | "tab"; redirect?: string }[]
  // The fetches in tabs that hung, and those of them the page aborted
  hung: string[]
  aborted: string[]
  // Tabs the extension opened, and those made active by it
  created: { url: string; active: boolean }[]
  // The background's looks at tabs' pages (executeScript): how many began, and how many are still
  // waiting for their document, which nothing else shows happening
  reads: { began: number; waiting: number }
  activated: number[]
  removed: number[]
  // The user opens a page in a tab of their own, and it is read
  openTab(url: string): Promise<FakeTab>
  // The user clicks a tab
  activate(id: number): void
  // The worker's fetch, as the background's global fetch
  fetch: typeof fetch
  // The worker stops, as Chrome stops one: nothing it was doing is answered any more, its fetches end, its
  // listeners are gone, and a timer of its that fires finds every API silent. Tabs and storage stay.
  stopWorker(): void
  // The APIs for the worker started now (see stopWorker)
  startWorker(): FakeWorker
  // An alarm fires
  alarm(name: string): void
  // The page in this tab loads again, as the user reloading it
  reload(id: number): Promise<void>
  // A site's permission granted: permissions.onAdded fires (denied, given as a function, says no more)
  granted(): void
  // The browser quits: its tabs close and its session storage empties; the worker stops
  quit(): void
  // The browser opens again: runtime.onStartup goes to the worker started before this
  started(): void
}

// kept: the storage of a browser whose extension worker restarts (Chrome keeps session storage while the
// browser runs). sites: by host. denied: hosts the extension may not read: permissions.contains says
// no, a tab there has no url (as without the tabs permission) and no script runs in it.
export function fakeBrowser<O extends Owlit = FakeOwlit>(sites: Record<string, Site> | Web, kept?: { local: Record<string, unknown>; session: Record<string, unknown> }, owlit: O = new FakeOwlit() as Owlit as O, denied: string[] | ((host: string) => boolean) = []): FakeBrowser<O> {
  const deniedHost = typeof denied === "function" ? denied : (host: string) => denied.includes(host)
  const deniedAt = (url: string) => {
    try {
      return deniedHost(new URL(url).hostname)
    } catch {
      return false
    }
  }
  // A tab as the extension is told it
  const told = (tab: FakeTab) => (deniedAt(tab.url) ? { ...tab, url: undefined } : { ...tab })
  const events: ReturnType<typeof event>[] = []
  const heard = () => {
    const made = event()
    events.push(made)
    return made
  }
  const local = area(kept?.local ?? {}, heard())
  const session = area(kept?.session ?? {}, heard())
  const tabs = new Map<number, FakeTab>()
  let nextTab = 100
  let documents = 0
  const fetches: FakeBrowser["fetches"] = []
  const hung: string[] = []
  const aborted: string[] = []
  const created: FakeBrowser["created"] = []
  const reads: FakeBrowser["reads"] = { began: 0, waiting: 0 }
  const activated: number[] = []
  const removed: number[] = []
  const onUpdated = heard()
  const onRemoved = heard()
  const onActivated = heard()
  const onBeforeRedirect = heard()
  const onHeadersReceived = heard()
  const onAlarm = heard()
  const onAdded = heard()
  const onStartup = heard()
  // The worker running now: stopping it ends what it has out
  let worker = { stopped: new AbortController() }

  const notFound: Answer = { status: 404, html: "<title>Not Found</title>" }
  const answerOf = async (url: URL, from: "worker" | "tab", tab?: FakeTab, signal?: AbortSignal): Promise<Answer> => (typeof sites === "function" ? sites({ url, from, tab, signal }) : (sites[url.hostname]?.({ url, from, tab }) ?? notFound))
  const responseOf = (answer: Answer, url: string) => {
    const response = answer.pdf
      ? new Response(answer.bytes ?? PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", ...answer.headers } })
      : new Response(answer.html ?? "", { status: answer.status ?? 200, headers: { "content-type": "text/html", ...answer.headers } })
    Object.defineProperty(response, "url", { value: url })
    return response
  }
  const opaque = () => ({ type: "opaqueredirect", status: 0, url: "", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response

  // The worker's fetch: owlit on its port, else the web. A followed redirect to a site the extension may
  // not read fails as a network failure does; webRequest still saw where it went.
  const workerFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    if (url.startsWith(OWLIT_ORIGIN)) return owlit.handle(url.slice(OWLIT_ORIGIN.length), init)
    if (deniedAt(url)) throw new TypeError("Failed to fetch")
    let at = new URL(url)
    const stopped = worker.stopped.signal
    const signal = init.signal ? AbortSignal.any([init.signal, stopped]) : stopped
    for (let hop = 0; hop < 10; hop++) {
      fetches.push({ url: at.href, from: "worker", ...(init.redirect ? { redirect: init.redirect } : {}) })
      const answer = await answerOf(at, "worker", undefined, signal)
      if (!answer.redirect) return responseOf(answer, at.href)
      const to = new URL(answer.redirect, at)
      onBeforeRedirect.emit({ url: at.href, redirectUrl: to.href, tabId: -1, type: "xmlhttprequest", initiator: "chrome-extension://fake" })
      if (init.redirect === "manual") return opaque()
      if (deniedAt(to.href)) throw new TypeError("Failed to fetch")
      at = to
    }
    throw new TypeError("Too many redirects")
  }) as typeof fetch

  // A fetch from inside a tab's page: same-origin redirects followed; one to another origin fails when
  // followed (no CORS there) and comes back opaque without following, webRequest seeing where it went
  const tabFetchOf = (tab: FakeTab) =>
    (async (input: string, init: RequestInit = {}) => {
      let at = new URL(input, tab.url)
      for (let hop = 0; hop < 10; hop++) {
        fetches.push({ url: at.href, from: "tab", ...(init.redirect ? { redirect: init.redirect } : {}) })
        if (at.origin !== new URL(tab.url).origin) throw new TypeError("Failed to fetch")
        const answer = await answerOf(at, "tab", tab, init.signal ?? undefined)
        if (answer.hangs) {
          hung.push(at.href)
          const url = at.href
          return new Promise<never>((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted.push(url)
              reject(new DOMException("The operation was aborted", "AbortError"))
            })
          })
        }
        if (!answer.redirect) return responseOf(answer, at.href)
        const to = new URL(answer.redirect, at)
        onBeforeRedirect.emit({ url: at.href, redirectUrl: to.href, tabId: tab.id, type: "xmlhttprequest", initiator: new URL(tab.url).origin })
        if (to.origin !== at.origin) {
          if (init.redirect === "manual") return opaque()
          throw new TypeError("Failed to fetch")
        }
        at = to
      }
      throw new TypeError("Too many redirects")
    }) as typeof fetch

  // A tab loads a page: redirects followed wherever they go, and the main frame's headers told as
  // webRequest tells them. The address is the tab's only once the browser has an answer to show, and a
  // load that never answers leaves the tab where it was. A newer load ends this one.
  const loads = new Map<number, AbortController>()
  const load = async (tab: FakeTab, url: string) => {
    loads.get(tab.id)?.abort()
    const going = new AbortController()
    loads.set(tab.id, going)
    tab.pendingUrl = url
    tab.status = "loading"
    const over = () => !tabs.has(tab.id) || going.signal.aborted
    let at = new URL(url)
    let answer: Answer | undefined
    if (/^https?:$/.test(at.protocol)) {
      try {
        answer = await answerOf(at, "tab", tab, going.signal)
        for (let hop = 0; hop < 10 && answer.redirect; hop++) {
          at = new URL(answer.redirect, at)
          answer = await answerOf(at, "tab", tab, going.signal)
        }
      } catch {
        answer = undefined
      }
      if (over()) return
    } else answer = {}
    const type = answer?.pdf ? "application/pdf" : "text/html"
    if (answer) onHeadersReceived.emit({ tabId: tab.id, url: at.href, type: "main_frame", statusCode: answer.status ?? 200, responseHeaders: Object.entries({ "content-type": type, ...answer.headers }).map(([name, value]) => ({ name, value })) })
    tab.url = at.href
    tab.pendingUrl = undefined
    tab.failed = !answer
    tab.status = "loading"
    tab.readyState = "loading"
    tab.timeOrigin = ++documents
    tab.document = typeof sites === "function" ? answer : undefined
    const loading = tab.timeOrigin
    onUpdated.emit(tab.id, { status: "loading", url: tab.url }, told(tab))
    setTimeout(() => {
      if (!tabs.has(tab.id) || tab.timeOrigin !== loading || answer?.parserHeld) return
      tab.readyState = "interactive"
      if (answer?.stalls) return
      tab.readyState = "complete"
      tab.status = "complete"
      onUpdated.emit(tab.id, { status: "complete" }, told(tab))
      if (answer?.sendsTo) void load(tab, answer.sendsTo)
    }, 0)
  }

  // executeScript runs the injected function itself, with the tab's page as its location, document and
  // fetch: an injected function can use nothing from where it was written, so this is what it sees
  const executeScript = async ({ target, func, args = [], files, injectImmediately }: { target: { tabId: number }; func?: (...a: any[]) => unknown; args?: unknown[]; files?: string[]; injectImmediately?: boolean }) => {
    const tab = tabs.get(target.tabId)
    if (!tab) throw new Error("No tab with id")
    reads.began++
    reads.waiting++
    while (!injectImmediately && tab.readyState === "loading" && tabs.has(tab.id)) await new Promise((resolve) => setTimeout(resolve, 1))
    reads.waiting--
    if (!tab.url || deniedAt(tab.url)) throw new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host.")
    if (tab.failed) throw new Error("Frame with ID 0 is showing error page")
    if (files || !func) return [{ result: undefined }]
    const page = () => (typeof sites === "function" ? (tab.document ?? {}) : (sites[new URL(tab.url).hostname]?.({ url: new URL(tab.url), from: "tab", tab, look: true }) ?? notFound))
    const scope = {
      location: { get href() {
        return tab.url
      } },
      document: {
        get readyState() {
          return tab.readyState
        },
        documentElement: { get outerHTML() {
          const answer = page()
          return answer.pdf ? "<embed type='application/pdf'>" : (answer.html ?? "")
        } },
      },
      performance: { get timeOrigin() {
        return tab.timeOrigin
      } },
      fetch: tabFetchOf(tab),
    }
    const run = new Function("location", "document", "performance", "fetch", `return (${func.toString()})`)(scope.location, scope.document, scope.performance, scope.fetch) as (...a: unknown[]) => unknown
    const showing = tab.timeOrigin
    const result = await run(...args)
    // A script doesn't outlive its document: the page moved on, and what it was doing is lost
    if (tab.timeOrigin !== showing) throw new Error("Frame with ID 0 was removed.")
    return [{ result }]
  }

  const front = (tab: FakeTab) => {
    for (const other of tabs.values()) other.active = false
    tab.active = true
    onActivated.emit({ tabId: tab.id, windowId: tab.windowId })
  }

  const tabApi = {
    create: async ({ url, active = true, openerTabId }: { url: string; active?: boolean; openerTabId?: number }) => {
      const tab: FakeTab = { id: nextTab++, url: "", active, status: "loading", readyState: "loading", timeOrigin: 0, windowId: 1, openerTabId }
      tabs.set(tab.id, tab)
      created.push({ url, active })
      if (active) front(tab)
      const going = load(tab, url)
      // The answers of a Web take their time, and the tab is the extension's before they come
      if (typeof sites !== "function") await going
      return { ...tab }
    },
    get: async (id: number) => {
      const tab = tabs.get(id)
      if (!tab) throw new Error(`No tab with id: ${id}`)
      return told(tab)
    },
    // Without the tabs permission, a url pattern matches only where the extension may read
    query: async ({ url }: { url?: string[] } = {}) =>
      [...tabs.values()].filter((t) => !url || (!deniedAt(t.url) && url.some((pattern) => new RegExp(`^${pattern.replace(/[.?]/g, "\\$&").replace(/\*/g, ".*")}$`).test(t.url)))).map(told),
    update: async (id: number, change: { active?: boolean; url?: string }) => {
      const tab = tabs.get(id)
      if (!tab) throw new Error(`No tab with id: ${id}`)
      if (change.active) {
        front(tab)
        activated.push(id)
      }
      if (change.url) {
        const going = load(tab, change.url)
        if (typeof sites !== "function") await going
      }
      return told(tab)
    },
    remove: async (id: number) => {
      if (!tabs.delete(id)) throw new Error(`No tab with id: ${id}`)
      loads.get(id)?.abort()
      removed.push(id)
      onRemoved.emit(id, {})
    },
    sendMessage: async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.")
    },
    onUpdated,
    onRemoved,
    onActivated,
  }

  const alarms = new Map<string, unknown>()
  const fake = {
    storage: { local, session },
    alarms: {
      create: async (name: string, info: unknown) => void alarms.set(name, info),
      clear: async (name: string) => alarms.delete(name),
      get: async (name: string) => (alarms.has(name) ? { name } : undefined),
      onAlarm,
    },
    tabs: tabApi,
    windows: { update: async () => ({}) },
    scripting: { executeScript, registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined },
    webRequest: { onBeforeRedirect, onHeadersReceived },
    runtime: {
      id: "fake",
      getURL: (path: string) => `chrome-extension://fake/${path.replace(/^\//, "")}`,
      getManifest: () => ({ version: "0.0.0", host_permissions: [], content_scripts: [] }),
      onMessage: heard(),
      onStartup,
      onInstalled: heard(),
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      getBadgeText: async () => "",
      setPopup: async () => undefined,
      onClicked: heard(),
    },
    permissions: { contains: async ({ origins = [] }: { origins?: string[] }) => !origins.some((origin) => deniedAt(origin.replace(/\*$/, ""))), getAll: async () => ({ origins: [] }), onAdded, onRemoved: heard() },
    contextMenus: { removeAll: async () => undefined, create: () => undefined, update: async () => undefined, onClicked: heard() },
    notifications: { create: async () => "" },
  }
  // What a worker is given: once it stopped, nothing it calls runs, and no answer of what it had out
  // reaches it. Pure lookups of its own (runtime) go on, for code a timer woke to fail on nothing.
  const silent = new Promise<never>(() => undefined)
  const quieted = <T extends object>(api: T, run: typeof worker): T =>
    new Proxy(api, {
      get(target, key) {
        const value = (target as Record<string | symbol, unknown>)[key]
        if (typeof value === "function")
          return (...args: unknown[]) => {
            if (run !== worker) return silent
            const result = (value as (...a: unknown[]) => unknown).apply(target, args)
            if (!(result instanceof Promise)) return result
            return result.then(
              (done) => (run === worker ? done : silent),
              (error) => {
                if (run === worker) throw error
                return silent
              },
            )
          }
        return value && typeof value === "object" && key !== "runtime" ? quieted(value as object, run) : value
      },
    })
  const stopWorker = () => {
    worker.stopped.abort(new DOMException("The worker stopped", "AbortError"))
    worker = { stopped: new AbortController() }
    for (const made of events) made.clear()
  }
  const startWorker = (): FakeWorker => {
    const run = worker
    const api = quieted(fake, run) as unknown as typeof chrome
    return { chrome: api, fetch: ((input: string, init?: RequestInit) => (run === worker ? quieted({ workerFetch }, run).workerFetch(input, init) : silent)) as typeof fetch }
  }

  return {
    chrome: fake as unknown as typeof chrome,
    owlit,
    tabs,
    fetches,
    hung,
    aborted,
    created,
    reads,
    activated,
    removed,
    activate: (id: number) => front(tabs.get(id)!),
    fetch: workerFetch,
    kept: { local: local.data, session: session.data },
    stopWorker,
    startWorker,
    alarm: (name) => void onAlarm.emit({ name }),
    reload: async (id) => {
      const tab = tabs.get(id)
      if (tab) await load(tab, tab.url || tab.pendingUrl!)
    },
    granted: () => void onAdded.emit({}),
    quit: () => {
      stopWorker()
      for (const id of [...tabs.keys()]) {
        tabs.delete(id)
        loads.get(id)?.abort()
      }
      for (const key of Object.keys(session.data)) delete session.data[key]
    },
    started: () => void onStartup.emit(),
    openTab: async (url: string) => {
      const tab = await tabApi.create({ url, active: true })
      // As the user sees it: the page read, its load done or still going
      await new Promise((resolve) => setTimeout(resolve, 0))
      return tabs.get(tab.id)!
    },
  }
}
