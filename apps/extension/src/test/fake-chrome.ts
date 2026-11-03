// A fake of the browser's extension APIs, as much of them as background/index.ts uses, so the background
// can be imported and run in vitest: storage that outlives a restarted worker, alarms, tabs whose
// documents and fetches come from a fake web, executeScript running the real injected function against
// that tab, webRequest's redirect events, and owlit itself on its port. Not a browser: no rendering, no
// CORS but the one rule the fetch ladder depends on (a tab's followed fetch to another origin fails).

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
  }
}

function area(data: Record<string, unknown>) {
  const onChanged = event()
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
}
// from: who asks; look: the tab's document looked at (executeScript reading it), not a fetch
export type Site = (request: { url: URL; from: "worker" | "tab"; look?: boolean; tab?: FakeTab }) => Answer | undefined

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nfake")

export interface FakeTab {
  id: number
  url: string
  active: boolean
  status: "loading" | "complete"
  windowId: number
  openerTabId?: number
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

  constructor({ legacy = false } = {}) {
    this.legacy = legacy
  }

  give(answer: { work?: unknown[]; waits?: unknown[]; open?: unknown[]; going?: unknown[] }) {
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
  }

  posted(prefix: string) {
    return this.asked.filter((a) => a.method !== "GET" && a.route.startsWith(prefix))
  }

  async handle(route: string, init: RequestInit = {}): Promise<Response> {
    if (this.closed) throw new TypeError("Failed to fetch")
    const method = init.method ?? "GET"
    const type = new Headers(init.headers).get("content-type") ?? ""
    if (route === "/work" && method === "GET") {
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
    if (route.startsWith("/work/resume")) return json({ resumed: true })
    if (route.startsWith("/work/blocked")) return json({ blocked: true })
    if (route.startsWith("/work/")) return json(type.includes("pdf") ? { paper: { id: "p", title: "", hasPdf: true } } : { noted: true })
    if (route.startsWith("/papers")) return json({ paper: null })
    if (route === "/walk") return json({ step: null })
    return json({})
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

// ---- The browser

export interface FakeBrowser {
  chrome: typeof chrome
  owlit: FakeOwlit
  tabs: Map<number, FakeTab>
  // Every fetch made, by whom
  fetches: { url: string; from: "worker" | "tab"; redirect?: string }[]
  // Tabs the extension opened, and those made active by it
  created: { url: string; active: boolean }[]
  activated: number[]
  removed: number[]
  // The user opens a page in a tab of their own
  openTab(url: string): Promise<FakeTab>
  // The worker's fetch, as the background's global fetch
  fetch: typeof fetch
}

// kept: the storage of a browser whose extension worker restarts (Chrome keeps session storage while the
// browser runs). sites: by host. denied: hosts the extension may not read: permissions.contains says
// no, a tab there has no url (as without the tabs permission) and no script runs in it.
export function fakeBrowser(sites: Record<string, Site>, kept?: { local: Record<string, unknown>; session: Record<string, unknown> }, owlit = new FakeOwlit(), denied: string[] = []): FakeBrowser & { kept: { local: Record<string, unknown>; session: Record<string, unknown> } } {
  const deniedAt = (url: string) => {
    try {
      return denied.includes(new URL(url).hostname)
    } catch {
      return false
    }
  }
  // A tab as the extension is told it
  const told = (tab: FakeTab) => (deniedAt(tab.url) ? { ...tab, url: undefined } : { ...tab })
  const local = area(kept?.local ?? {})
  const session = area(kept?.session ?? {})
  const tabs = new Map<number, FakeTab>()
  let nextTab = 100
  const fetches: FakeBrowser["fetches"] = []
  const created: FakeBrowser["created"] = []
  const activated: number[] = []
  const removed: number[] = []
  const onUpdated = event()
  const onRemoved = event()
  const onBeforeRedirect = event()

  const answerOf = (url: URL, from: "worker" | "tab", tab?: FakeTab, look?: boolean): Answer => sites[url.hostname]?.({ url, from, tab, look }) ?? { status: 404, html: "<title>Not Found</title>" }
  const responseOf = (answer: Answer, url: string) => {
    const response = answer.pdf
      ? new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf", ...answer.headers } })
      : new Response(answer.html ?? "", { status: answer.status ?? 200, headers: { "content-type": "text/html", ...answer.headers } })
    Object.defineProperty(response, "url", { value: url })
    return response
  }
  const opaque = () => ({ type: "opaqueredirect", status: 0, url: "", headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response

  // The worker's fetch: owlit on its port, else the web, following redirects anywhere
  const workerFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    if (url.startsWith(OWLIT_ORIGIN)) return owlit.handle(url.slice(OWLIT_ORIGIN.length), init)
    let at = new URL(url)
    for (let hop = 0; hop < 10; hop++) {
      fetches.push({ url: at.href, from: "worker", ...(init.redirect ? { redirect: init.redirect } : {}) })
      const answer = answerOf(at, "worker")
      if (!answer.redirect) return responseOf(answer, at.href)
      const to = new URL(answer.redirect, at)
      onBeforeRedirect.emit({ url: at.href, redirectUrl: to.href, tabId: -1, type: "xmlhttprequest", initiator: "chrome-extension://fake" })
      if (init.redirect === "manual") return opaque()
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
        const answer = answerOf(at, "tab", tab)
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

  // A tab loads a page: redirects followed wherever they go
  const load = (tab: FakeTab, url: string) => {
    let at = new URL(url)
    for (let hop = 0; hop < 10; hop++) {
      const answer = answerOf(at, "tab", tab)
      if (!answer.redirect) break
      at = new URL(answer.redirect, at)
    }
    tab.url = at.href
    tab.status = "loading"
    onUpdated.emit(tab.id, { status: "loading", url: tab.url }, { ...tab })
    setTimeout(() => {
      if (!tabs.has(tab.id)) return
      tab.status = "complete"
      onUpdated.emit(tab.id, { status: "complete" }, { ...tab })
    }, 0)
  }

  // executeScript runs the injected function itself, with the tab's page as its location, document and
  // fetch: an injected function can use nothing from where it was written, so this is what it sees
  const executeScript = async ({ target, func, args = [], files }: { target: { tabId: number }; func?: (...a: any[]) => unknown; args?: unknown[]; files?: string[] }) => {
    const tab = tabs.get(target.tabId)
    if (!tab) throw new Error("No tab with id")
    if (deniedAt(tab.url)) throw new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host.")
    if (files || !func) return [{ result: undefined }]
    const page = () => answerOf(new URL(tab.url), "tab", tab, true)
    const scope = {
      location: { get href() {
        return tab.url
      } },
      document: { documentElement: { get outerHTML() {
        const answer = page()
        return answer.pdf ? "<embed type='application/pdf'>" : (answer.html ?? "")
      } } },
      fetch: tabFetchOf(tab),
    }
    const run = new Function("location", "document", "fetch", `return (${func.toString()})`)(scope.location, scope.document, scope.fetch) as (...a: unknown[]) => unknown
    return [{ result: await run(...args) }]
  }

  const tabApi = {
    create: async ({ url, active = true, openerTabId }: { url: string; active?: boolean; openerTabId?: number }) => {
      const tab: FakeTab = { id: nextTab++, url, active, status: "loading", windowId: 1, openerTabId }
      tabs.set(tab.id, tab)
      created.push({ url, active })
      load(tab, url)
      return { ...tab }
    },
    get: async (id: number) => {
      const tab = tabs.get(id)
      if (!tab) throw new Error(`No tab with id: ${id}`)
      return told(tab)
    },
    query: async ({ url }: { url?: string[] } = {}) =>
      [...tabs.values()].filter((t) => !url || url.some((pattern) => new RegExp(`^${pattern.replace(/[.?]/g, "\\$&").replace(/\*/g, ".*")}$`).test(t.url))).map((t) => ({ ...t })),
    update: async (id: number, change: { active?: boolean; url?: string }) => {
      const tab = tabs.get(id)
      if (!tab) throw new Error(`No tab with id: ${id}`)
      if (change.active) {
        tab.active = true
        activated.push(id)
      }
      if (change.url) load(tab, change.url)
      return { ...tab }
    },
    remove: async (id: number) => {
      if (!tabs.delete(id)) throw new Error(`No tab with id: ${id}`)
      removed.push(id)
      onRemoved.emit(id, {})
    },
    sendMessage: async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.")
    },
    onUpdated,
    onRemoved,
    onActivated: event(),
  }

  const alarms = new Map<string, unknown>()
  const fake = {
    storage: { local, session },
    alarms: {
      create: async (name: string, info: unknown) => void alarms.set(name, info),
      clear: async (name: string) => alarms.delete(name),
      get: async (name: string) => (alarms.has(name) ? { name } : undefined),
      onAlarm: event(),
    },
    tabs: tabApi,
    windows: { update: async () => ({}) },
    scripting: { executeScript, registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined },
    webRequest: { onBeforeRedirect, onHeadersReceived: event() },
    runtime: {
      id: "fake",
      getURL: (path: string) => `chrome-extension://fake/${path.replace(/^\//, "")}`,
      getManifest: () => ({ version: "0.0.0", host_permissions: [], content_scripts: [] }),
      onMessage: event(),
      onStartup: event(),
      onInstalled: event(),
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      getBadgeText: async () => "",
      setPopup: async () => undefined,
      onClicked: event(),
    },
    permissions: { contains: async ({ origins = [] }: { origins?: string[] }) => !origins.some((origin) => deniedAt(origin.replace(/\*$/, ""))), getAll: async () => ({ origins: [] }), onAdded: event(), onRemoved: event() },
    contextMenus: { removeAll: async () => undefined, create: () => undefined, update: async () => undefined, onClicked: event() },
    notifications: { create: async () => "" },
  }
  return {
    chrome: fake as unknown as typeof chrome,
    owlit,
    tabs,
    fetches,
    created,
    activated,
    removed,
    fetch: workerFetch,
    kept: { local: local.data, session: session.data },
    openTab: async (url: string) => {
      const tab = await tabApi.create({ url, active: true })
      return tabs.get(tab.id)!
    },
  }
}
