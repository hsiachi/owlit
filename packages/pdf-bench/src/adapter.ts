import type { ExtensionView, ExtensionWait, OpenPage, Paper, PdfRunView, ProxySettings, Task, WorkAnswer, WorkItem } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { vi } from "vitest"
import { Core } from "../../core/src/core.ts"
import type { ExtensionServer } from "../../core/src/extension/server.ts"
import { CONNECTED_MS, ExtensionWork } from "../../core/src/extension/work.ts"
import type { FakeWeb } from "../../core/src/extension/test/fake-web.ts"
import { Library } from "../../core/src/library/library.ts"
import { OwlitError, type ask as askOwlit } from "../../../apps/extension/src/lib/owlit.ts"
import { mayRead } from "../../../apps/extension/src/lib/permissions.ts"
import { isBlocked, isThrough, siteOf } from "../../../apps/extension/src/lib/verdict.ts"
import { doWork } from "../../../apps/extension/src/lib/work.ts"
import { browserName, waitWords } from "@/features/extension/wait-words"
import { noPdfTitle, pdfColumnWord, pdfWait } from "@/features/library/lib/pdf-wait"
import { libraryNameOf } from "@/features/settings/library-name"

// The one place the bench talks to owlit: core's RPC methods and its extension routes, the shapes of
// their answers, and how the renderer's pure parts read them. Scenarios and invariants see only Bench
// and Screen, so a change of protocol is made here alone.
//
// Three layers, as they run in the app: a real Core on a fresh userData and workspace, its own fetch on
// the fake web; an "extension" running apps/extension's real doWork against core's real HTTP server, its
// fetches on the fake web as the user's browser (their cookies, their permissions); and a "renderer"
// that draws the Library's PDF block from core's run (ExtensionView.runs) and the waits with the window's
// own functions, from core's RPC answers.

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
// Short holds of GET /work, so a settle sees quickly that nothing more is due
const HOLD_MS = 20
// Rounds of GET /work with nothing to do before the bench counts the system as quiet: a paper handed over
// by an async step of core's (a restart's hand-over) lands in a later round
const QUIET_ROUNDS = 3
const MAX_ROUNDS = 300
// How long the bench waits for core or the extension to get somewhere, well under the test timeout
const PATIENCE = { timeout: 10_000, interval: 10 }

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
  // PDFs placed since the batch started, the user's own among them (byYou)
  saved: number
  byYou: number
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
  // Its state's one name (pdfWait): for-check, manual, finding…
  state?: string
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
}

export interface Screen {
  block: Block | null
  // Papers the extension has in line or out for a try, under no wait: what can still move by itself
  inLine: number
  // Gates core's tally says gave nothing lately, with no wait to say why (ExtensionWork.silentZeros)
  silent: string[]
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
    const offered = Object.values(this.ui.papers).filter((p) => !p.pdf && p.ids.doi && !p.pdfState?.extension && pdfWait(p) !== "manual" && pdfWait(p) !== "skipped")
    const ids = offered.map((p) => p.id).filter((id) => !only || only.includes(id))
    const from = this.handed.length
    const { queued } = await this.call("library.fetchPdfs", { ids })
    // Core looks each one up before it hands it over
    await vi.waitFor(() => {
      const now = new Set(this.handed.slice(from))
      if (!queued.every((id: string) => now.has(id))) throw new Error("core is still handing the batch to the extension")
    }, PATIENCE)
    return this.step(`get PDFs for ${queued.length} papers`)
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

  // The user quits the browser the extension is in: it asks for no work, and once it hasn't for longer
  // than core counts it connected, the window says the papers with it wait for the browser
  async closeBrowser() {
    this.ext.closed = true
    this.offset += CONNECTED_MS + 1
    return this.step("close the browser")
  }

  // The browser opens again, and the extension asks for work
  async openBrowser() {
    this.ext.closed = false
    return this.step("open the browser")
  }

  // The user's network can reach the host again (a VPN turned on)
  async reach(host: string) {
    this.web.up(host)
    return this.step(`reach ${host}`)
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
      await this.lookups()
      const did = await this.ext.step()
      await this.ext.drain()
      quiet = did || this.busy.size || this.lookingUp() ? 0 : quiet + 1
    }
  }

  // Core's own looks at papers (a new paper's metadata and PDF lookups), which hand a miss to the
  // extension when they end; one due later (a back-off) isn't waited for
  private lookingUp() {
    const tasks = (this.core as unknown as { workspace?: { tasks: { list(): Task[] } } }).workspace?.tasks.list() ?? []
    return tasks.some((t) => t.kind.startsWith("paper.") && (t.state === "queued" || t.state === "running") && !(t.notBefore && t.notBefore > Date.now()))
  }

  private lookups() {
    return vi.waitFor(() => {
      if (this.lookingUp()) throw new Error("core is still looking papers up")
    }, PATIENCE)
  }

  async screen(): Promise<Screen> {
    await this.ui.refresh(this)
    return { ...this.ui.draw(), silent: this.server.work.silentZeros(), browser: this.ext.browser() }
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
  // The browser is closed: nothing asks owlit for work
  closed = false
  readonly fetched: string[] = []
  private readonly web: FakeWeb
  private readonly port: () => number
  private readonly denied: Set<string>
  private readonly redirects = new Map<string, string>()
  private waits: Waits = []
  private readonly tabs: string[] = []
  private going: NonNullable<WorkAnswer["going"]> = []
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
    }, PATIENCE)
    await bench.call("extension.answer", { id: asking.id, allow: true })
    this.token = (await this.ask<{ token: string }>(`/pair/${started.pairing}`)).token
  }

  // One GET /work: the pages owlit asks to open, and the papers due, fetched beside it (keepAsking).
  // Whether it brought anything.
  async step(): Promise<boolean> {
    if (this.closed) return false
    const answer = await this.ask<WorkAnswer>("/work", { token: this.token })
    this.waits = answer.waits
    this.going = answer.going ?? []
    for (const page of answer.open ?? []) this.openPage(page)
    for (const item of answer.work) this.doOne(item, answer.endings)
    return answer.work.length > 0 || (answer.open ?? []).length > 0
  }

  // Until every fetch out is answered, but those the web holds (a hanging answer)
  async drain() {
    await vi.waitFor(() => {
      if (this.pending.size > this.web.hanging()) throw new Error("the extension's fetches are still out")
    }, PATIENCE)
  }

  private doOne(item: WorkItem, endings: WorkAnswer["endings"]) {
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
      endings,
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
      if (isThrough({ url: seen.url, status: 0, html: seen.html, proxy: wait.proxied ? { host: wait.at } : undefined })) await this.resume(wait)
      else if (isBlocked(seen) && wait.kind !== "blocked") await this.ask("/work/blocked", { token: this.token, json: { wait: wait.id, url: seen.url } })
    }
  }

  // The Allow page's Allow: the site is granted, and owlit goes on at every wait for it (resumePermitted)
  async allow(site: string) {
    this.denied.delete(site)
    await this.step()
    for (const wait of this.waits.filter((w) => w.kind === "permission")) {
      if (await mayRead(this.permissions, wait.at)) await this.resume(wait)
    }
  }

  // background/index.ts resume: owlit goes on at the wait, named by its id
  private async resume(wait: Waits[number]) {
    await this.ask("/work/resume", { token: this.token, json: { wait: wait.id } })
    this.waits = this.waits.filter((w) => w.id !== wait.id)
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
    const going = this.going.filter((g) => g.going.ended < g.going.ids.length).map((g) => ({ host: g.at, done: g.going.saved, total: g.going.ids.length }))
    return { tabs: [...this.tabs], going, allowAsked: [...this.allowAsked] }
  }
}

// background/index.ts waitAt: the sign-in or check whose watched hosts this tab's host is one of, or under
const waitAt = (all: Waits, host: string) => all.find((w) => w.kind !== "permission" && w.watch.some((h) => host === h || host.endsWith(`.${h}`)))

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

  draw(): Omit<Screen, "browser" | "silent"> {
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
      const rows: Row[] = []
      for (const w of run.waits) {
        const wait = waits.find((one) => one.id === w.wait)
        // A run's wait row the waits list doesn't have: drawn as such, which the invariants then name
        rows.push(wait ? waitRow(wait, w.papers, w.ids) : { kind: "check", papers: w.papers, wait: w.wait, ids: [...w.ids] })
      }
      if (run.manual.ids.length) rows.push({ kind: "manual", papers: run.manual.ids.length, ids: [...run.manual.ids] })
      for (const [kind, papers] of [["none", run.none], ["skipped", run.skipped], ["stopped", run.stopped]] as const) if (papers) rows.push({ kind, papers })
      for (const u of run.unreachable) rows.push({ kind: "unreachable", papers: u.papers, host: u.at, ids: [...u.ids] })
      for (const [kind, papers] of [["getting", run.getting], ["waiting", run.going], ["closed", run.closed], ["away", run.away]] as const) if (papers) rows.push({ kind, papers })
      const outside = waits.filter((w) => !run.waits.some((r) => r.wait === w.id)).sort(byPapers).map((w) => waitRow(w, w.papers))
      block = { batch: true, total: run.total, saved: run.saved + run.byYou, byYou: run.byYou, things: run.waits.length, running: run.running, rows, outside }
    } else if (waits.length) {
      block = { batch: false, total: waits.reduce((n, w) => n + w.papers, 0), saved: 0, byYou: 0, things: waits.length, running: false, rows: [...waits].sort(byPapers).map((w) => waitRow(w, w.papers)), outside: [] }
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
        ...(ext?.wait ? { heldAt: ext.wait } : {}),
        ...(found ? { foundUnder: found.id } : {}),
      }
    }
    return { block, inLine, waits: waits.map((w: ExtensionWait) => ({ id: w.id, kind: w.kind, host: w.at, papers: w.papers, what: waitWords(w, w.papers, library).what, askedFor: w.askedFor })), papers }
  }
}
