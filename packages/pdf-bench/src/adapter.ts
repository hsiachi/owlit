import type { ExtensionView, ExtensionWait, Paper, PdfRunView, ProxySettings, Task, WorkAnswer } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { vi } from "vitest"
import { Core } from "../../core/src/core.ts"
import { PdfWorkNotes } from "../../core/src/extension/pdf-work.ts"
import type { ExtensionServer } from "../../core/src/extension/server.ts"
import { CONNECTED_MS, ExtensionWork } from "../../core/src/extension/work.ts"
import { PARSER_HELD, SENDS_TO, type FakeWeb } from "../../core/src/extension/test/fake-web.ts"
import { Library } from "../../core/src/library/library.ts"
import { refreshOf, siteOf } from "../../../apps/extension/src/lib/verdict.ts"
import { fakeBrowser, type FakeBrowser, type Web } from "../../../apps/extension/src/test/fake-chrome.ts"
import { browserName, waitWords } from "@/features/extension/wait-words"
import { blockRows, type RowModel } from "@/features/library/lib/pdf-block-rows"
import { noPdfTitle, pdfColumnWord, pdfWait } from "@/features/library/lib/pdf-wait"
import { libraryNameOf } from "@/features/settings/library-name"

// The one place the bench talks to owlit: core's RPC methods and its extension routes, the shapes of
// their answers, and how the renderer's pure parts read them. Scenarios and invariants see only Bench
// and Screen, so a change of protocol is made here alone.
//
// Three layers, as they run in the app: a real Core on a fresh userData and workspace, its own fetch on
// the fake web; the extension's real background (apps/extension/src/background/index.ts and its fetch
// ladder) on a fake chrome.*, talking to core's real HTTP server, its fetches and tabs on the fake web
// as the user's browser (their cookies, their permissions); and a "renderer" that draws the Library's
// PDF block from core's run (ExtensionView.runs) and the waits with the window's own functions, from
// core's RPC answers.

// The extension's origin as the fake chrome names it
const ORIGIN = "chrome-extension://fake"
// Short holds of GET /work, so a settle sees quickly that nothing more is due
const HOLD_MS = 4
// Answered GET /work rounds with nothing new before the bench counts the system as quiet: a paper handed
// over by an async step of core's (a restart's hand-over) lands in a later round
const QUIET_ROUNDS = 3
// The same with the browser closed, with no asking to count: core's look at a paper ends in file work
const QUIET_CLOSED_MS = 60
// How long the bench waits for core or the extension to get somewhere, well under the test timeout
const PATIENCE = { timeout: 10_000, interval: 5 }
// The ladder's and the background's times, in proportion to each other, at the bench's pace
// fetchMs is the extension's own unless a setup asks: a story that holds an answer holds it past any such time
const TAB_TIMES = { hiddenMs: 30, shownMs: 30, lookMs: 2, loadMs: 300, gapMs: 3, idleMs: 15 }
const ASK_TIMES = { restartRetryMs: 5, throughEveryMs: 4, parsedEveryMs: 2 }
// Core's work on a PDF it has, which hands nothing to the extension
const READS_ONLY = new Set(["paper.text", "paper.parse"])
// Asked for before any test stubs it: the bench's own way to core's port
const realFetch = globalThis.fetch.bind(globalThis)

// ---- What the user sees

export interface Row {
  // A wait's kind, or manual, none, skipped, stopped, unreachable (held back by a host that didn't
  // answer), getting (being fetched), waiting (in line or not handed over yet), closed (in line with the
  // browser closed), away
  kind: string
  papers: number
  // A wait's row: the wait (ExtensionWait.id) and where it is shown (at); an unreachable row's host
  wait?: string
  host?: string
  // A wait's sentence after its count (waitWords.need)
  words?: string
  // The papers of a wait's, the manual and an unreachable row; the other rows are counts
  ids?: string[]
}

export interface Block {
  // A batch the user started (Get PDFs) is up; otherwise the rows are the sites waiting
  batch: boolean
  total: number
  // The batch's papers (PdfRunView.ids)
  ids: string[]
  // PDFs placed since the batch started, the user's own among them (byYou)
  saved: number
  byYou: number
  things: number
  running: boolean
  // The batch says when it ended (PdfRunView.endedAt)
  ended: boolean
  rows: Row[]
  // While a batch is up, the sites that wait for papers outside it
  outside: Row[]
}

export interface PaperView {
  hasPdf: boolean
  // The paper's card title (noPdfTitle) and its list column's word
  title: string
  word?: string
  // Its state's one name (pdfWait): for-check, manual, finding…
  state?: string
  // With the extension and under no wait: in line, or out for a try
  inLine?: boolean
  // The wait core says the paper is under (PdfState.extension.wait), and the one the window finds for it
  // in the waits list by that id
  heldAt?: string
  foundUnder?: string
}

export interface WaitView {
  // The gate it waits at (ExtensionWait.id)
  id: string
  kind: string
  // Where the user acts (ExtensionWait.at)
  host: string
  papers: number
  // The whole sentence, as Home and a notification say it
  what: string
  askedFor: boolean
  // The page its button opens (ExtensionWait.url), and where the extension watches for the user past it
  url: string
  watch: string[]
  // Its button says what the user did: the page opened, "I've signed in" pressed and asked again since
  opened: boolean
  retried?: boolean
}

export interface Screen {
  block: Block | null
  // Papers the extension has in line or out for a try, under no wait: what can still move by itself
  inLine: number
  // Gates core's tally says gave nothing lately, with no wait to say why (ExtensionWork.silentZeros)
  silent: string[]
  // Waits core has up with no paper under them, which the window never shows
  emptyWaits: string[]
  // The papers core's queues hold, those out for a try among them
  queued: number
  waits: WaitView[]
  papers: Record<string, PaperView>
  // The user's browser: its tabs, the sites the extension's popup says owlit goes on at after the user
  // got through (core's count in GET /work, as background/index.ts goingAt reads it), and the Allow
  // pages it opened
  browser: { tabs: string[]; going: { host: string; done: number; total: number }[]; allowAsked: string[] }
}

// ---- The bench

export interface BenchSetup {
  // The library's proxy, as the user sets it in Settings
  proxy?: { preset: "tsinghua" } | { link: string }
  // Sites (registrable domains) the extension may not read until the user allows them
  denied?: string[]
  // The ladder's times where a story needs its own (fetchMs: when the extension gives up on a fetch)
  times?: { fetchMs?: number; idleMs?: number }
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
  private opening: (() => Promise<unknown>) | undefined
  // The papers the user's last Find PDF or Get PDFs took
  asked: string[] = []

  constructor(web: FakeWeb, setup: BenchSetup) {
    this.web = web
    this.setup = setup
    this.base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-bench-")))
    this.userDataDir = path.join(this.base, "userData")
    this.ext = new Extension(web, () => this.server?.port, new Set(setup.denied ?? []), setup.times ?? {})
    const real = Date.now.bind(Date)
    vi.spyOn(Date, "now").mockImplementation(() => real() + this.offset)
    const fetch = ExtensionWork.prototype.fetch
    const handed = this.handed
    vi.spyOn(ExtensionWork.prototype, "fetch").mockImplementation(function (this: ExtensionWork, ...args) {
      handed.push(args[1].paperId)
      return fetch.apply(this, args)
    })
    const restore = ExtensionWork.prototype.restore
    const bench = this
    vi.spyOn(ExtensionWork.prototype, "restore").mockImplementation(async function (this: ExtensionWork, ...args) {
      const opening = bench.opening
      bench.opening = undefined
      await opening?.()
      return restore.apply(this, args)
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
    await this.ext.start()
    // Asking for work is what makes the extension connected
    await this.ext.answered()
  }

  async dispose() {
    this.ext.quit()
    await this.core.dispose()
    vi.unstubAllGlobals()
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
    await this.findPdfAsked(id)
    return this.step(`find the PDF of ${id}`)
  }

  async findPdfAsked(id: string) {
    await this.call("library.fetchPdf", { id })
    this.asked = [id]
  }

  // Get PDFs: the papers the Library offers it for (GetPdfsLine's), handed to the extension in one batch
  async getPdfs(only?: string[]) {
    await this.getPdfsAsked(only)
    return this.step(`get PDFs for ${this.asked.length} papers`)
  }

  // The same, the model told before the bench's checks look (asked)
  async getPdfsAsked(only?: string[]) {
    await this.ui.refresh(this)
    const offered = Object.values(this.ui.papers).filter((p) => !p.pdf && p.ids.doi && !p.pdfState?.extension && pdfWait(p) !== "manual" && pdfWait(p) !== "skipped")
    const ids = offered.map((p) => p.id).filter((id) => !only || only.includes(id))
    const from = this.handed.length
    const { queued } = await this.call("library.fetchPdfs", { ids })
    this.asked = queued
    // Core looks each one up before it hands it over
    await vi.waitFor(() => {
      const now = new Set(this.handed.slice(from))
      if (!queued.every((id: string) => now.has(id))) throw new Error("core is still handing the batch to the extension")
    }, PATIENCE)
  }

  // Get PDFs on these papers whatever they wait for (as library.fetchPdfs takes them from any caller),
  // looked at once core has handed them over, before the extension asks for any. The extension asks no
  // more until the next step.
  async getPdfsNow(ids: string[]) {
    await this.ext.hold()
    const from = this.handed.length
    const { queued } = await this.call("library.fetchPdfs", { ids })
    this.asked = queued
    await vi.waitFor(() => {
      const now = new Set(this.handed.slice(from))
      if (!queued.every((id: string) => now.has(id))) throw new Error("core is still handing the batch to the extension")
    }, PATIENCE)
    return this.glance()
  }

  // The extension asks for work once and does what it got; looked at before anything else moves
  async askOnce() {
    await this.ext.askOnce()
    return this.glance()
  }

  // The extension asks for nothing more until the next step
  hold() {
    return this.ext.hold()
  }

  // What the user sees now, in the middle of things: the bench's checks, which hold once everything
  // that moves by itself has moved, aren't run
  async glance(): Promise<Screen> {
    return this.screen()
  }

  // Stop on the batch's block: the run stops, and its block is put away
  async stop() {
    const run = await this.run()
    if (run) {
      await this.call("pdfRuns.stop", { run: run.id })
      await this.call("pdfRuns.dismiss", { run: run.id })
    }
    return this.step("stop the batch")
  }

  // Stop, with the block left up: its rows say what became of the papers
  async stopKeepingBlock() {
    const run = await this.run()
    if (run) await this.call("pdfRuns.stop", { run: run.id })
    return this.step("stop the batch, its block left up")
  }

  // Dismiss the batch's summary
  async dismiss() {
    const run = await this.run()
    if (run) await this.call("pdfRuns.dismiss", { run: run.id })
    return this.step("dismiss the batch")
  }

  // The run the block shows (PdfBlock reads the newest)
  private async run(): Promise<PdfRunView | undefined> {
    return ((await this.call("extension.get")) as ExtensionView).runs[0]
  }

  // The button on the row of the wait the window shows with this kind at this host (actOnWait): the
  // extension opens its page in the browser, and core notes it opened
  async clickWait(kind: string, host: string) {
    const wait = await this.shownWait((w) => w.kind === kind && w.at === host)
    if (wait) await this.call("extension.open", { wait: wait.id })
    return this.step(`click the ${kind} wait at ${host}`)
  }

  // I've signed in / I've verified it on the row of the wait shown at this host (resumeWait)
  async pressDone(host: string) {
    const wait = await this.shownWait((w) => w.at === host)
    if (wait) await this.call("extension.resume", { wait: wait.id })
    return this.step(`press done at ${host}`)
  }

  // The row the user presses on, as the window shows it now
  private async shownWait(which: (wait: ExtensionWait) => boolean) {
    return ((await this.call("extension.get")) as ExtensionView).waits.find(which)
  }

  // The user passes the check in the tab showing it; the extension watches that tab (watchForThrough)
  async passCheck(host: string) {
    this.web.clear(host)
    await this.ext.reloadTabs()
    return this.step(`pass the check at ${host}`)
  }

  // The user signs in in their browser; the extension watches the tab
  async signIn(host: string) {
    this.web.signIn(host)
    await this.ext.reloadTabs()
    return this.step(`sign in at ${host}`)
  }

  // Another network: the site's firewall lets the browser through, and the tab is loaded again
  async changeNetwork(host: string) {
    this.web.unblock(host)
    await this.ext.reloadTabs()
    return this.step(`change network for ${host}`)
  }

  // The user quits the browser the extension is in: it asks for no work, and once it hasn't for longer
  // than core counts it connected, the window says the papers with it wait for the browser
  async closeBrowser() {
    if (this.ext.closed) return this.step("the browser stays closed")
    await this.ext.hold()
    this.ext.quit()
    this.offset += CONNECTED_MS + 1
    return this.step("close the browser")
  }

  // The browser opens again, and the extension asks for work
  async openBrowser() {
    if (this.ext.closed) await this.ext.open()
    return this.step("open the browser")
  }

  // The user's network can reach the host again (a VPN turned on)
  async reach(host: string) {
    this.web.up(host)
    return this.step(`reach ${host}`)
  }

  // Allow on the extension's Allow page: the site is granted, and the extension tells owlit
  async allow(site: string) {
    this.ext.allow(site)
    return this.step(`allow ${site}`)
  }

  // The user opens a page in a tab of their own
  async openPage(url: string) {
    await this.ext.openPage(url)
    return this.step(`open ${url}`)
  }

  // The user clicks the tab showing a page at this host, and goes straight on to a page in a new tab
  async clickTabAndLeave(host: string, url: string) {
    this.ext.clickTab(host)
    await this.ext.openPage(url)
    return this.step(`click the tab at ${host}, and go on to ${url}`)
  }

  // Chrome stops the extension's worker and starts it again: what it had out is lost
  async restartWorker() {
    if (!this.ext.closed) {
      await this.ext.hold()
      await this.ext.restart()
    }
    return this.step("the worker restarts")
  }

  // A PDF dragged onto the paper
  async dropPdf(id: string, doi: string) {
    await this.attachPdf(id, doi)
    return this.step(`drop a PDF on ${id}`)
  }

  // The same, not looked at after: the window reads nothing until the workspace's waits are up
  async attachPdf(id: string, doi: string) {
    const file = path.join(this.base, `${id}.pdf`)
    writeFileSync(file, this.web.pdfOf(doi))
    await this.call("library.attachPdf", { id, path: file })
  }

  // owlit quits and starts again on the same workspace; the extension keeps its pairing. whileOpening:
  // what the user does once the workspace read what it kept, before its waits and queues are up.
  async restartCore({ whileOpening }: { whileOpening?: () => Promise<unknown> } = {}) {
    await this.core.dispose()
    this.ext.ownerGone()
    this.opening = whileOpening
    await this.startCore()
    this.ui = new Renderer()
    return this.step("restart owlit")
  }

  // owlit dies, once what it kept reached the disk (a note is written a moment after it changes): nothing
  // more is written on the way out, and it starts again from the file
  async crashCore() {
    const file = path.join((this.core as unknown as { workspace: { library: Library } }).workspace.library.dataDir!, "pdf-work.json")
    const notes = (this.server.work as unknown as { notes: PdfWorkNotes }).notes
    const unsaved = () => (notes as unknown as { timer?: unknown }).timer
    await vi.waitFor(() => {
      if (unsaved() || !existsSync(file)) throw new Error("the notes aren't on disk yet")
    }, PATIENCE)
    const flush = vi.spyOn(PdfWorkNotes.prototype, "flush").mockResolvedValue(undefined)
    await this.restartCore()
    flush.mockRestore()
    return this.step("owlit crashed and started again")
  }

  // The window reloads: it keeps nothing of its own; the run and the waits' follow-ups are core's
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
    await this.ext.hold()
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

  // Until nothing has moved for a few rounds of asking: every fetch out answered, but those the web
  // holds, no core look or hand-over running. A fetch that nothing ends fails here, naming it.
  async settle() {
    this.ext.go()
    const gaveUpAt = performance.now() + PATIENCE.timeout
    let seen = -1
    let asksThen = 0
    let quietSince = performance.now()
    for (let round = 0; ; round++) {
      await Promise.all(this.busy)
      if (this.lookingUp()) await this.lookups()
      const moved = this.ext.moved() + this.handed.length
      const going = this.busy.size > 0 || this.lookingUp() || this.ext.outstanding() > this.web.hanging()
      if (going || moved !== seen) {
        seen = moved
        asksThen = this.ext.asks
        quietSince = performance.now()
      } else if (this.ext.closed ? performance.now() - quietSince >= QUIET_CLOSED_MS : this.ext.asks - asksThen >= QUIET_ROUNDS) return
      if (performance.now() > gaveUpAt) throw new Error(`Nothing settles: ${this.ext.describe()}`)
      // What a stopped worker's alarm would start again, and the tabs' tidying
      if (round % 8 === 0) this.ext.tick()
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  }

  // Core's own looks at papers (a new paper's metadata and PDF lookups), which hand a miss to the
  // extension when they end; one due later (a back-off) isn't waited for
  private lookingUp() {
    const tasks = (this.core as unknown as { workspace?: { tasks: { list(): Task[] } } }).workspace?.tasks.list() ?? []
    return tasks.some((t) => t.kind.startsWith("paper.") && !READS_ONLY.has(t.kind) && (t.state === "queued" || t.state === "running") && !(t.notBefore && t.notBefore > Date.now()))
  }

  private lookups() {
    return vi.waitFor(() => {
      if (this.lookingUp()) throw new Error("core is still looking papers up")
    }, PATIENCE)
  }

  async screen(): Promise<Screen> {
    await this.ui.refresh(this)
    const work = this.server.work as unknown as { waitsAt: Map<string, unknown>; count(wait: unknown): number; lanes: Map<string, { inFlight?: unknown; queue: unknown[] }> }
    const emptyWaits = [...work.waitsAt].filter(([, wait]) => !work.count(wait)).map(([gate]) => gate)
    const queued = [...work.lanes.values()].reduce((n, lane) => n + lane.queue.length + (lane.inFlight ? 1 : 0), 0)
    return { ...this.ui.draw(), silent: this.server.work.silentZeros(), emptyWaits, queued, browser: this.ext.browserView() }
  }

  get browserClosed() {
    return this.ext.closed
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
    // Owlit's own pace with the web's real hosts: nothing here asks them
    const { http } = this.core as unknown as { http: { limit(host: string, limit: { perSecond: number; concurrent: number }): void } }
    for (const host of ["doi.org", "api.unpaywall.org"]) http.limit(host, { perSecond: 10_000, concurrent: 8 })
    await this.call("workspace.open", { path: this.root() })
    this.server = (this.core as unknown as { extension: ExtensionServer }).extension
    await this.server.start()
    // The window is open: pairing asks in it
    await this.call("ui.focus", { clientId: "window-1" })
  }
}

// ---- The extension in the user's browser

// The fake web as the fake browser sees it: a redirect, a PDF's bytes, or a page
const webOf =
  (web: FakeWeb): Web =>
  async ({ url, from, signal }) => {
    const response = await web.answer(url.href, "browser", signal, from)
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null
    if (location) return { status: response.status, redirect: location }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const headers = Object.fromEntries(response.headers)
    if (/^application\/pdf/.test(headers["content-type"] ?? "")) return { pdf: true, bytes }
    const html = new TextDecoder().decode(bytes)
    const sendsTo = headers[SENDS_TO] ?? refreshOf({ url: url.href, html })
    return { status: response.status, html, headers, ...(sendsTo ? { sendsTo } : {}), ...(headers[PARSER_HELD] ? { parserHeld: true } : {}) }
  }

// The real background in one fake browser, its every word to core going through handle: which tells the
// bench what is out (handed over, no answer yet) and lets a test hold the asking. A stopped worker
// loses what it had out, as core then finds.
class Extension {
  // The browser is closed: nothing asks owlit for work
  closed = false
  readonly fetched: string[] = []
  // GET /work answered
  asks = 0
  private readonly web: FakeWeb
  private readonly port: () => number | undefined
  private readonly denied: Set<string>
  private readonly times: BenchSetup["times"]
  private readonly browser: FakeBrowser<{ handle: (route: string, init?: RequestInit) => Promise<Response> }>
  // Items handed over and not answered yet, by id
  private readonly out = new Map<string, number>()
  private said = 0
  private asking = 0
  // GET /work may still be asked this many times; a held ask waits for its turn
  private allowed = Number.POSITIVE_INFINITY
  private readonly turns = new Set<() => void>()
  private readonly live = new Set<AbortController>()

  constructor(web: FakeWeb, port: () => number | undefined, denied: Set<string>, times: BenchSetup["times"]) {
    this.web = web
    this.port = port
    this.denied = denied
    this.times = times
    const deniedAt = (host: string) => this.denied.has(siteOf(host.replace(/^\*\./, "")))
    this.browser = fakeBrowser(webOf(web), undefined, { handle: this.handle }, deniedAt)
  }

  private readonly handle = async (route: string, init: RequestInit = {}): Promise<Response> => {
    const ask = /^\/work(\?|$)/.test(route) && (init.method ?? "GET") === "GET"
    const stop = new AbortController()
    this.live.add(stop)
    const signal = init.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal
    try {
      if (ask) await this.turn(signal)
      if (ask) this.asking++
      try {
        const response = await realFetch(`http://127.0.0.1:${this.port()}${route}`, { ...init, signal })
        const body = await response.arrayBuffer()
        if (ask && response.ok) this.heard(JSON.parse(new TextDecoder().decode(body)) as WorkAnswer)
        return new Response(body.byteLength ? body : null, { status: response.status, headers: response.headers })
      } finally {
        if (ask) this.asking--
        if (!ask) this.said++
        const answered = /^\/work\/([^/?]+)/.exec(route)
        if (answered && init.method === "POST") this.back(decodeURIComponent(answered[1]))
      }
    } finally {
      this.live.delete(stop)
    }
  }

  private heard(answer: WorkAnswer) {
    this.asks++
    for (const item of answer.work) {
      this.fetched.push(item.paperId)
      this.out.set(item.id, (this.out.get(item.id) ?? 0) + 1)
      this.said++
    }
    this.said += (answer.open ?? []).length
  }

  private back(id: string) {
    const left = (this.out.get(id) ?? 0) - 1
    if (left > 0) this.out.set(id, left)
    else this.out.delete(id)
  }

  private async turn(signal: AbortSignal) {
    while (this.allowed <= 0) {
      signal.throwIfAborted()
      await new Promise<void>((resolve) => {
        const go = () => {
          this.turns.delete(go)
          signal.removeEventListener("abort", go)
          resolve()
        }
        this.turns.add(go)
        signal.addEventListener("abort", go, { once: true })
      })
    }
    this.allowed--
  }

  private wake() {
    for (const go of [...this.turns]) go()
  }

  // The pairing question, answered Allow in owlit's window
  async pair(bench: Bench) {
    const headers = { "x-owlit-extension": ORIGIN, "content-type": "application/json" }
    const said = async <T>(route: string, init: RequestInit = {}) => (await (await this.handle(route, { ...init, headers })).json()) as T
    const started = await said<{ pairing: string }>("/pair", { method: "POST", body: JSON.stringify({ browser: "Chrome", extensionVersion: "0.1.0" }) })
    const asking = await vi.waitFor(async () => {
      const [one] = ((await bench.call("extension.get")) as ExtensionView).asking
      if (!one) throw new Error("no pairing question yet")
      return one
    }, PATIENCE)
    await bench.call("extension.answer", { id: asking.id, allow: true })
    Object.assign(this.browser.kept.local, await said<{ token: string; owlit: unknown }>(`/pair/${started.pairing}`))
  }

  // The worker starts, fresh: a module's own state doesn't outlive it
  async start() {
    const worker = this.browser.startWorker()
    vi.resetModules()
    vi.stubGlobal("chrome", worker.chrome)
    vi.stubGlobal("fetch", worker.fetch)
    const ladder = await import("../../../apps/extension/src/background/ladder.ts")
    Object.assign(ladder.TAB_TIMES, TAB_TIMES, this.times)
    const background = await import("../../../apps/extension/src/background/index.ts")
    Object.assign(background.ASK_TIMES, ASK_TIMES)
  }

  // Everything the worker had out is gone with it
  private lost() {
    for (const stop of [...this.live]) stop.abort(new DOMException("The worker stopped", "AbortError"))
    this.out.clear()
    this.wake()
  }

  // Chrome stopped the worker, and starts it again
  async restart() {
    this.browser.stopWorker()
    this.lost()
    await this.start()
  }

  quit() {
    this.browser.quit()
    this.lost()
    this.closed = true
  }

  async open() {
    this.closed = false
    await this.start()
    this.browser.started()
  }

  // owlit quit: what was out with it has no one to answer it
  ownerGone() {
    this.out.clear()
  }

  answered() {
    const then = this.asks
    return vi.waitFor(() => {
      if (this.asks === then) throw new Error("the extension hasn't asked for work")
    }, PATIENCE)
  }

  // Nothing more is asked of owlit, and no ask is being held there, until go or askOnce. Before the clock
  // jumps or the worker stops: an ask cut off on its way still reaches core, and counts as a later visit.
  async hold() {
    this.allowed = 0
    await vi.waitFor(() => {
      if (this.asking) throw new Error("an ask is still held")
    }, PATIENCE)
  }

  go() {
    this.allowed = Number.POSITIVE_INFINITY
    this.wake()
  }

  // One GET /work, and what it brought done
  async askOnce() {
    const then = this.asks
    this.allowed = 1
    this.wake()
    await vi.waitFor(() => {
      if (this.asks === then) throw new Error("the extension hasn't asked for work")
      if (this.outstanding() > this.web.hanging()) throw new Error("the extension's fetches are still out")
    }, PATIENCE)
  }

  outstanding() {
    return [...this.out.values()].reduce((n, count) => n + count, 0)
  }

  // A count that grows as anything happens between the browser, core and the web
  moved() {
    return this.said + this.web.log.length + this.browser.created.length + this.browser.removed.length + this.browser.activated.length
  }

  // The worker's alarm
  tick() {
    if (!this.closed) this.browser.alarm("work")
  }

  describe() {
    return `out with the extension: ${[...this.out.keys()].join(", ") || "nothing"}; the web holds ${this.web.hanging()}; tabs: ${[...this.browser.tabs.values()].map((t) => t.url || t.pendingUrl).join(", ") || "none"}`
  }

  // Every page open loads again: past what stood in it, the extension's look at the tab goes on from there
  async reloadTabs() {
    await Promise.all([...this.browser.tabs.values()].filter((tab) => !tab.url.startsWith("chrome-extension:")).map((tab) => this.browser.reload(tab.id)))
  }

  async openPage(url: string) {
    await this.browser.openTab(url)
  }

  clickTab(host: string) {
    const tab = [...this.browser.tabs.values()].find((t) => t.url && new URL(t.url).hostname === host)
    if (tab) this.browser.activate(tab.id)
  }

  // The Allow page's Allow: the site is granted, and the background hears it
  allow(site: string) {
    this.denied.delete(site)
    this.browser.granted()
  }

  browserView(): Screen["browser"] {
    const going = ((this.browser.kept.session.going ?? []) as NonNullable<WorkAnswer["going"]>).filter((g) => g.going.ended < g.going.ids.length).map((g) => ({ host: g.at, done: g.going.saved, total: g.going.ids.length }))
    const allowAsked = this.browser.created.filter((t) => t.url.includes("/allow.html")).map((t) => new URL(t.url).searchParams.get("host")!)
    return { tabs: [...this.browser.tabs.values()].map((t) => t.url).filter((url) => url && !url.startsWith("chrome-extension:")), going, allowAsked }
  }
}

// ---- The window

class Renderer {
  papers: Record<string, Paper> = {}
  view: ExtensionView | null = null
  proxy: ProxySettings | undefined

  // The window's papers and waits come by two notifications; read here by two calls, again until the
  // waits are the same on both sides of the papers, so a paper handed over between them isn't read as a
  // disagreement the window would only show for a moment
  async refresh(bench: Bench) {
    let before = JSON.stringify((await bench.call("extension.get")).waits)
    for (let tries = 0; tries < 20; tries++) {
      const listed = (await bench.call("library.list")) as { papers: Paper[] }
      this.papers = Object.fromEntries(listed.papers.map((p) => [p.id, p]))
      this.view = (await bench.call("extension.get")) as ExtensionView
      const after = JSON.stringify(this.view.waits)
      if (after === before) break
      before = after
    }
    this.proxy = (await bench.call("settings.get")).library.proxy
  }

  draw(): Omit<Screen, "browser" | "silent" | "emptyWaits" | "queued"> {
    const inLine = Object.values(this.papers).filter((p) => p.pdfState?.extension && !p.pdfState.extension.wait).length
    const waits = this.view?.waits ?? []
    const library = libraryNameOf(this.proxy)
    // useBrowserAway
    const away = this.view && !this.view.connected && this.view.paired.length ? browserName(this.view.paired) : undefined
    const waitRow = (wait: ExtensionWait, papers: number, ids?: string[]): Row => ({ kind: wait.kind, papers, wait: wait.id, host: wait.at, words: waitWords(wait, papers, library).need, ...(ids ? { ids: [...ids] } : {}) })
    const byPapers = (a: ExtensionWait, b: ExtensionWait) => b.papers - a.papers
    let block: Block | null = null
    const run = this.view?.runs[0]
    // PdfBlock: the run's block while any of its papers is still in the library, else the sites waiting
    if (run && run.total > 0) {
      const drawn = blockRows(run, waits, this.papers)
      const kinds: Record<string, string> = { going: "waiting" }
      const rowOf = (r: RowModel): Row => {
        if (r.kind === "wait") return waitRow(r.wait, r.papers, run.waits.find((w) => w.wait === r.wait.id)?.ids)
        if (r.kind === "manual") return { kind: "manual", papers: r.papers, ids: [...r.ids] }
        if (r.kind === "unreachable") return { kind: "unreachable", papers: r.papers, host: r.at, ids: [...(run.unreachable.find((u) => u.at === r.at)?.ids ?? [])] }
        return { kind: kinds[r.kind] ?? r.kind, papers: r.papers }
      }
      const rows = drawn.rows.map(rowOf)
      // A run's wait row the waits list doesn't have (PdfBlock draws none): drawn as such, which the
      // invariants then name
      for (const w of run.waits) if (!waits.some((one) => one.id === w.wait)) rows.push({ kind: "check", papers: w.papers, wait: w.wait, ids: [...w.ids] })
      const outside = drawn.outside.map(rowOf)
      block = { batch: true, total: run.total, ids: [...run.ids], saved: run.saved + run.byYou, byYou: run.byYou, things: run.waits.length, running: run.running, ended: run.endedAt !== undefined, rows, outside }
    } else if (waits.length) {
      block = { batch: false, total: waits.reduce((n, w) => n + w.papers, 0), ids: [], saved: 0, byYou: 0, things: waits.length, running: false, ended: false, rows: [...waits].sort(byPapers).map((w) => waitRow(w, w.papers)), outside: [] }
    }
    const papers: Record<string, PaperView> = {}
    for (const p of Object.values(this.papers)) {
      const ext = p.pdfState?.extension
      // usePaperWait: by the id core gives the paper
      const found = ext?.wait ? waits.find((w) => w.id === ext.wait) : undefined
      const word = pdfColumnWord(p, away)
      const state = pdfWait(p)
      papers[p.id] = {
        hasPdf: !!p.pdf,
        title: p.pdf ? "" : noPdfTitle(p, found, away),
        ...(word ? { word } : {}),
        ...(state ? { state } : {}),
        ...(ext && !ext.wait ? { inLine: true } : {}),
        ...(ext?.wait ? { heldAt: ext.wait } : {}),
        ...(found ? { foundUnder: found.id } : {}),
      }
    }
    return { block, inLine, waits: waits.map((w: ExtensionWait) => ({ id: w.id, kind: w.kind, host: w.at, papers: w.papers, what: waitWords(w, w.papers, library).what, askedFor: w.askedFor, url: w.url, watch: w.watch, opened: !!w.opened, ...(w.retried ? { retried: w.retried.again } : {}) })), papers }
  }
}
