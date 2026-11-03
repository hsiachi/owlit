import type { ExtensionView, ExtensionWait, OpenPage, Paper, ProxySettings, WorkAnswer, WorkItem } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { vi } from "vitest"
import { Core } from "../../core/src/core.ts"
import type { ExtensionServer } from "../../core/src/extension/server.ts"
import { ExtensionWork } from "../../core/src/extension/work.ts"
import type { FakeWeb } from "../../core/src/extension/test/fake-web.ts"
import { Library } from "../../core/src/library/library.ts"
import { OwlitError, type ask as askOwlit } from "../../../apps/extension/src/lib/owlit.ts"
import { mayRead } from "../../../apps/extension/src/lib/permissions.ts"
import { isBlocked, isThrough, siteOf } from "../../../apps/extension/src/lib/verdict.ts"
import { doWork } from "../../../apps/extension/src/lib/work.ts"
import { waitOf, waitWords } from "@/features/extension/wait-words"
import { batchView, outsideRows, siteRows, type BatchRow } from "@/features/library/lib/pdf-batch"
import { noPdfTitle, pdfColumnWord, pdfWait } from "@/features/library/lib/pdf-wait"
import { libraryNameOf, proxyHostOf } from "@/features/settings/library-name"

// The one place the bench talks to owlit: core's RPC methods and its extension routes, the shapes of
// their answers, and how the renderer's pure parts read them. Scenarios and invariants see only Bench
// and Screen, so a change of protocol is made here alone.
//
// Three layers, as they run in the app: a real Core on a fresh userData and workspace, its own fetch on
// the fake web; an "extension" running apps/extension's real doWork against core's real HTTP server, its
// fetches on the fake web as the user's browser (their cookies, their permissions); and a "renderer"
// that keeps what the window keeps (the batch, the pages opened) and draws the Library's PDF block and
// the waits with the window's own functions, from core's RPC answers.

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
// Short holds of GET /work, so a settle sees quickly that nothing more is due
const HOLD_MS = 20
// Rounds of GET /work with nothing to do before the bench counts the system as quiet: a paper handed over
// by an async step of core's (a restart's hand-over) lands in a later round
const QUIET_ROUNDS = 3
const MAX_ROUNDS = 300

// ---- What the user sees

export interface Row {
  kind: string
  papers: number
  host?: string
  // A wait's sentence after its count (waitWords.need)
  words?: string
  ids: string[]
}

export interface Block {
  // A batch the user started (Get PDFs) is up; otherwise the rows are the sites waiting
  batch: boolean
  total: number
  saved: number
  things: number
  running: boolean
  rows: Row[]
  // While a batch is up, the sites that wait for papers outside it
  outside: Row[]
}

export interface PaperView {
  hasPdf: boolean
  // The paper's card title (noPdfTitle) and its list column's word
  title: string
  word?: string
  // Where core says the paper is held for the user (its pdfState), and the wait the renderer finds for
  // it in the waits list (waitOf)
  heldAt?: { kind: string; host: string }
  foundUnder?: { kind: string; host: string }
}

export interface WaitView {
  kind: string
  host: string
  papers: number
  // The whole sentence, as Home and a notification say it
  what: string
  askedFor: boolean
}

export interface Screen {
  block: Block | null
  waits: WaitView[]
  papers: Record<string, PaperView>
  // The user's browser: its tabs, the sites the extension's card counts PDFs coming from after the user
  // got through (as background/index.ts keeps "going"), and the Allow pages it opened
  browser: { tabs: string[]; going: { host: string; done: number; total: number }[]; allowAsked: string[] }
}

// ---- The bench

export interface BenchSetup {
  // The library's proxy, as the user sets it in Settings
  proxy?: { preset: "tsinghua" } | { link: string }
  // Sites (registrable domains) the extension may not read until the user allows them
  denied?: string[]
  // Run after every step a scenario takes, on what the user then sees
  check?: (screen: Screen, step: string) => void
}

interface Workspace {
  root: string
}

export async function startBench(web: FakeWeb, setup: BenchSetup = {}): Promise<Bench> {
  const bench = new Bench(web, setup)
  await bench.boot()
  return bench
}

export class Bench {
  readonly web: FakeWeb
  readonly steps: string[] = []
  private readonly setup: BenchSetup
  private readonly base: string
  private readonly userDataDir: string
  private readonly workspaces: Record<string, Workspace> = {}
  private workspace = "main"
  private core!: Core
  private server!: ExtensionServer
  private readonly ext: Extension
  private ui = new Renderer()
  private offset = 0
  // Papers core handed to the extension's queue, in order (ExtensionWork.fetch), and core's hand-overs
  // still running (Library.handToExtension), so a settle waits for them
  private readonly handed: string[] = []
  private readonly busy = new Set<Promise<unknown>>()

  constructor(web: FakeWeb, setup: BenchSetup) {
    this.web = web
    this.setup = setup
    this.base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-bench-")))
    this.userDataDir = path.join(this.base, "userData")
    this.ext = new Extension(web, () => this.server.port!, new Set(setup.denied ?? []))
    const real = Date.now.bind(Date)
    vi.spyOn(Date, "now").mockImplementation(() => real() + this.offset)
    const fetch = ExtensionWork.prototype.fetch
    const handed = this.handed
    vi.spyOn(ExtensionWork.prototype, "fetch").mockImplementation(function (this: ExtensionWork, ...args) {
      handed.push(args[1].paperId)
      return fetch.apply(this, args)
    })
    const handTo = Library.prototype.handToExtension
    const busy = this.busy
    vi.spyOn(Library.prototype, "handToExtension").mockImplementation(function (this: Library) {
      const going = handTo.call(this)
      busy.add(going)
      void going.finally(() => busy.delete(going)).catch(() => undefined)
      return going
    })
  }

  async boot() {
    await this.startCore()
    if (this.setup.proxy) await this.call("settings.setProxy", this.setup.proxy)
    await this.ext.pair(this)
    // Asking for work is what makes the extension connected
    await this.ext.step()
  }

  async dispose() {
    await this.core.dispose()
    rmSync(this.base, { recursive: true, force: true })
  }

  // ---- The library

  // A paper in the Library, as an import leaves it: its record, no PDF, no try yet
  addPaper(doi: string, title: string): string {
    const id = `doi-${doi.replace(/\//g, "-")}`
    const dir = path.join(this.root(), "library/papers", id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, id, title, authors: [], ids: { doi }, fields: {} }))
    return id
  }

  // ---- What the user does

  // Find PDF (or Look again) on one paper: owlit's own routes, then the extension
  async findPdf(id: string) {
    await this.call("library.fetchPdf", { id })
    return this.step(`find the PDF of ${id}`)
  }

  // Get PDFs: the papers the Library offers it for (GetPdfsLine's), handed to the extension in one batch
  async getPdfs(only?: string[]) {
    await this.ui.refresh(this)
    const offered = Object.values(this.ui.papers).filter((p) => !p.pdf && p.ids.doi && !this.ui.batch?.ids.includes(p.id) && !p.pdfState?.extension && pdfWait(p) !== "manual" && pdfWait(p) !== "skipped")
    const ids = offered.map((p) => p.id).filter((id) => !only || only.includes(id))
    const from = this.handed.length
    const { queued } = await this.call("library.fetchPdfs", { ids })
    if (queued.length) this.ui.startBatch(queued)
    // Core looks each one up before it hands it over
    await vi.waitFor(() => {
      const now = new Set(this.handed.slice(from))
      if (!queued.every((id: string) => now.has(id))) throw new Error("core is still handing the batch to the extension")
    })
    return this.step(`get PDFs for ${queued.length} papers`)
  }

  // Stop on the batch's block
  async stop() {
    const ids = this.ui.batch?.ids ?? []
    this.ui.batch = null
    await this.call("library.stopFetchPdfs", { ids })
    return this.step("stop the batch")
  }

  // Dismiss the batch's summary
  async dismiss() {
    this.ui.batch = null
    return this.step("dismiss the batch")
  }

  // The button on a wait's row (actOnWait): the extension opens its page in the browser
  async clickWait(kind: string, host: string) {
    const opened = await this.call("extension.open", { kind, host })
    if (opened.by !== "none") this.ui.opened.push({ kind, host })
    return this.step(`click the ${kind} wait at ${host}`)
  }

  // I've signed in / I've verified it (resumeWait)
  async pressDone(host: string) {
    await this.call("extension.resume", { host })
    this.ui.opened = this.ui.opened.filter((o) => o.host !== host)
    return this.step(`press done at ${host}`)
  }

  // The user passes the check in the tab showing it; the extension watches that tab (watchForThrough)
  async passCheck(host: string) {
    this.web.clear(host)
    await this.ext.lookAtTabs()
    return this.step(`pass the check at ${host}`)
  }

  // The user signs in in their browser; the extension watches the tab
  async signIn(host: string) {
    this.web.signIn(host)
    await this.ext.lookAtTabs()
    return this.step(`sign in at ${host}`)
  }

  // Another network: the site's firewall lets the browser through, and the tab is loaded again
  async changeNetwork(host: string) {
    this.web.unblock(host)
    await this.ext.lookAtTabs()
    return this.step(`change network for ${host}`)
  }

  // Allow on the extension's Allow page: the site is granted, and the extension tells owlit
  async allow(site: string) {
    await this.ext.allow(site)
    return this.step(`allow ${site}`)
  }

  // A PDF dragged onto the paper
  async dropPdf(id: string, doi: string) {
    const file = path.join(this.base, `${id}.pdf`)
    writeFileSync(file, this.web.pdfOf(doi))
    await this.call("library.attachPdf", { id, path: file })
    return this.step(`drop a PDF on ${id}`)
  }

  // owlit quits and starts again on the same workspace; the extension keeps its pairing
  async restartCore() {
    await this.core.dispose()
    await this.startCore()
    this.ui = new Renderer()
    return this.step("restart owlit")
  }

  // The window reloads: what it kept (the batch, the pages opened) is gone
  async reloadRenderer() {
    this.ui = new Renderer()
    return this.step("reload the window")
  }

  // Another workspace opens in the window; the batch's papers aren't in it
  async openWorkspace(name: string) {
    this.workspace = name
    await this.call("workspace.open", { path: this.root() })
    return this.step(`open the workspace ${name}`)
  }

  // The machine sleeps this long: the clock jumps, what was waiting on it is due on waking
  async sleep(ms: number) {
    this.offset += ms
    return this.step(`sleep ${Math.round(ms / 60_000)} min`)
  }

  // ---- Running

  // The extension asks for work and does it, until nothing more happens by itself; then what the user
  // sees, with the bench's checks run on it
  async step(what: string): Promise<Screen> {
    await this.settle()
    this.steps.push(what)
    const screen = await this.screen()
    this.setup.check?.(screen, what)
    return screen
  }

  async settle() {
    let quiet = 0
    for (let round = 0; round < MAX_ROUNDS && quiet < QUIET_ROUNDS; round++) {
      await Promise.all(this.busy)
      const did = await this.ext.step()
      await this.ext.drain()
      quiet = did || this.busy.size ? 0 : quiet + 1
    }
  }

  async screen(): Promise<Screen> {
    await this.ui.refresh(this)
    return { ...this.ui.draw(), browser: this.ext.browser() }
  }

  // The papers the extension fetched, in the order it fetched them
  fetched(): string[] {
    return this.ext.fetched
  }

  // ---- Core

  async call(method: string, params?: unknown): Promise<any> {
    const response = await this.core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(`${method}: ${response.error.message}`), response.error)
    return response.result
  }

  private root() {
    this.workspaces[this.workspace] ??= { root: path.join(this.base, `ws-${this.workspace}`) }
    const { root } = this.workspaces[this.workspace]
    mkdirSync(root, { recursive: true })
    return root
  }

  private async startCore() {
    this.core = new Core({
      userDataDir: this.userDataDir,
      host: { fetch: this.web.fetchFor("core"), openInBrowser: async () => undefined, showBrowser: async () => undefined },
      retryBaseMs: 1,
      extension: { port: 0, holdMs: HOLD_MS, work: { gapMs: 0, proxyGapMs: 0 } },
    })
    await this.call("workspace.open", { path: this.root() })
    this.server = (this.core as unknown as { extension: ExtensionServer }).extension
    await this.server.start()
    // The window is open: pairing asks in it
    await this.call("ui.focus", { clientId: "window-1" })
  }
}

// ---- The extension in the user's browser

type Waits = WorkAnswer["waits"]

class Extension {
  token = ""
  readonly fetched: string[] = []
  private readonly web: FakeWeb
  private readonly port: () => number
  private readonly denied: Set<string>
  private readonly redirects = new Map<string, string>()
  private waits: Waits = []
  private readonly tabs: string[] = []
  private going: { host: string; done: number; total: number }[] = []
  private readonly allowAsked: string[] = []
  private readonly pending = new Set<Promise<unknown>>()

  constructor(web: FakeWeb, port: () => number, denied: Set<string>) {
    this.web = web
    this.port = port
    this.denied = denied
  }

  private readonly ask = (async (route: string, init: Parameters<typeof askOwlit>[1] = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN }
    if (init.token) headers.authorization = `Bearer ${init.token}`
    let body: BodyInit | undefined
    if (init.pdf) {
      headers["content-type"] = "application/pdf"
      body = init.pdf
    } else if (init.json !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(init.json)
    }
    const response = await fetch(`http://127.0.0.1:${this.port()}${route}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body })
    const text = await response.text()
    const parsed = text ? JSON.parse(text) : null
    if (!response.ok) throw new OwlitError(response.status, parsed ?? {})
    return parsed
  }) as typeof askOwlit

  private readonly readable = (url: string) => {
    try {
      return !this.denied.has(siteOf(new URL(url).hostname))
    } catch {
      return false
    }
  }

  private readonly permissions = {
    contains: async ({ origins }: { origins?: string[] }) => (origins ?? []).every((o) => !this.denied.has(siteOf(o.replace(/^https?:\/\/(\*\.)?/, "").replace(/\/.*$/, "")))),
  }

  // The pairing question, answered Allow in owlit's window
  async pair(bench: Bench) {
    const started = await this.ask<{ pairing: string }>("/pair", { json: { browser: "Chrome", extensionVersion: "0.1.0" } })
    const asking = await vi.waitFor(async () => {
      const [one] = ((await bench.call("extension.get")) as ExtensionView).asking
      if (!one) throw new Error("no pairing question yet")
      return one
    })
    await bench.call("extension.answer", { id: asking.id, allow: true })
    this.token = (await this.ask<{ token: string }>(`/pair/${started.pairing}`)).token
  }

  // One GET /work: the pages owlit asks to open, and the papers due, fetched beside it (keepAsking).
  // Whether it brought anything.
  async step(): Promise<boolean> {
    const answer = await this.ask<WorkAnswer>("/work", { token: this.token })
    this.waits = answer.waits
    for (const page of answer.open ?? []) this.openPage(page)
    for (const item of answer.work) this.doOne(item)
    return answer.work.length > 0 || (answer.open ?? []).length > 0
  }

  // Until every fetch out is answered, but those the web holds (a hanging answer)
  async drain() {
    await vi.waitFor(() => {
      if (this.pending.size > this.web.hanging()) throw new Error("the extension's fetches are still out")
    })
  }

  private doOne(item: WorkItem) {
    this.fetched.push(item.paperId)
    const going = doWork(item, {
      fetch: this.web.fetchFor("browser", { canRead: this.readable, redirects: this.redirects }),
      permitted: async (url) => this.readable(url),
      // A tab open at the site, past its check: the fake web lets the browser's every fetch through once
      // the check is passed, so the tab's fetch is the browser's own
      inTab: async (host) => (this.tabs.some((t) => new URL(t).hostname === host) ? this.web.fetchFor("browser") : undefined),
      redirectedTo: (url) => this.redirects.get(url),
      ask: this.ask,
      token: this.token,
    })
      .then((result) => {
        // background/index.ts cameAt: counted under the work item's host
        if ("pdf" in result) this.going = this.going.map((g) => (g.host === item.host ? { ...g, done: g.done + 1 } : g)).filter((g) => g.done < g.total)
      })
      .catch((error) => console.error("[bench] the extension's fetch failed", error))
      .finally(() => this.pending.delete(going))
    this.pending.add(going)
  }

  private openPage(page: OpenPage) {
    if (page.kind === "permission") this.allowAsked.push(page.host)
    else this.tabs.push(page.kind === "walk" ? page.step.url : page.url)
  }

  // Every tab at a site that waits for a check or a sign-in, loaded again: past it, owlit goes on there;
  // the site's block, owlit hears so (watchForThrough)
  async lookAtTabs() {
    // The waits the extension knows are the ones its last GET /work brought
    await this.step()
    for (const tab of this.tabs) {
      const seen = await this.load(tab)
      if (!seen) continue
      const wait = waitAt(this.waits, new URL(seen.url).hostname)
      if (!wait) continue
      if (isThrough({ url: seen.url, status: 0, html: seen.html, proxy: wait.proxied ? { host: wait.host } : undefined })) await this.resume(wait.host)
      else if (isBlocked(seen) && wait.kind !== "blocked") await this.ask("/work/blocked", { token: this.token, json: { host: wait.host, url: seen.url } })
    }
  }

  // The Allow page's Allow: the site is granted, and owlit goes on at every wait for it (resumePermitted)
  async allow(site: string) {
    this.denied.delete(site)
    await this.step()
    for (const wait of this.waits.filter((w) => w.kind === "permission")) {
      if (await mayRead(this.permissions, wait.host)) await this.resume(wait.host)
    }
  }

  // background/index.ts resume: owlit goes on, and the card counts the site's PDFs as they come
  private async resume(host: string) {
    const wait = this.waits.find((w) => w.host === host)
    await this.ask("/work/resume", { token: this.token, json: { host } })
    this.waits = this.waits.filter((w) => w.host !== host)
    if (wait) this.going = [...this.going.filter((g) => g.host !== host), { host, done: 0, total: wait.papers }]
  }

  // A tab's page as the user's browser shows it: every redirect followed, whatever the extension may read
  private async load(url: string) {
    try {
      const response = await this.web.fetchFor("browser")(url)
      return { url: response.url, html: await response.text() }
    } catch {
      return undefined
    }
  }

  browser(): Screen["browser"] {
    return { tabs: [...this.tabs], going: this.going.map((g) => ({ ...g })), allowAsked: [...this.allowAsked] }
  }
}

// background/index.ts waitAt: the sign-in or check this host's tab is under
const waitAt = (all: Waits, host: string) => all.find((w) => w.kind !== "permission" && (host === w.host || host.endsWith(`.${w.host}`)))

// ---- The window

class Renderer {
  papers: Record<string, Paper> = {}
  view: ExtensionView | null = null
  proxy: ProxySettings | undefined
  batch: { ids: string[]; at: number } | null = null
  opened: { kind: string; host: string }[] = []

  async refresh(bench: Bench) {
    const listed = (await bench.call("library.list")) as { papers: Paper[] }
    this.papers = Object.fromEntries(listed.papers.map((p) => [p.id, p]))
    this.view = (await bench.call("extension.get")) as ExtensionView
    this.proxy = (await bench.call("settings.get")).library.proxy
    // pruneOpened: an opened site that no longer waits for that goes
    this.opened = this.opened.filter((o) => this.view!.waits.some((w) => w.host === o.host && w.kind === o.kind))
  }

  // startBatch: a second Get PDFs adds to the first, keeping its start
  startBatch(ids: string[]) {
    this.batch = { ids: [...new Set([...(this.batch?.ids ?? []), ...ids])], at: this.batch?.at ?? Date.now() }
  }

  draw(): Omit<Screen, "browser"> {
    const waits = this.view?.waits ?? []
    const library = libraryNameOf(this.proxy)
    const row = (r: BatchRow): Row => {
      const words = r.kind === "sign-in" || r.kind === "check" || r.kind === "blocked" || r.kind === "permission" ? waitWords({ kind: r.kind, host: r.host ?? "", proxied: !!r.proxied }, r.papers, library).need : undefined
      return { kind: r.kind, papers: r.papers, ids: [...r.ids], ...(r.host !== undefined ? { host: r.host } : {}), ...(words ? { words } : {}) }
    }
    let block: Block | null = null
    const view = this.batch ? batchView(this.batch, this.papers) : null
    // PdfBlock: the batch's block while any of its papers is still in the library, else the sites waiting
    if (view && view.total > 0) {
      block = { batch: true, total: view.total, saved: view.saved, things: view.things, running: view.running, rows: view.rows.map(row), outside: outsideRows(waits, view.rows).map(row) }
    } else {
      const rows = siteRows(waits)
      if (rows.length) block = { batch: false, total: rows.reduce((n, r) => n + r.papers, 0), saved: 0, things: rows.length, running: false, rows: rows.map(row), outside: [] }
    }
    const proxyHost = proxyHostOf(this.proxy)
    const papers: Record<string, PaperView> = {}
    for (const p of Object.values(this.papers)) {
      const ext = p.pdfState?.extension
      const found = waitOf(p, waits)
      const word = pdfColumnWord(p)
      papers[p.id] = {
        hasPdf: !!p.pdf,
        title: p.pdf ? "" : noPdfTitle(p, proxyHost),
        ...(word ? { word } : {}),
        ...(ext?.waits ? { heldAt: { kind: ext.waits, host: ext.waitsAt ?? ext.host } } : {}),
        ...(found ? { foundUnder: { kind: found.kind, host: found.host } } : {}),
      }
    }
    return { block, waits: waits.map((w: ExtensionWait) => ({ kind: w.kind, host: w.host, papers: w.papers, what: waitWords(w, w.papers, library).what, askedFor: w.askedFor })), papers }
  }
}
