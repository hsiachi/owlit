import {
  isTaskFinished,
  RpcErrorCode,
  type Highlight,
  type LibraryChange,
  type LibrarySettings,
  type Paper,
  type PaperNote,
  type PaperPatch,
  type PaperRecord,
  type PaperText,
  type ResolvedPaper,
  type TaskPriority,
} from "@owlit/protocol"
import { watch, type FSWatcher } from "node:fs"
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { HttpError, type Http } from "../net/http.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskDefinition } from "../tasks/index.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { OWLIT_DIR } from "../workspace/paths.ts"
import { isPaperId, paperDir, PAPERS_DIR, paperStateDir } from "./paths.ts"
import { keepSources, PaperIndex, readRecord, recordFrom, writeRecord } from "./records.ts"
import {
  describeFailure,
  downloadPdf,
  hasPdfFile,
  landingOf,
  pdfFile,
  readAcquisition,
  routesFor,
  unpaywallRoutes,
  writeAcquisition,
  type Attempt,
} from "./pdf.ts"
import { paperIdOf, parseRef, refOfIds } from "./refs.ts"
import { readText, writeText } from "./text/files.ts"
import { extractText, UnreadablePdf } from "./text/extract.ts"
import { NotAPaper, resolve, type Resolution } from "./resolve.ts"
import {
  applyPatch,
  freshState,
  hasPdf,
  readHighlights,
  readNote,
  readState,
  toPaper,
  writeHighlights,
  writeNote,
  writeState,
} from "./state.ts"

// How long a looked-up paper is kept, so adding it right after doesn't ask the services again
const RESOLUTION_TTL_MS = 10 * 60_000
// How long changes under library/papers/ settle before they are read
const SETTLE_MS = 300

export interface LibraryServices {
  http: Http
  // pdfium's wasm, where the desktop app ships it; tests and the CLI find it in the package
  pdfiumWasm?: string
  // Read at each use, so a key the user adds applies at once
  settings: () => Promise<LibrarySettings>
}

const notFound = (id: string) => new RpcFailure(RpcErrorCode.NotFound, "That paper is not in the library.", { id })

// The workspace's papers: library/papers/<id>/ (what each paper is) and .owlit/papers/<id>/ (what the
// user thinks of it). Changes from the app are answered, not echoed; changes core makes on its own (a
// task) or another program makes go out through onChange.
export class Library {
  readonly root: string
  // This workspace's folder in owlit's data directory (machine-specific state)
  readonly dataDir: string
  readonly index: PaperIndex
  private readonly services: LibraryServices
  private resolutions = new Map<string, { resolution: Resolution; at: number }>()
  private scheduler: Scheduler | undefined
  private onChange: (change: LibraryChange) => void = () => {}
  private watcher: FSWatcher | null = null
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  // Writes, one at a time, so a paper's files never race
  private writing: Promise<unknown> = Promise.resolve()

  constructor(root: string, dataDir: string, services: LibraryServices) {
    this.root = root
    this.dataDir = dataDir
    this.services = services
    this.index = new PaperIndex(root)
  }

  // The scheduler that runs this library's tasks (paper.metadata and what follows an add)
  attach(scheduler: Scheduler) {
    this.scheduler = scheduler
  }

  // ---- Reading

  // Every paper, with every highlight and note
  async list(): Promise<{ papers: Paper[]; highlights: Highlight[]; notes: PaperNote[] }> {
    const papers: Paper[] = []
    const highlights: Highlight[] = []
    const notes: PaperNote[] = []
    for (const id of await this.ids()) {
      const paper = await this.get(id)
      if (!paper) continue
      papers.push(paper)
      highlights.push(...(await readHighlights(this.root, id)))
      const note = await readNote(this.root, id)
      if (note) notes.push(note)
    }
    return { papers, highlights, notes }
  }

  // The paper, or undefined when its folder has no readable paper.json
  async get(id: string): Promise<Paper | undefined> {
    if (!isPaperId(id)) return undefined
    const record = await readRecord(this.root, id)
    if (!record) return undefined
    // A paper put here by another program has no state yet: it counts as added when it appeared
    const state = (await readState(this.root, id)) ?? freshState("user", record.fetchedAt ?? Date.now())
    const pdf = await hasPdf(this.root, id)
    const paper = toPaper({ ...record, id }, state, pdf)
    if (!pdf) {
      const acquisition = await readAcquisition(this.root, id)
      // Routes skipped (Unpaywall without an email) weren't tried, so they aren't named
      const tried = acquisition?.tried.filter((t) => !t.error?.startsWith("Not tried")).map((t) => t.route)
      if (acquisition?.result === "no_pdf") paper.noPdf = { tried: [...new Set(tried)], at: acquisition.at }
    }
    return paper
  }

  // ---- Looking up

  // What a reference means, and whether the library already has it. Asks the services directly rather
  // than as a task: someone is waiting, nothing is written, and each service's rate still holds.
  async resolve(input: string, signal?: AbortSignal): Promise<{ paper: ResolvedPaper; existingId?: string }> {
    const ref = parseRef(input)
    if (ref && ref.kind !== "url") {
      // The library may know it without asking anyone
      const existingId = await this.index.find({ [ref.kind]: ref.value })
      const record = existingId ? await readRecord(this.root, existingId) : undefined
      if (existingId && record) return { paper: { id: existingId, ...pick(record) }, existingId }
    }
    let resolution: Resolution
    try {
      resolution = await resolve(this.services.http, ref ?? input, await this.services.settings(), { signal, retries: 1 })
    } catch (error) {
      throw asRpcFailure(error)
    }
    this.remember(resolution)
    const existingId = await this.index.find(resolution.ids)
    return { paper: { id: resolution.id, ...pick(resolution) }, existingId }
  }

  // For each input, the paper in the library it names, offline
  async known(inputs: string[]): Promise<(string | null)[]> {
    return Promise.all(
      inputs.map(async (input) => {
        const ref = parseRef(input)
        if (!ref || ref.kind === "url") return null
        return (await this.index.find({ [ref.kind]: ref.value })) ?? null
      }),
    )
  }

  // ---- Changing

  // Adds a looked-up paper; one the library already has (under any of its ids) is returned as it is
  add(resolved: ResolvedPaper, addedBy: Paper["addedBy"] = "user", priority: TaskPriority = "asked"): Promise<Paper> {
    return this.serial(async () => {
      const id = resolved.id ?? paperIdOf(resolved.ids)
      if (!id || !isPaperId(id)) throw new RpcFailure(RpcErrorCode.InvalidParams, "owlit can't tell which paper that is.")
      const existing = await this.index.find(resolved.ids)
      if (existing) return (await this.get(existing))!
      const resolution = this.recent(id)
      const record: PaperRecord = resolution
        ? recordFrom(id, resolution)
        : clean({
            version: 1 as const,
            id,
            ids: resolved.ids,
            title: resolved.title,
            authors: resolved.authors,
            year: resolved.year,
            venue: resolved.venue,
            abstract: resolved.abstract,
            kind: resolved.kind,
            fields: {},
          })
      await mkdir(paperDir(this.root, id), { recursive: true })
      if (resolution) await keepSources(this.root, id, resolution.records)
      await writeRecord(this.root, record)
      await writeState(this.root, id, freshState(addedBy))
      this.index.set(id, record.ids)
      // What a lookup didn't fill, the services fill now; then the steps that follow an add
      if (!resolution) this.queue("paper.metadata", id, priority)
      for (const kind of ["paper.pdf", "paper.text", "index.paper"]) this.queue(kind, id, priority)
      return (await this.get(id))!
    })
  }

  // The user's judgement, position or corrections
  update(id: string, patch: PaperPatch): Promise<Paper> {
    return this.serial(async () => {
      const record = await readRecord(this.root, id)
      if (!record) throw notFound(id)
      const state = (await readState(this.root, id)) ?? freshState("user", record.fetchedAt)
      await writeState(this.root, id, applyPatch(state, record, patch))
      return (await this.get(id))!
    })
  }

  // To .owlit/trash/, both halves, so restore() (Undo) brings everything back
  remove(ids: string[]): Promise<null> {
    return this.serial(async () => {
      const stamp = Date.now()
      for (const id of ids) {
        if (!isPaperId(id)) continue
        this.scheduler?.cancelSubject(id)
        const trash = this.trashDir(stamp, id)
        await mkdir(trash, { recursive: true })
        await rename(paperDir(this.root, id), path.join(trash, "paper")).catch(ignoreMissing)
        await rename(paperStateDir(this.root, id), path.join(trash, "state")).catch(ignoreMissing)
        this.index.delete(id)
      }
      return null
    })
  }

  // The most recent removal of each paper, put back
  restore(ids: string[]): Promise<Paper[]> {
    return this.serial(async () => {
      const trashRoot = path.join(this.root, OWLIT_DIR, "trash")
      const entries = (await readdir(trashRoot).catch(() => [] as string[])).sort().reverse()
      const restored: Paper[] = []
      for (const id of ids) {
        const entry = entries.find((name) => name.endsWith(`-paper-${id}`))
        if (!entry) continue
        const trash = path.join(trashRoot, entry)
        await mkdir(path.dirname(paperDir(this.root, id)), { recursive: true })
        await mkdir(path.dirname(paperStateDir(this.root, id)), { recursive: true })
        await rename(path.join(trash, "paper"), paperDir(this.root, id)).catch(ignoreMissing)
        await rename(path.join(trash, "state"), paperStateDir(this.root, id)).catch(ignoreMissing)
        await rm(trash, { recursive: true, force: true })
        const paper = await this.get(id)
        if (!paper) continue
        this.index.set(id, paper.ids)
        restored.push(paper)
      }
      return restored
    })
  }

  // Adds a highlight, or replaces the one with its id
  putHighlight(highlight: Highlight): Promise<null> {
    return this.serial(async () => {
      if (!(await readRecord(this.root, highlight.paperId))) throw notFound(highlight.paperId)
      const all = await readHighlights(this.root, highlight.paperId)
      const at = all.findIndex((h) => h.id === highlight.id)
      if (at >= 0) all[at] = highlight
      else all.push(highlight)
      await writeHighlights(this.root, highlight.paperId, all)
      return null
    })
  }

  removeHighlight(paperId: string, id: string): Promise<Highlight | null> {
    return this.serial(async () => {
      const all = await readHighlights(this.root, paperId)
      const removed = all.find((h) => h.id === id)
      if (!removed) return null
      await writeHighlights(
        this.root,
        paperId,
        all.filter((h) => h.id !== id),
      )
      return removed
    })
  }

  setNote(paperId: string, content: string): Promise<PaperNote> {
    return this.serial(async () => {
      if (!(await readRecord(this.root, paperId))) throw notFound(paperId)
      return writeNote(this.root, paperId, content)
    })
  }

  // Looks for the paper's PDF now (the user asked) and waits; the paper as it then is
  async fetchPdf(id: string): Promise<Paper> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    if (!this.scheduler?.knows("paper.pdf")) throw new RpcFailure(RpcErrorCode.Unavailable, "owlit can't look for PDFs here.")
    const task = await this.scheduler.run("paper.pdf", id, "waiting")
    const paper = await this.get(id)
    if (!paper) throw notFound(id)
    if (!paper.pdf && task.state === "failed") throw new RpcFailure(RpcErrorCode.Unavailable, task.error ?? "owlit couldn't look for a PDF.")
    return paper
  }

  // The paper's full text with where each line sits, or null before it has been read
  async text(id: string): Promise<PaperText | null> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    return (await readText(this.root, id)) ?? null
  }

  // A PDF the user found, placed as the paper's file; the steps that need it follow
  attachPdf(id: string, file: string): Promise<Paper> {
    return this.serial(async () => {
      if (!(await readRecord(this.root, id))) throw notFound(id)
      const handle = await open(file, "r").catch(() => {
        throw new RpcFailure(RpcErrorCode.NotFound, "That file can't be opened.", { file })
      })
      const head = Buffer.alloc(5)
      await handle.read(head, 0, 5, 0)
      await handle.close()
      if (head.toString("latin1") !== "%PDF-") throw new RpcFailure(RpcErrorCode.InvalidParams, "That file isn't a PDF.")
      // A download still looking must not replace the user's file when it lands
      const looking = this.scheduler?.list().find((t) => t.kind === "paper.pdf" && t.subject === id && !isTaskFinished(t))
      if (looking) this.scheduler!.cancel(looking.id)
      const dest = pdfFile(this.root, id)
      await copyFile(file, `${dest}.part`)
      await rename(`${dest}.part`, dest)
      const previous = await readAcquisition(this.root, id)
      await writeAcquisition(this.root, id, {
        version: 1,
        result: "ok",
        route: "dropped",
        tried: [...(previous?.tried ?? []), { route: "dropped", url: file, at: Date.now() }],
        at: Date.now(),
        dropHere: dest,
      })
      for (const kind of ["paper.text", "index.paper"]) this.queue(kind, id, "asked")
      return (await this.get(id))!
    })
  }

  // Steps a paper is owed but never got (a PDF put in by hand or by another program, a run that failed
  // in an older build): its text, read now, in the background
  private async catchUp() {
    for (const id of await this.ids()) {
      if ((await hasPdfFile(this.root, id)) && !(await readText(this.root, id))) this.queue("paper.text", id, "background")
    }
  }

  // Papers left without a PDF get another try once a day: open copies appear over time
  private async retryMissingDaily() {
    const file = path.join(this.dataDir, "library.json")
    const today = new Date().toISOString().slice(0, 10)
    const kept = (await readJson<{ missingRetriedOn?: string }>(file).catch(() => undefined)) ?? {}
    if (kept.missingRetriedOn === today) return
    await writeJsonAtomic(file, { ...kept, missingRetriedOn: today })
    for (const id of await this.ids()) {
      if ((await readAcquisition(this.root, id))?.result === "no_pdf" && !(await hasPdfFile(this.root, id))) this.queue("paper.pdf", id, "background")
    }
  }

  // ---- Hearing about changes

  // Changes core makes on its own and changes other programs make under library/papers/
  async watch(onChange: (change: LibraryChange) => void) {
    this.onChange = onChange
    void this.retryMissingDaily().catch((error) => console.error("[core] couldn't retry missing PDFs", error))
    void this.catchUp().catch((error) => console.error("[core] couldn't catch up on the library", error))
    // A library that can't be read yet still opens; lookups just find less
    await this.index.load().catch((error) => console.error("[core] couldn't read the library", error))
    if (this.watcher) return
    const prefix = PAPERS_DIR.split(path.sep).join("/") + "/"
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      const rel = filename ? filename.split(path.sep).join("/") : ""
      // A tree made at once can come as one event for its top folder (library, library/papers): look
      // at every paper then, as when the system names nothing
      if (!rel || prefix.startsWith(rel + "/") || rel + "/" === prefix) {
        this.dirty.add("*")
      } else {
        if (!rel.startsWith(prefix)) return
        const id = rel.slice(prefix.length).split("/")[0]
        if (!isPaperId(id)) return
        this.dirty.add(id)
      }
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.settle(), SETTLE_MS)
    })
    this.watcher.on("error", (error) => console.error("[core] the library watcher stopped", error))
  }

  dispose() {
    clearTimeout(this.timer)
    this.watcher?.close()
    this.watcher = null
  }

  // ---- Tasks

  tasks(): TaskDefinition[] {
    return [
      // The PDF's text layer as text.json (lines and where they sit) and text.md. MinerU's text, once
      // there, is better and is left alone. A paper with no PDF has nothing to read.
      defineTask("paper.text", {
        lane: "cpu",
        retries: 1,
        run: async (ctx) => {
          const id = ctx.task.subject
          if (!(await readRecord(this.root, id))) throw new TaskFailure(`${id} is not in the library.`)
          if (!(await hasPdfFile(this.root, id))) {
            if ((await readAcquisition(this.root, id))?.result === "no_pdf") return
            ctx.require("paper.pdf", id)
          }
          const existing = await readText(this.root, id, { withTime: true })
          if (existing && (existing.text.source !== "pdfium" || existing.at >= (await mtimeOf(pdfFile(this.root, id))))) return
          let text: PaperText
          try {
            text = await extractText(await readFile(pdfFile(this.root, id)), {
              wasmPath: this.services.pdfiumWasm,
              signal: ctx.signal,
              onPage: (done, total) => ctx.progress(done, total),
            })
          } catch (error) {
            if (error instanceof UnreadablePdf) throw new TaskFailure(error.message)
            throw error
          }
          await writeText(this.root, id, text)
          for (const kind of ["index.paper", ...(text.needsOcr ? ["paper.parse"] : [])]) this.queue(kind, id, "background")
        },
      }),
      // Tries each route for the paper's PDF until one gives a real PDF. Every route failing is a fact
      // (acquisition.json, result no_pdf); only a machine with no network at all tries again later.
      defineTask("paper.pdf", {
        lane: "network",
        run: async (ctx) => {
          const id = ctx.task.subject
          const record = await readRecord(this.root, id)
          if (!record) throw new TaskFailure(`${id} is not in the library.`)
          if (await hasPdfFile(this.root, id)) return
          const { http } = this.services
          const settings = await this.services.settings()
          const tried: Attempt[] = []
          const routes = routesFor(record, {
            landing: (doi) => landingOf(http, doi, ctx.signal),
            unpaywall: (doi) => unpaywallRoutes(http, doi, settings.contactEmail, ctx.signal),
          })
          const dest = pdfFile(this.root, id)
          for await (const route of routes) {
            ctx.progress(tried.length, undefined, route.name)
            try {
              await downloadPdf(http, route.url, dest, ctx.signal)
            } catch (error) {
              if (ctx.signal.aborted) throw error
              tried.push({ route: route.name, url: route.url, ...describeFailure(error), at: Date.now() })
              continue
            }
            tried.push({ route: route.name, url: route.url, status: 200, at: Date.now() })
            await writeAcquisition(this.root, id, { version: 1, result: "ok", route: route.name, tried, at: Date.now(), dropHere: dest })
            for (const kind of ["paper.text", "index.paper"]) this.queue(kind, id, ctx.task.priority)
            await this.announce([id])
            return
          }
          if (record.ids.doi && !settings.contactEmail) {
            tried.push({ route: "unpaywall", url: "", error: "Not tried: Unpaywall needs a contact email in settings.", at: Date.now() })
          }
          // Nothing answered at all: the machine is offline, which passes
          if (tried.length && tried.every((t) => t.status === 0 || t.error?.startsWith("Not tried"))) {
            if (tried.some((t) => t.status === 0)) throw new HttpError(0, tried[0].url, "Couldn't reach any source of PDFs.")
          }
          await writeAcquisition(this.root, id, { version: 1, result: "no_pdf", tried, at: Date.now(), dropHere: dest })
          await this.announce([id])
        },
      }),
      // Asks the services about a paper already in the library and rewrites its paper.json
      defineTask("paper.metadata", {
        lane: "network",
        run: async (ctx) => {
          const id = ctx.task.subject
          const record = await readRecord(this.root, id)
          if (!record) throw new TaskFailure(`${id} is not in the library.`)
          const ref = refOfIds(record.ids)
          // A file nobody has identified: there is nobody to ask
          if (!ref) return
          let resolution = this.recent(id)
          if (!resolution) {
            try {
              resolution = await resolve(this.services.http, ref, await this.services.settings(), { signal: ctx.signal })
            } catch (error) {
              if (error instanceof NotAPaper) throw new TaskFailure(error.message)
              throw error
            }
          }
          await this.serial(async () => {
            if (!(await readRecord(this.root, id))) return
            await keepSources(this.root, id, resolution.records)
            const next = recordFrom(id, resolution, record)
            await writeRecord(this.root, next)
            this.index.set(id, next.ids)
          })
          await this.announce([id])
        },
      }),
    ]
  }

  // ---- inside

  // Queues a step for a paper when this build knows it (paper.pdf comes with T15, and so on)
  private queue(kind: string, id: string, priority: TaskPriority) {
    if (this.scheduler?.knows(kind)) this.scheduler.enqueue(kind, id, priority)
  }

  private async ids() {
    try {
      return (await readdir(path.join(this.root, PAPERS_DIR))).filter(isPaperId).sort()
    } catch {
      return []
    }
  }

  // Tells the window about papers that changed without it asking
  private async announce(ids: string[]) {
    const papers: Paper[] = []
    const removed: string[] = []
    for (const id of ids) {
      const paper = await this.get(id)
      if (paper) papers.push(paper)
      else removed.push(id)
    }
    if (papers.length || removed.length) this.onChange({ papers, removed })
  }

  private async settle() {
    const dirty = [...this.dirty]
    this.dirty.clear()
    await this.serial(async () => {
      let ids = dirty
      // The system lost track: look at every folder, and at every paper that had one
      if (ids.includes("*")) ids = [...new Set([...(await this.ids()), ...this.index.ids()])]
      for (const id of ids) {
        const record = await readRecord(this.root, id)
        if (record) this.index.set(id, record.ids)
        else this.index.delete(id)
      }
      return ids
    }).then(
      (ids) => this.announce(ids),
      (error) => console.error("[core] couldn't read changes in the library", error),
    )
  }

  private trashDir(stamp: number, id: string) {
    return path.join(this.root, OWLIT_DIR, "trash", `${stamp}-paper-${id}`)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writing.then(work)
    this.writing = run.catch(() => undefined)
    return run
  }

  // A resolution looked up a moment ago, so add() and paper.metadata can use it whole
  private recent(id: string): Resolution | undefined {
    const kept = this.resolutions.get(id)
    return kept && Date.now() - kept.at < RESOLUTION_TTL_MS ? kept.resolution : undefined
  }

  private remember(resolution: Resolution) {
    const now = Date.now()
    for (const [id, kept] of this.resolutions) if (now - kept.at >= RESOLUTION_TTL_MS) this.resolutions.delete(id)
    this.resolutions.set(resolution.id, { resolution, at: now })
  }
}

function pick(from: Resolution | PaperRecord): Omit<ResolvedPaper, "id"> {
  return clean({
    title: from.title,
    authors: from.authors,
    ids: from.ids,
    year: from.year,
    venue: from.venue,
    abstract: from.abstract,
    kind: from.kind,
  })
}

function asRpcFailure(error: unknown) {
  if (error instanceof NotAPaper) return new RpcFailure(RpcErrorCode.NotFound, error.message)
  if (error instanceof HttpError) return new RpcFailure(RpcErrorCode.Unavailable, error.message, { status: error.status })
  return error
}

function ignoreMissing(error: NodeJS.ErrnoException) {
  if (error.code !== "ENOENT") throw error
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

const mtimeOf = (file: string) => stat(file).then((info) => info.mtimeMs, () => 0)
