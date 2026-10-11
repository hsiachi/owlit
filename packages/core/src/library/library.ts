import {
  isTaskFinished,
  RpcErrorCode,
  type FoundPaper,
  type FoundPapers,
  type Highlight,
  type LibraryChange,
  type OnlineFilters,
  type OnlineSource,
  type LibrarySettings,
  type Paper,
  type PaperNote,
  type PaperPatch,
  type PaperIds,
  type PaperRecord,
  type PaperState,
  type PaperText,
  type ParsingSettings,
  type ResolvedPaper,
  type TaskPriority,
} from "@owlit/protocol"
import { watch, type FSWatcher } from "node:fs"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { appendFile, copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { NeedsUser, type BrowserHost } from "../host.ts"
import { HttpError, type Http } from "../net/http.ts"
import { browserRoutes } from "./browser-routes.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskDefinition } from "../tasks/index.ts"
import { readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
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
  registeredUrl,
  routesFor,
  unpaywallRoutes,
  writeAcquisition,
  type Acquisition,
  type Attempt,
} from "./pdf.ts"
import { cleanDoi, paperIdOf, parseRef, refOfIds, stripArxivVersion } from "./refs.ts"
import { importPittaPaper, LEGACY_TEXT_MARK, pittaPapers, type PittaPaper } from "./pitta.ts"
import { readText, writeText } from "./text/files.ts"
import { extractText, pageSizes, readPdf, UnreadablePdf } from "./text/extract.ts"
import { contentListToText } from "./parse/convert.ts"
import { awaitCloud, checkCloud, ParseRefused, parseSelfHosted, submitCloud, uploadCloud } from "./parse/mineru.ts"
import { identify, type Identified } from "./text/identify.ts"
import { merge, NotAPaper, resolve, type Resolution } from "./resolve.ts"
import { findJournal, listJournal, parseYears, relatedOf, searchSource, type RelatedKind } from "./discover.ts"
import type { JournalArticle } from "./sources/crossref.ts"
import type { SourceRecord } from "./sources/types.ts"
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
// A note saved in bursts (an editor's autosave) is told once it rests
const NOTE_SETTLE_MS = 150
// The steps that find a paper's PDF or read it: a PDF the user puts in stops them
const PDF_STEPS = ["paper.pdf", "paper.pdf.browser", "paper.pdf.check", "paper.parse"]

export interface LibraryServices {
  http: Http
  // A background agent session: one prompt, its answer (reading notes)
  agent?: (prompt: string, signal: AbortSignal) => Promise<{ text: string; connectorId: string }>
  // The desktop app's hidden browser, for publishers that need cookies, a challenge passed or a login
  browser?: BrowserHost
  // MinerU's settings, read at each use
  parsing?: () => Promise<ParsingSettings>
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
  private resolutions = new Map<string, { resolution: Resolution; at: number; partial: boolean }>()
  // Journal lists fetched a moment ago, by ISSN and years, for the next page
  private journals = new Map<string, { articles: JournalArticle[]; issn: string; at: number }>()
  private scheduler: Scheduler | undefined
  private onChange: (change: LibraryChange) => void = () => {}
  private onNote: (paperId: string, note: PaperNote | null, before: string) => void = () => {}
  // Each note as owlit last wrote or read it, so a change on disk that isn't its own is told to windows
  private knownNotes = new Map<string, string>()
  private noteTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private watcher: FSWatcher | null = null
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  // Writes, one at a time, so a paper's files never race
  private writing: Promise<unknown> = Promise.resolve()
  // What each import.pitta run did, by task id
  private pittaSummaries = new Map<string, { added: number; skipped: number; failed: string[] }>()
  // SHA-256 of each paper's PDF → paper, built the first time a file is dropped
  private pdfHashes: Map<string, string> | undefined

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
  async list(): Promise<{ papers: Paper[]; highlights: Highlight[]; notes: PaperNote[]; aliases: Record<string, string> }> {
    const papers: Paper[] = []
    const highlights: Highlight[] = []
    const notes: PaperNote[] = []
    for (const id of await this.ids()) {
      const paper = await this.get(id)
      if (!paper) continue
      papers.push(paper)
      highlights.push(...(await readHighlights(this.root, id)))
      const note = await readNote(this.root, id)
      this.knownNotes.set(id, note?.content ?? "")
      if (note) notes.push(note)
    }
    return { papers, highlights, notes, aliases: await this.aliases() }
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
    if (await stat(path.join(paperDir(this.root, id), "digest.md")).then(() => true, () => false)) paper.hasDigest = true
    const text = await this.textQuality(id)
    if (text) paper.text = text
    if (!pdf) {
      const acquisition = await readAcquisition(this.root, id)
      // Routes skipped (Unpaywall without an email) weren't tried, so they aren't named
      const tried = acquisition?.tried.filter((t) => !t.error?.startsWith("Not tried")).map((t) => t.route)
      if (acquisition?.result === "no_pdf") {
        paper.noPdf = { tried: [...new Set(tried)], at: acquisition.at }
        if (acquisition.needs) paper.noPdf.needs = acquisition.needs.reason === "login" ? "sign-in" : "check"
      }
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
    // Just found by a search or a lookup: no need to ask the services again. A partial search result is
    // looked up properly by its ids (so the agent cites the published year, not the preprint's), and
    // stands in only when the services can't be reached; adding it then leaves paper.metadata to ask.
    const known = ref && ref.kind !== "url" ? this.kept(paperIdOf({ [ref.kind]: ref.value }) ?? "") : undefined
    let resolution: Resolution
    if (known && !known.partial) resolution = known.resolution
    else {
      try {
        resolution = await resolve(this.services.http, known ? refOfIds(known.resolution.ids)! : (ref ?? input), await this.services.settings(), { signal, retries: 1 })
        this.remember(resolution)
      } catch (error) {
        if (!known || signal?.aborted) throw asRpcFailure(error)
        resolution = known.resolution
      }
    }
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
      // A folder already there is that paper even if the index missed it: never written over
      const existing = (await this.index.find(resolved.ids)) ?? ((await readRecord(this.root, id)) ? id : undefined)
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
      if (id.startsWith("local-") && patch.ids && paperIdOf(cleanIds(patch.ids))) return this.relink(id, record, state, patch)
      await writeState(this.root, id, applyPatch(state, record, patch))
      // Starring a paper says it is worth reading: a note gets written in the background
      if (patch.starred && !state.starred) void this.wantDigest(id, "background")
      return (await this.get(id))!
    })
  }

  // A local paper the user has given a DOI or arXiv id becomes that paper: its folders move to the new
  // id, its metadata is fetched, and the old id stays an alias so links to it still open it
  private async relink(id: string, record: PaperRecord, state: PaperState, patch: PaperPatch): Promise<Paper> {
    const ids = { ...record.ids, ...cleanIds(patch.ids!) }
    const next = paperIdOf(ids)!
    const other = await this.index.find(ids)
    if (other && other !== id) {
      throw new RpcFailure(RpcErrorCode.Conflict, "Another paper in your library already has that id.", { id: other })
    }
    this.scheduler?.cancelSubject(id)
    await mkdir(path.dirname(paperStateDir(this.root, next)), { recursive: true })
    await rename(paperDir(this.root, id), paperDir(this.root, next))
    await rename(paperStateDir(this.root, id), paperStateDir(this.root, next)).catch(ignoreMissing)
    await writeRecord(this.root, { ...record, id: next, ids })
    const { ids: _ids, ...rest } = patch
    await writeState(this.root, next, applyPatch(state, record, rest))
    this.index.delete(id)
    this.index.set(next, ids)
    for (const [sha, paper] of this.pdfHashes ?? []) if (paper === id) this.pdfHashes!.set(sha, next)
    const aliases = await this.aliases()
    for (const [from, to] of Object.entries(aliases)) if (to === id) aliases[from] = next
    aliases[id] = next
    await writeJsonAtomic(this.aliasFile(), { version: 1, aliases })
    this.queue("paper.metadata", next, "asked")
    for (const kind of ["paper.text", "index.paper"]) this.queue(kind, next, "background")
    const paper = (await this.get(next))!
    this.onChange({ papers: [paper], removed: [id], renamed: { [id]: next } })
    return paper
  }

  // Old ids → the ids those papers have now
  async aliases(): Promise<Record<string, string>> {
    const kept = await readJson<{ aliases?: Record<string, string> }>(this.aliasFile()).catch(() => undefined)
    return { ...kept?.aliases }
  }

  private aliasFile() {
    return path.join(this.root, OWLIT_DIR, "papers", "aliases.json")
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
      this.knownNotes.set(paperId, content.trim() ? content : "")
      return writeNote(this.root, paperId, content)
    })
  }

  // An agent's edit to a paper's note (its file is .owlit/papers/<id>/note.md, which agents may not write
  // directly): written like the window's own, then told to windows, which take it into the open note as
  // one undoable change
  async writeNoteFor(paperId: string, content: string): Promise<void> {
    await this.serial(async () => {
      if (!(await readRecord(this.root, paperId))) throw notFound(paperId)
      // Learned before it changes, so the change is told even for a paper no window has listed yet
      if (!this.knownNotes.has(paperId)) this.knownNotes.set(paperId, (await readNote(this.root, paperId))?.content ?? "")
      await writeNote(this.root, paperId, content)
    })
    await this.noteMayHaveChanged(paperId)
  }

  // The paper a workspace-relative path is the note of, if it is one
  noteOf(rel: string): string | null {
    const prefix = `${OWLIT_DIR}/papers/`
    if (!rel.startsWith(prefix) || !rel.endsWith("/note.md")) return null
    const id = rel.slice(prefix.length, -"/note.md".length)
    return isPaperId(id) ? id : null
  }

  private async noteMayHaveChanged(paperId: string) {
    const note = await readNote(this.root, paperId)
    const content = note?.content ?? ""
    if (this.knownNotes.get(paperId) === content) return
    const first = !this.knownNotes.has(paperId)
    const before = this.knownNotes.get(paperId) ?? ""
    this.knownNotes.set(paperId, content)
    // The first sight of a note only learns it: owlit hasn't told anyone a version it could differ from
    if (first && note) return
    this.onNote(paperId, note ?? null, before)
  }

  // Looks for the paper's PDF now (the user asked) and waits; the paper as it then is
  async fetchPdf(id: string): Promise<Paper> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    if (!this.scheduler?.knows("paper.pdf")) throw new RpcFailure(RpcErrorCode.Unavailable, "owlit can't look for PDFs here.")
    let task = await this.scheduler.run("paper.pdf", id, "waiting")
    // Not after a failure (offline): the browser would only fail too, and its answer would hide why
    if (task.state !== "failed" && !(await hasPdfFile(this.root, id)) && this.scheduler.knows("paper.pdf.browser")) task = await this.scheduler.run("paper.pdf.browser", id, "waiting")
    // Under the library's lock: a run that placed the PDF while this one looked may still be
    // writing what it did (acquisition.json)
    const paper = await this.serial(() => this.get(id))
    if (!paper) throw notFound(id)
    if (!paper.pdf && task.state === "failed") throw new RpcFailure(RpcErrorCode.Unavailable, task.error ?? "owlit couldn't look for a PDF.")
    return paper
  }

  // The publisher's page with the user there (Check now); waits for the run, which the user ends by
  // passing the check, signing in, or cancelling its task
  async checkPublisher(id: string): Promise<Paper> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    if (!this.scheduler?.knows("paper.pdf.check")) throw new RpcFailure(RpcErrorCode.Unavailable, "owlit can't open publishers' pages here.")
    const task = await this.scheduler.run("paper.pdf.check", id, "asked")
    // Under the library's lock, as in fetchPdf
    const paper = await this.serial(() => this.get(id))
    if (!paper) throw notFound(id)
    if (!paper.pdf && task.state === "failed") throw new RpcFailure(RpcErrorCode.Unavailable, task.error ?? "owlit couldn't open the publisher's page.")
    return paper
  }

  // How well the paper's text was read: full (MinerU, now or from pitta) or basic (pdfium only).
  // Read from which files exist, not from text.json, which can be large.
  private async textQuality(id: string): Promise<Paper["text"]> {
    const dir = paperDir(this.root, id)
    if (await stat(path.join(dir, "text.pdfium.json")).then(() => true, () => false)) return "full"
    const head = await open(path.join(dir, "text.md"), "r")
      .then(async (handle) => {
        const buffer = Buffer.alloc(LEGACY_TEXT_MARK.length)
        await handle.read(buffer, 0, buffer.length, 0)
        await handle.close()
        return buffer.toString("utf8")
      })
      .catch(() => undefined)
    if (head === undefined) return undefined
    return head === LEGACY_TEXT_MARK ? "full" : "basic"
  }

  private digestTask(agent: NonNullable<LibraryServices["agent"]>) {
    return defineTask("paper.digest", {
      lane: "agent",
      retries: 1,
      run: async (ctx) => {
        const id = ctx.task.subject
        const record = await readRecord(this.root, id)
        if (!record) throw new TaskFailure(`${id} is not in the library.`)
        const dir = paperDir(this.root, id)
        if (await stat(path.join(dir, "digest.md")).then(() => true, () => false)) return
        const text = await readFile(path.join(dir, "text.md"), "utf8").catch(() => null)
        if (text === null) {
          if (await hasPdfFile(this.root, id)) ctx.require("paper.text", id)
          return
        }
        ctx.progress(0, undefined, "writing")
        const language = (await this.services.settings()).digestLanguage ?? "English"
        const { text: answer, connectorId } = await agent(digestPrompt(id, record, text, language), ctx.signal)
        const digest = cleanDigest(answer)
        if (!digest.startsWith("# ") || digest.length < 200) throw new Error("The agent's note didn't look like a reading note.")
        await this.serial(async () => {
          if (await stat(path.join(dir, "digest.md")).then(() => true, () => false)) return
          await writeFileAtomic(path.join(dir, "digest.md"), digest)
          await writeJsonAtomic(path.join(dir, "digest.json"), { version: 1, by: connectorId, at: Date.now() })
        })
        await this.announce([id])
      },
    })
  }

  // The publisher's page in a browser, directly and then through the library's proxy. Nobody looking
  // (paper.pdf.browser), a page that wants a person is noted in acquisition.json for Check now;
  // with the user there (paper.pdf.check), it waits for them.
  private browserTask(browser: BrowserHost, kind: string, withUser: boolean) {
    return defineTask(kind, {
      lane: "browser",
      retries: 0,
      run: async (ctx) => {
        const id = ctx.task.subject
        const record = await readRecord(this.root, id)
        if (!record?.ids.doi || (await hasPdfFile(this.root, id))) return
        const settings = await this.services.settings()
        const dest = pdfFile(this.root, id)
        const previous = await readAcquisition(this.root, id)
        const tried: Attempt[] = [...(previous?.tried ?? [])]
        let needs: Acquisition["needs"]
        const registered = await registeredUrl(this.services.http, record.ids.doi, ctx.signal)
        for (const route of browserRoutes(record.ids.doi, settings.proxy, registered)) {
          ctx.progress(0, undefined, route.name)
          try {
            const bytes = await browser.fetchPdf({
              landing: route.landing,
              pdf: route.pdf,
              pdfOnPageHost: route.name.endsWith(":proxied"),
              allowHosts: route.allowHosts,
              signal: ctx.signal,
              withUser,
              needUser: async (reason, detail, settled) => {
                const waiting = ctx.waitForUser(reason, detail)
                // The page moved on (check passed, signed in): the task goes on
                settled.then(
                  () => this.scheduler?.resume(ctx.task.id),
                  () => this.scheduler?.resume(ctx.task.id),
                )
                await waiting
                await settled
              },
            })
            if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error(`${route.name} gave something that isn't a PDF.`)
            tried.push({ route: route.name, url: route.landing, status: 200, at: Date.now() })
            // Under the library's lock, like a no_pdf verdict and a drop: see noPdf()
            await this.serial(async () => {
              // Cancelled meanwhile (the user attached a PDF): it isn't wanted over theirs
              ctx.signal.throwIfAborted()
              await writeFileAtomic(dest, Buffer.from(bytes))
              const sha256 = await sha256Of(dest)
              this.pdfHashes?.set(sha256, id)
              await writeAcquisition(this.root, id, { version: 1, result: "ok", route: route.name, tried, at: Date.now(), dropHere: dest, sha256 })
            })
            for (const next of ["paper.text", "index.paper"]) this.queue(next, id, ctx.task.priority)
            await this.announce([id])
            return
          } catch (error) {
            if (ctx.signal.aborted) throw error
            if (error instanceof NeedsUser) needs ??= { reason: error.reason, route: route.name, at: Date.now() }
            tried.push({ route: route.name, url: route.landing, error: error instanceof Error ? error.message : String(error), at: Date.now() })
            // With the user, it means they went away: the next route would only wait for them again
            if (withUser && error instanceof NeedsUser) break
          }
        }
        if (!settings.proxy?.base) tried.push({ route: "browser:proxied", url: "", error: "Not tried: no library proxy is set up.", at: Date.now() })
        const noted = await this.noPdf(id, () => ({ version: 1, result: "no_pdf", tried, at: Date.now(), dropHere: dest, ...(needs ? { needs } : {}) }))
        if (noted) await this.announce([id])
      },
    })
  }

  // A reading note is wanted (the paper was opened, starred, asked for): queued when the paper has, or
  // will have, text to read and has no note yet. A note already there, pitta's included, is never
  // written again.
  async wantDigest(id: string, priority: TaskPriority) {
    if (!this.services.agent || !isPaperId(id) || !(await readRecord(this.root, id))) return
    const dir = paperDir(this.root, id)
    if (await stat(path.join(dir, "digest.md")).then(() => true, () => false)) return
    const hasText = await stat(path.join(dir, "text.md")).then(() => true, () => false)
    if (!hasText && !(await hasPdfFile(this.root, id))) return
    this.queue("paper.digest", id, priority)
  }

  // A reading note an agent wrote itself (one that just added the paper), kept as digest.md
  writeDigest(id: string, text: string, by: string): Promise<Paper> {
    return this.serial(async () => {
      if (!(await readRecord(this.root, id))) throw notFound(id)
      const dir = paperDir(this.root, id)
      if (await stat(path.join(dir, "digest.md")).then(() => true, () => false)) {
        throw new RpcFailure(RpcErrorCode.Conflict, "This paper already has a reading note.", { id })
      }
      await writeFileAtomic(path.join(dir, "digest.md"), cleanDigest(text))
      await writeJsonAtomic(path.join(dir, "digest.json"), { version: 1, by, at: Date.now() })
      return (await this.get(id))!
    })
  }

  // The paper's reading notes (digest.md), or null when it has none
  async digest(id: string): Promise<string | null> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    return readFile(path.join(paperDir(this.root, id), "digest.md"), "utf8").catch(() => null)
  }

  // Brings a pitta library (~/.pitta) into the workspace once, as a task with progress; papers the
  // library already has are left as they are
  async importPitta(root: string): Promise<{ added: number; skipped: number; failed: string[] }> {
    if (!this.scheduler?.knows("import.pitta")) throw new RpcFailure(RpcErrorCode.Unavailable, "owlit can't import here.")
    const subject = path.resolve(root)
    const task = await this.scheduler.run("import.pitta", subject, "asked")
    const summary = this.pittaSummaries.get(task.id)
    if (task.state !== "done" || !summary) throw new RpcFailure(RpcErrorCode.InvalidParams, task.error ?? "The pitta library couldn't be read.")
    return summary
  }

  // Part of a paper as text for an agent: its full text (all of it, some pages, or one section), its
  // digest or the user's note
  async read(id: string, part: "text" | "digest" | "note", where: { pages?: string; section?: string } = {}): Promise<{ text: string; pages?: number }> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    if (part === "digest") return { text: (await this.digest(id)) ?? "" }
    if (part === "note") return { text: (await readNote(this.root, id))?.content ?? "" }
    const markdown = await readFile(path.join(paperDir(this.root, id), "text.md"), "utf8").catch(() => null)
    if (markdown === null) throw new RpcFailure(RpcErrorCode.NotFound, "The paper's text hasn't been read yet (no PDF, or still reading it).", { id })
    return pickFromText(markdown, where)
  }

  // Papers out in the world for a query, from one source, each marked with the library's id when it is
  // here already. Every search (and every related or journal list) is kept in .owlit/searches.jsonl:
  // what was asked, by whom, what came back.
  async searchOnline(query: string, options: { limit?: number; source?: OnlineSource } & OnlineFilters = {}, by = "agent"): Promise<FoundPapers> {
    const { limit = 10, source = "openalex", ...filters } = options
    const found = await searchSource(this.services.http, query, limit, source, filters, await this.services.settings(), { retries: 1 }).catch((error) => {
      throw asRpcFailure(error)
    })
    const papers = await this.mark(found.records)
    await this.recordSearch({ query, source, ...(Object.keys(filters).length ? { filters } : {}) }, by, papers)
    return { papers, source, ...(found.total !== undefined ? { total: found.total } : {}), ...(found.matched ? { matched: found.matched } : {}) }
  }

  // A paper's references, the papers citing it, or ones like it. ref is a library id, an id a search
  // just returned, a DOI or an arXiv id.
  async related(ref: string, kind: RelatedKind, options: { limit?: number } & Pick<OnlineFilters, "year" | "sort"> = {}, by = "agent"): Promise<FoundPapers> {
    const { limit = 20, ...filters } = options
    const record = isPaperId(ref) ? await readRecord(this.root, ref) : undefined
    const parsed = parseRef(ref)
    const seen = this.kept(ref)?.resolution
    const ids = seen?.ids ?? record?.ids ?? (parsed && parsed.kind !== "url" ? { [parsed.kind]: parsed.value } : undefined)
    if (!ids) throw new RpcFailure(RpcErrorCode.NotFound, "That isn't a paper owlit knows: give a library id, an id from a search, a DOI or an arXiv id.", { ref })
    const title = seen?.title ?? record?.title
    const found = await relatedOf(this.services.http, ids, kind, limit, filters, await this.services.settings(), { retries: 1 }).catch((error) => {
      throw asRpcFailure(error)
    })
    const papers = await this.mark(found.records)
    await this.recordSearch({ query: `${kind} of ${ref}`, source: found.source, ...(Object.keys(filters).length ? { filters } : {}) }, by, papers)
    return { papers, source: found.source, ...(found.total !== undefined ? { total: found.total } : {}), ...(title ? { matched: title } : {}), ...(found.note ? { note: found.note } : {}) }
  }

  // A journal's research articles in a year or years, from Crossref's full list, a page at a time; with
  // a query only those whose title or abstract has every word. The list is kept a while, so the next
  // page doesn't fetch it again.
  async journal(journal: string, year: string, options: { query?: string; offset?: number; limit?: number } = {}, by = "agent"): Promise<FoundPapers> {
    const { query, offset = 0, limit = 50 } = options
    const years = parseYears(year)
    if (years?.from === undefined || years.to === undefined) throw new RpcFailure(RpcErrorCode.InvalidParams, "A journal list needs a year, or a range like 2022-2024.")
    const span = { from: years.from, to: years.to }
    const settings = await this.services.settings()
    const http = this.services.http
    let found
    try {
      const { name, issns } = await findJournal(http, journal, settings, { retries: 1 })
      const key = `${issns[0]}:${span.from}-${span.to}`
      const kept = this.journals.get(key)
      const { articles, issn } = kept && Date.now() - kept.at < RESOLUTION_TTL_MS ? kept : await listJournal(http, issns, span, settings, { retries: 1 })
      this.journals.set(key, { articles, issn, at: Date.now() })
      found = { name: name.startsWith("ISSN") && articles[0]?.journal ? `${articles[0].journal} (${name})` : `${name} (ISSN ${issn})`, articles }
    } catch (error) {
      throw asRpcFailure(error)
    }
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
    const matching = words.length ? found.articles.filter((a) => words.every((w) => `${a.title} ${a.abstract ?? ""}`.toLowerCase().includes(w))) : found.articles
    const papers = await Promise.all(
      matching.slice(offset, offset + limit).map(async (a): Promise<FoundPaper> => {
        const ids = { doi: a.doi }
        const inLibrary = await this.index.find(ids)
        return clean({
          id: paperIdOf(ids)!,
          title: a.title,
          authors: a.authors,
          ids,
          year: a.year,
          venue: a.journal,
          abstract: a.abstract,
          kind: "article" as const,
          citationCount: a.citationCount,
          volume: a.volume,
          issue: a.issue,
          inLibrary,
          ...(inLibrary ? { hasPdf: await hasPdfFile(this.root, inLibrary) } : {}),
        })
      }),
    )
    const asked = `${found.name} ${year}${query ? `: ${query}` : ""}`
    await this.recordSearch({ query: asked, source: "crossref" }, by, papers)
    return { papers, source: "crossref", total: matching.length, matched: found.name }
  }

  // Found records as the agent sees them, with the library's id and whether it has the PDF when the paper
  // is here already. Each is kept a while, so adding one doesn't ask the services again.
  private async mark(records: SourceRecord[]): Promise<FoundPaper[]> {
    return Promise.all(
      records.map(async (r) => {
        const resolution = merge(refOfIds(r.ids)!, [r])
        this.remember(resolution, !fromAuthority(resolution))
        const inLibrary = await this.index.find(resolution.ids)
        return clean({
          id: resolution.id,
          ...pick(resolution),
          citationCount: resolution.citationCount,
          tldr: resolution.tldr,
          openPdf: resolution.pdfUrls.length > 0 || undefined,
          inLibrary,
          ...(inLibrary ? { hasPdf: await hasPdfFile(this.root, inLibrary) } : {}),
        })
      }),
    )
  }

  private async recordSearch(asked: { query: string; source: string; filters?: object }, by: string, papers: FoundPaper[]) {
    const line = { at: Date.now(), ...asked, by, results: papers.map((f) => f.id) }
    await mkdir(path.join(this.root, OWLIT_DIR), { recursive: true })
    await appendFile(path.join(this.root, OWLIT_DIR, "searches.jsonl"), JSON.stringify(line) + "\n")
  }

  async highlights(id: string): Promise<Highlight[]> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    return readHighlights(this.root, id)
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
      await assertPdf(file)
      await this.placePdf(id, file, await sha256Of(file))
      return (await this.get(id))!
    })
  }

  // A PDF dropped on the library: which paper it is (arXiv's stamp, a DOI on its first pages), added
  // with its metadata when the services know it, or kept as local-<hash> with a title guessed from the
  // file. The same file dropped again is the paper it already is.
  // Reading and looking up happen outside the write queue, so a slow service never holds up a star or a
  // note; only placing the paper is queued.
  async importPdf(file: string): Promise<{ paper: Paper; existed: boolean }> {
    await assertPdf(file)
    const sha = await sha256Of(file)
    const same = await this.serial(() => this.paperWithPdf(sha))
    if (same) return { paper: (await this.get(same))!, existed: true }

    const bytes = await readFile(file)
    let found: Identified = { authors: [] }
    try {
      const { text, meta } = await readPdf(bytes, { wasmPath: this.services.pdfiumWasm, maxPages: 2 })
      found = identify(text, meta)
    } catch (error) {
      if (!(error instanceof UnreadablePdf)) throw error
      throw new RpcFailure(RpcErrorCode.InvalidParams, error.message)
    }
    const name = path.basename(file).replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim()
    let resolution: Resolution | undefined
    if (found.ref) {
      resolution = await resolve(this.services.http, found.ref, await this.services.settings(), { retries: 1 }).catch(() => undefined)
      if (resolution) this.remember(resolution)
    }
    return this.serial(async () => {
      // Dropped twice at once: the first one placed it
      const placed = await this.paperWithPdf(sha)
      if (placed) return { paper: (await this.get(placed))!, existed: true }
      const ids = resolution?.ids ?? (found.ref ? { [found.ref.kind]: found.ref.value } : {})
      // Known under one of its ids: the file joins that paper unless it already has one
      const id = resolution?.id ?? paperIdOf(ids) ?? `local-${sha.slice(0, 12)}`
      // A folder already there is that paper even if the index missed it: never written over
      const existing = (await this.index.find(ids)) ?? ((await readRecord(this.root, id)) ? id : undefined)
      if (existing) {
        if (!(await hasPdfFile(this.root, existing))) await this.placePdf(existing, file, sha)
        return { paper: (await this.get(existing))!, existed: true }
      }
      const record: PaperRecord = resolution
        ? recordFrom(id, resolution)
        : clean({
            version: 1 as const,
            id,
            ids,
            title: found.title ?? (name || "Untitled PDF"),
            authors: found.authors,
            fields: { title: found.title ? "pdf" : "file", ...(found.authors.length ? { authors: "pdf" } : {}) },
          })
      await mkdir(paperDir(this.root, id), { recursive: true })
      if (resolution) await keepSources(this.root, id, resolution.records)
      await writeRecord(this.root, record)
      await writeState(this.root, id, freshState("user"))
      this.index.set(id, record.ids)
      // An id the services couldn't be asked about (offline) gets its metadata later
      if (!resolution && found.ref) this.queue("paper.metadata", id, "asked")
      await this.placePdf(id, file, sha)
      return { paper: (await this.get(id))!, existed: false }
    })
  }

  // The file becomes the paper's PDF, and the steps that read it follow
  private async placePdf(id: string, file: string, sha: string) {
    // A download or a publisher's page still looking must not replace the user's file when it lands,
    // nor a reading of the old file come back over the new one's
    for (const t of this.scheduler?.list() ?? []) {
      if (t.subject === id && !isTaskFinished(t) && PDF_STEPS.includes(t.kind)) this.scheduler!.cancel(t.id)
    }
    const dest = pdfFile(this.root, id)
    // Its own temporary name: a cancelled download may still be cleaning up its .part
    const part = `${dest}.${process.pid}-${Date.now()}.part`
    await copyFile(file, part)
    await rename(part, dest)
    // What was read from the file it replaces goes, so the new one is read (and MinerU reads it again)
    const dir = paperDir(this.root, id)
    await Promise.all(["text.json", "text.md", "text.pdfium.json", "parse.json"].map((name) => rm(path.join(dir, name), { force: true })))
    const previous = await readAcquisition(this.root, id)
    await writeAcquisition(this.root, id, {
      version: 1,
      result: "ok",
      route: "dropped",
      tried: [...(previous?.tried ?? []), { route: "dropped", url: file, at: Date.now() }],
      at: Date.now(),
      dropHere: dest,
      sha256: sha,
    })
    this.pdfHashes?.set(sha, id)
    for (const kind of ["paper.text", "index.paper"]) this.queue(kind, id, "asked")
  }

  // The paper whose PDF is this file, by its SHA-256 (kept in acquisition.json, or worked out once)
  private async paperWithPdf(sha: string): Promise<string | undefined> {
    if (!this.pdfHashes) {
      const hashes = new Map<string, string>()
      for (const id of await this.ids()) {
        if (!(await hasPdfFile(this.root, id))) continue
        const acquisition = await readAcquisition(this.root, id)
        let hash = acquisition?.sha256
        if (!hash) {
          hash = await sha256Of(pdfFile(this.root, id))
          if (acquisition) await writeAcquisition(this.root, id, { ...acquisition, sha256: hash })
        }
        hashes.set(hash, id)
      }
      this.pdfHashes = hashes
    }
    const id = this.pdfHashes.get(sha)
    return id && (await hasPdfFile(this.root, id)) ? id : undefined
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
  async watch(onChange: (change: LibraryChange) => void, onNote?: (paperId: string, note: PaperNote | null, before: string) => void) {
    this.onChange = onChange
    if (onNote) this.onNote = onNote
    void this.retryMissingDaily().catch((error) => console.error("[core] couldn't retry missing PDFs", error))
    void this.catchUp().catch((error) => console.error("[core] couldn't catch up on the library", error))
    // A library that can't be read yet still opens; lookups just find less
    await this.index.load().catch((error) => console.error("[core] couldn't read the library", error))
    if (this.watcher) return
    const prefix = PAPERS_DIR.split(path.sep).join("/") + "/"
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      const rel = filename ? filename.split(path.sep).join("/") : ""
      // A paper's note, changed by an agent that writes the disk itself or by another program
      const noteOf = this.noteOf(rel)
      if (noteOf) {
        clearTimeout(this.noteTimers.get(noteOf))
        this.noteTimers.set(noteOf, setTimeout(() => void this.noteMayHaveChanged(noteOf).catch(() => undefined), NOTE_SETTLE_MS))
        return
      }
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
    for (const timer of this.noteTimers.values()) clearTimeout(timer)
    this.watcher?.close()
    this.watcher = null
  }

  // ---- Tasks

  tasks(): TaskDefinition[] {
    return [
      // A reading note by a background agent session, from the paper's full text
      ...(this.services.agent ? [this.digestTask(this.services.agent)] : []),
      // MinerU's reading of the PDF replaces pdfium's (kept as text.pdfium.json). The job is recorded
      // before the file goes up, so a restart looks it up instead of paying for another. Without a
      // service set up there is nothing to do; failing changes nothing but parse.json.
      defineTask("paper.parse", {
        lane: "parse",
        run: async (ctx) => {
          const id = ctx.task.subject
          const settings = (await this.services.parsing?.()) ?? {}
          if (!settings.service || (settings.service === "cloud" && !settings.token)) return
          if (ctx.task.priority === "background" && settings.auto === false) return
          if (!(await readRecord(this.root, id))) throw new TaskFailure(`${id} is not in the library.`)
          if (!(await hasPdfFile(this.root, id))) return
          if ((await readText(this.root, id))?.source === "mineru") return
          const bytes = await readFile(pdfFile(this.root, id))
          // The cloud's job, for parse.json
          let job: string | undefined
          try {
            let blocks
            if (settings.service === "self-hosted") {
              blocks = await parseSelfHosted(this.services.http, settings, `${id}.pdf`, bytes, ctx.signal)
            } else {
              let batchId = ctx.external?.service === "mineru" ? ctx.external.jobId : undefined
              // A job recorded before a restart: still waiting for its file means the upload never
              // happened, so it starts over (nothing was spent)
              if (batchId && (await checkCloud(this.services.http, settings, batchId, ctx.signal)).state === "waiting-file") batchId = undefined
              if (!batchId) {
                const job = await submitCloud(this.services.http, settings, `${id}.pdf`, id, ctx.signal)
                await ctx.externalJob("mineru", job.batchId)
                await uploadCloud(this.services.http, job, bytes, ctx.signal)
                batchId = job.batchId
              }
              job = batchId
              blocks = await awaitCloud(this.services.http, settings, batchId, { signal: ctx.signal, onProgress: (done, total) => ctx.progress(done, total) })
            }
            const text = contentListToText(blocks, await pageSizes(bytes, this.services.pdfiumWasm))
            // Cancelled meanwhile (the PDF was replaced): this reading is of the old file
            ctx.signal.throwIfAborted()
            const dir = paperDir(this.root, id)
            const previous = await readText(this.root, id)
            if (previous?.source === "pdfium") await writeJsonAtomic(path.join(dir, "text.pdfium.json"), previous)
            await writeText(this.root, id, text)
            await writeJsonAtomic(path.join(dir, "parse.json"), { version: 1, status: "done", service: settings.service, at: Date.now(), ...(job ? { job } : {}) })
            this.queue("index.paper", id, "background")
            await this.announce([id])
          } catch (error) {
            if (ctx.signal.aborted) throw error
            const message = error instanceof Error ? error.message : String(error)
            await writeJsonAtomic(path.join(paperDir(this.root, id), "parse.json"), { version: 1, status: "failed", error: message, attempts: ctx.task.attempts, at: Date.now() })
            if (error instanceof ParseRefused) throw new TaskFailure(message)
            throw error
          }
        },
      }),
      defineTask("import.pitta", {
        lane: "cpu",
        retries: 0,
        run: async (ctx) => {
          let papers: PittaPaper[]
          try {
            papers = await pittaPapers(ctx.task.subject)
          } catch (error) {
            throw new TaskFailure(error instanceof Error ? error.message : String(error))
          }
          const summary = { added: 0, skipped: 0, failed: [] as string[] }
          const added: string[] = []
          for (const [i, paper] of papers.entries()) {
            ctx.signal.throwIfAborted()
            ctx.progress(i, papers.length, paper.id)
            try {
              const placed = await this.serial(async () => {
                if (await readRecord(this.root, paper.id)) return false
                const brought = await importPittaPaper(this.root, paper)
                const record = (await readRecord(this.root, paper.id))!
                if (await this.index.find(record.ids).then((other) => other && other !== paper.id)) {
                  // Known under another id: keep the one the library has
                  await rm(paperDir(this.root, paper.id), { recursive: true, force: true })
                  return false
                }
                await writeState(this.root, paper.id, freshState("user", record.fetchedAt ?? Date.now()))
                this.index.set(paper.id, record.ids)
                if (brought.pdf) this.queue("paper.text", paper.id, "background")
                return true
              })
              if (placed) {
                summary.added++
                added.push(paper.id)
              } else summary.skipped++
            } catch (error) {
              summary.failed.push(`${paper.id}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          ctx.progress(papers.length, papers.length)
          this.pittaSummaries.set(ctx.task.id, summary)
          if (added.length) await this.announce(added)
        },
      }),
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
          // A text.md brought from pitta is MinerU's: better than pdfium's, so only the coordinates are added
          const legacy = (await readFile(path.join(paperDir(this.root, id), "text.md"), "utf8").catch(() => "")).startsWith(LEGACY_TEXT_MARK)
          await writeText(this.root, id, text, { markdown: !legacy })
          this.queue("index.paper", id, "background")
          if ((await this.services.settings()).digestEveryPaper) void this.wantDigest(id, "background")
          // A scan has no text at all until MinerU reads it. pitta's text.md is MinerU's already.
          if (!legacy) this.queue("paper.parse", id, text.needsOcr ? "asked" : "background")
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
          const { http, heard } = watchedHttp(this.services.http)
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
            // Under the library's lock, like a no_pdf verdict and a drop: see noPdf()
            await this.serial(async () => {
              const sha256 = await sha256Of(dest)
              this.pdfHashes?.set(sha256, id)
              await writeAcquisition(this.root, id, { version: 1, result: "ok", route: route.name, tried, at: Date.now(), dropHere: dest, sha256 })
            })
            for (const kind of ["paper.text", "index.paper"]) this.queue(kind, id, ctx.task.priority)
            await this.announce([id])
            return
          }
          if (record.ids.doi && !settings.contactEmail) {
            tried.push({ route: "unpaywall", url: "", error: "Not tried: Unpaywall needs a contact email in settings.", at: Date.now() })
          }
          // No server answered at all (doi.org, Unpaywall, the routes): the machine is offline, which
          // passes. One dead host among ones that answered is just a route that failed.
          if (heard.asked && !heard.answered) throw new HttpError(0, tried[0]?.url ?? "", "Couldn't reach any source of PDFs.")
          const noted = await this.noPdf(id, (previous) => ({
            version: 1,
            result: "no_pdf",
            tried,
            at: Date.now(),
            dropHere: dest,
            // A check the publisher wants stays noted until the browser looks again (queued below)
            ...(previous?.needs ? { needs: previous.needs } : {}),
          }))
          if (!noted) return
          // The publisher may still give it to a browser: cookies, a challenge, the library's proxy
          if (record.ids.doi) this.queue("paper.pdf.browser", id, ctx.task.priority)
          await this.announce([id])
        },
      }),
      // The publisher's page in the hidden browser, directly and then through the library's proxy. A
      // challenge or a sign-in form shows the window and waits for the user (5 minutes at most).
      ...(this.services.browser
        ? [this.browserTask(this.services.browser, "paper.pdf.browser", false), this.browserTask(this.services.browser, "paper.pdf.check", true)]
        : []),
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

  // Notes that a run found no PDF, unless another route (the browser, a drop) placed one meanwhile:
  // its record stands. paper.pdf and paper.pdf.browser can run at once for a paper (the user asks
  // just after the automatic run), so the look and the write share the library's lock with the
  // writers of an ok record; otherwise a no_pdf could land last over a PDF that is there. Whether
  // it was noted.
  private noPdf(id: string, acquisition: (previous: Acquisition | undefined) => Acquisition): Promise<boolean> {
    return this.serial(async () => {
      if (await hasPdfFile(this.root, id)) return false
      await writeAcquisition(this.root, id, acquisition(await readAcquisition(this.root, id)))
      return true
    })
  }

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

  // A resolution looked up a moment ago, so add() and paper.metadata can use it whole. A partial one (a
  // search result from a source that isn't the paper's authority) only previews: what it says is kept
  // only after the services are asked.
  private recent(id: string): Resolution | undefined {
    const kept = this.kept(id)
    return kept && !kept.partial ? kept.resolution : undefined
  }

  private kept(id: string) {
    const kept = this.resolutions.get(id)
    return kept && Date.now() - kept.at < RESOLUTION_TTL_MS ? kept : undefined
  }

  private remember(resolution: Resolution, partial = false) {
    const now = Date.now()
    for (const [id, kept] of this.resolutions) if (now - kept.at >= RESOLUTION_TTL_MS) this.resolutions.delete(id)
    this.resolutions.set(resolution.id, { resolution, at: now, partial })
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

// Whether a resolution holds the answer of the service merge() trusts first for this paper: OpenAlex for
// published work, arXiv for a preprint. A search in another source (an arXiv search finding a paper
// that has since been published, an S2 search) gives only part of the picture: Selenite (CHI 2024), added
// from an arXiv search on 2026-10-10, was kept with its preprint's year.
function fromAuthority(resolution: Resolution) {
  const authority = resolution.ids.doi ? "openalex" : "arxiv"
  return resolution.records.some((r) => r.source === authority)
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

async function sha256Of(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function assertPdf(file: string) {
  const handle = await open(file, "r").catch(() => {
    throw new RpcFailure(RpcErrorCode.NotFound, "That file can't be opened.", { file })
  })
  const head = Buffer.alloc(5)
  await handle.read(head, 0, 5, 0)
  await handle.close()
  if (head.toString("latin1") !== "%PDF-") throw new RpcFailure(RpcErrorCode.InvalidParams, "That file isn't a PDF.")
}

// Ids as the user typed them, as the library keeps them: a DOI lowercased and without a doi.org prefix
function cleanIds(ids: Partial<PaperIds>): PaperIds {
  const out: PaperIds = {}
  if (ids.doi?.trim()) out.doi = cleanDoi(ids.doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, ""))
  if (ids.arxiv?.trim()) out.arxiv = stripArxivVersion(ids.arxiv.trim().replace(/^arxiv:\s*/i, ""))
  if (ids.s2?.trim()) out.s2 = ids.s2.trim().toLowerCase()
  if (ids.openalex?.trim()) out.openalex = ids.openalex.trim().toUpperCase()
  if (ids.url?.trim()) out.url = ids.url.trim()
  return out
}

// An Http that notes whether any server answered at all, even with an error: none did means offline
function watchedHttp(http: Http) {
  const heard = { asked: false, answered: false }
  const watched: Http = Object.create(http)
  watched.get = async (url, options) => {
    heard.asked = true
    try {
      const response = await http.get(url, options)
      heard.answered = true
      return response
    } catch (error) {
      if (error instanceof HttpError && error.status > 0) heard.answered = true
      throw error
    }
  }
  return { http: watched, heard }
}

// Pages "3", "3-5" or "3,7" of a text.md (split at its <!-- page N --> marks), or the section under the
// heading that contains `section`, or all of it
export function pickFromText(markdown: string, where: { pages?: string; section?: string }): { text: string; pages: number } {
  const parts = markdown.split(/(?=<!-- page \d+ -->)/)
  const pages = parts.filter((p) => /^<!-- page \d+ -->/.test(p)).length
  if (where.pages) {
    const wanted = new Set<number>()
    for (const piece of where.pages.split(",")) {
      const [from, to] = piece.split("-").map((n) => Number(n.trim()))
      if (!Number.isFinite(from)) continue
      for (let n = from; n <= (Number.isFinite(to) ? to : from); n++) wanted.add(n)
    }
    const text = parts.filter((p) => wanted.has(Number(p.match(/^<!-- page (\d+) -->/)?.[1]))).join("")
    return { text: text || `(No such pages; the paper has ${pages}.)`, pages }
  }
  if (where.section) {
    const lines = markdown.split("\n")
    const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(where.section!.toLowerCase()))
    if (start < 0) return { text: `(No heading mentions "${where.section}".)`, pages }
    const level = lines[start].match(/^#+/)![0].length
    let end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l))
    if (end < 0) end = lines.length
    return { text: lines.slice(start, end).join("\n"), pages }
  }
  return { text: markdown, pages }
}

// Most of a long paper fits; what doesn't, the agent reads with library_read
const DIGEST_TEXT_LIMIT = 120_000

function digestPrompt(id: string, record: PaperRecord, text: string, language: string) {
  const cut = text.length > DIGEST_TEXT_LIMIT
  return [
    `Write a reading note (a digest) for this paper in the user's library: "${record.title}" (${id}).`,
    "",
    "Use exactly these sections, each one to three sentences:",
    "## Question — what the paper asks or sets out to do",
    "## Method — how it goes about it",
    "## Findings — what it found or shows",
    "## Limitations — what it leaves open or gets wrong",
    "## Why it matters — who would use this and for what; if you look at the user's library or docs with owlit's tools, say how it relates to them",
    "",
    `Write in ${language}. Point at pages as (p. N) where the text shows them. Say only what the text supports.`,
    `Answer with the note alone, as Markdown starting with "# ${record.title}", and nothing before or after it.`,
    "",
    cut
      ? `The paper's full text follows (<!-- page N --> marks each page). It is long: this is its first part; read the rest with library_read (id ${id}) if you need it.`
      : "The paper's full text follows (<!-- page N --> marks each page).",
    "",
    cut ? text.slice(0, DIGEST_TEXT_LIMIT) : text,
  ].join("\n")
}

// The note as Markdown: without a code fence around it or words before its title
export function cleanDigest(answer: string) {
  let text = answer.trim()
  const fenced = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  if (fenced) text = fenced[1].trim()
  const title = text.search(/^# /m)
  if (title > 0) {
    text = text.slice(title)
    // A note fenced after words before it: the fence's end is left over
    text = text.replace(/\n```\s*$/, "").trim()
  }
  return text + "\n"
}
