// Bringing a library in at once: a Zotero library, a BibTeX file, a folder of PDFs. One task per
// import adds its papers one at a time and keeps what it did in <dataDir>/imports/<id>.json, so an
// interrupted import carries on where it stopped. Cancelling stops before the next paper, never in the
// middle of one. Only the adding happens here: metadata, PDFs and text follow as each paper's own
// background tasks.

import { t } from "@lingui/core/macro"
import { isTaskFinished, RpcErrorCode, type ImportPreview, type ImportSource, type ImportSummary, type Paper, type PaperIds, type ResolvedPaper, type Task } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { access, mkdir, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../../fs-util.ts"
import { RpcFailure } from "../../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskDefinition } from "../../tasks/index.ts"
import { paperIdOf } from "../refs.ts"
import { readSource, type ImportEntry } from "./sources.ts"
import { messageOf } from "../../util.ts"

// Past this many papers an import asks before MinerU reads them all, since each one is paid for
export const ASK_BEFORE_PARSING = 100
// How long a finished import stays in library.imports
const KEEP_MS = 14 * 24 * 60 * 60_000

const KINDS: Record<ImportSource, string> = { zotero: "import.zotero", bibtex: "import.bibtex", folder: "import.folder" }

type Outcome = { result: "added" | "existed"; id: string } | { result: "failed"; title?: string; error: string }

interface ImportRecord {
  version: 1
  id: string
  taskId: string
  source: ImportSource
  path: string
  collectionsAsTags: boolean
  createdAt: number
  // The source as read the first time, so a restart doesn't read it again
  entries?: ImportEntry[]
  // Entry key → what happened to it
  done: Record<string, Outcome>
  // The entry being added when owlit stopped: if its paper is there on the next run, this import added it
  inHand?: string
  parse?: boolean
  finishedAt?: number
  dismissed?: boolean
}

// importId: the import adding it, whose papers are one change in the log
type Extra = { tags?: string[]; imported: { parse: boolean }; importId: string }

// What an import needs from the library
export interface ImportHost {
  // The paper the library has under any of these ids
  find(ids: PaperIds): Promise<string | undefined>
  // Adds a paper as the source describes it; with pdf, that file is its PDF and nothing is downloaded
  // imported is told back (note) before the paper's text is read
  add(paper: ResolvedPaper, extra: Extra & { pdf?: string }): Promise<{ paper: Paper; existed: boolean }>
  // A PDF with nothing else to go on: recognised from its pages, or kept as local-<hash>
  addPdf(file: string, extra: Extra): Promise<{ paper: Paper; existed: boolean }>
  // Looks a title up with the services
  resolve(title: string): Promise<{ paper: ResolvedPaper; existingId?: string }>
  // Whether MinerU would read every added PDF on its own
  parsingOn(): Promise<boolean>
}

export class Imports {
  private readonly dir: string
  private readonly host: ImportHost
  private scheduler: Scheduler | undefined
  // Papers that came in through an import, and whether MinerU may read them; read from the records at
  // start, so a restart still knows
  private readonly papers = new Map<string, { parse: boolean }>()
  // The records of imports being started or run: the task and the RPCs change the same object, so
  // neither writes over what the other just wrote
  private readonly live = new Map<string, ImportRecord>()

  constructor(dataDir: string, host: ImportHost) {
    this.dir = path.join(dataDir, "imports")
    this.host = host
  }

  attach(scheduler: Scheduler) {
    this.scheduler = scheduler
  }

  // Reads which papers came from imports (for paper.text's digest and MinerU steps)
  async load() {
    for (const record of await this.records()) this.remember(record)
  }

  // Whether this paper came in through an import, and if so whether MinerU may read it
  imported(id: string): { parse: boolean } | undefined {
    return this.papers.get(id)
  }

  // The library added a paper for an import
  note(id: string, flags: { parse: boolean }) {
    this.papers.set(id, flags)
  }

  async start(source: ImportSource, from: string, options: { collectionsAsTags?: boolean; parse?: boolean } = {}): Promise<ImportSummary> {
    if (!this.scheduler) throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit can't import here.`)
    const file = await checkPath(source, from)
    const id = `import-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`
    const record: ImportRecord = {
      version: 1,
      id,
      taskId: "",
      source,
      path: file,
      collectionsAsTags: !!options.collectionsAsTags,
      createdAt: Date.now(),
      done: {},
      ...(options.parse !== undefined ? { parse: options.parse } : {}),
    }
    this.live.set(id, record)
    // The record is there before the task can run
    await this.write(record)
    record.taskId = this.scheduler.enqueue(KINDS[source], id, "asked").id
    await this.write(record)
    return summarize(record)
  }

  // Zotero's own folder, where it keeps zotero.sqlite unless told otherwise
  async findZotero(): Promise<string | null> {
    const folder = path.join(homedir(), "Zotero")
    return access(path.join(folder, "zotero.sqlite")).then(
      () => folder,
      () => null,
    )
  }

  // Reads the source and counts, adding nothing
  async preview(source: ImportSource, from: string): Promise<ImportPreview> {
    let entries: ImportEntry[]
    try {
      entries = await readSource(source, await checkPath(source, from), { collectionsAsTags: true })
    } catch (error) {
      if (error instanceof RpcFailure) throw error
      throw new RpcFailure(RpcErrorCode.InvalidParams, messageOf(error))
    }
    const known = await Promise.all(entries.map((e) => this.host.find(e.ids)))
    const fresh = known.filter((id) => !id).length
    return {
      total: entries.length,
      withPdf: entries.filter((e) => e.pdf).length,
      known: entries.length - fresh,
      zoteroCollections: new Set(entries.flatMap((e) => e.tags ?? [])).size,
      asksParse: fresh > ASK_BEFORE_PARSING && (await this.host.parsingOn()),
    }
  }

  // A cancelled or failed import starts again where it stopped
  async continue(id: string): Promise<ImportSummary> {
    const record = await this.need(id)
    const task = this.scheduler?.get(record.taskId)
    if (!this.scheduler || record.finishedAt || (task && !isTaskFinished(task))) return summarize(record)
    // Live before the task can run, as in start(), so the task and this write change the same record
    this.live.set(id, record)
    record.taskId = this.scheduler.enqueue(KINDS[record.source], id, "asked").id
    await this.write(record)
    return summarize(record)
  }

  async list(): Promise<ImportSummary[]> {
    const now = Date.now()
    return (await this.records()).filter((r) => !r.finishedAt || now - r.finishedAt < KEEP_MS).map(summarize)
  }

  async answer(id: string, parse: boolean): Promise<ImportSummary> {
    const record = await this.need(id)
    record.parse = parse
    await this.write(record)
    this.scheduler?.resume(record.taskId)
    return summarize(record)
  }

  async dismiss(id: string) {
    const record = await this.need(id)
    record.dismissed = true
    await this.write(record)
  }

  tasks(): TaskDefinition[] {
    return Object.values(KINDS).map((kind) => defineTask(kind, { lane: "cpu", retries: 0, run: (ctx) => this.run(ctx.task, ctx) }))
  }

  private async run(task: Readonly<Task>, ctx: Parameters<TaskDefinition["run"]>[0]) {
    const record = await this.read(task.subject)
    if (!record) throw new TaskFailure(t`This import's record is gone.`)
    this.live.set(record.id, record)
    record.taskId = task.id
    try {
      await this.runImport(record, ctx)
    } finally {
      this.live.delete(record.id)
    }
  }

  private async runImport(record: ImportRecord, ctx: Parameters<TaskDefinition["run"]>[0]) {
    let entries = record.entries
    if (!entries) {
      try {
        entries = await readSource(record.source, record.path, { collectionsAsTags: record.collectionsAsTags })
      } catch (error) {
        throw new TaskFailure(messageOf(error))
      }
      record.entries = entries
      await this.write(record)
    }
    if (record.parse === undefined) {
      const fresh = (await Promise.all(entries.map((e) => this.host.find(e.ids)))).filter((id) => !id).length
      if (fresh > ASK_BEFORE_PARSING && (await this.host.parsingOn())) {
        await ctx.waitForUser("confirm_spend", t`MinerU would read the PDFs of ${fresh} new papers, and each one is paid for.`)
        // library.importAnswer set record.parse before resuming
      }
      record.parse ??= true
      await this.write(record)
    }

    const count = () => Object.keys(record.done).length
    // The entry owlit stopped in the middle of last time, if it did
    const interrupted = record.inHand
    for (const entry of entries) {
      // Cancelled: the paper in hand was finished; nothing new starts
      if (ctx.signal.aborted) return
      if (record.done[entry.key]) continue
      ctx.progress(count(), entries.length, entry.title)
      record.inHand = entry.key
      await this.write(record)
      const outcome = await this.addOne(entry, record, entry.key === interrupted)
      record.done[entry.key] = outcome
      record.inHand = undefined
      if (outcome.result === "added") this.papers.set(outcome.id, { parse: record.parse !== false })
      await this.write(record)
    }
    ctx.progress(count(), entries.length)
    record.finishedAt = Date.now()
    await this.write(record)
  }

  // One entry: skipped when the library has it, else added from what the source says
  private async addOne(entry: ImportEntry, record: ImportRecord, interrupted: boolean): Promise<Outcome> {
    const extra: Extra = { ...(record.collectionsAsTags && entry.tags?.length ? { tags: entry.tags } : {}), imported: { parse: record.parse !== false }, importId: record.id }
    // Found in the library: there before, unless this import added it just before owlit stopped
    const ours = (id: string): Outcome => ({ result: interrupted ? "added" : "existed", id })
    try {
      const existing = await this.host.find(entry.ids)
      if (existing) return ours(existing)
      let result: { paper: Paper; existed: boolean }
      if (paperIdOf(entry.ids)) {
        result = await this.host.add(describe(entry), { ...extra, ...(entry.pdf ? { pdf: entry.pdf } : {}) })
      } else if (entry.pdf) {
        result = await this.host.addPdf(entry.pdf, extra)
      } else if (entry.title) {
        // Only a title: the services say which paper it is
        const { paper, existingId } = await this.host.resolve(entry.title)
        if (existingId) return ours(existingId)
        result = await this.host.add(paper, extra)
      } else {
        return { result: "failed", error: t`It has no title, identifier or PDF.` }
      }
      return result.existed ? ours(result.paper.id) : { result: "added", id: result.paper.id }
    } catch (error) {
      return { result: "failed", ...(entry.title ? { title: entry.title } : {}), error: messageOf(error) }
    }
  }

  private remember(record: ImportRecord) {
    for (const outcome of Object.values(record.done)) {
      if (outcome.result === "added") this.papers.set(outcome.id, { parse: record.parse !== false })
    }
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`)
  }

  private async read(id: string) {
    if (!/^import-[\w-]+$/.test(id)) return undefined
    return this.live.get(id) ?? readJson<ImportRecord>(this.file(id))
  }

  private async need(id: string) {
    const record = await this.read(id)
    if (!record) throw new RpcFailure(RpcErrorCode.NotFound, t`There is no such import.`)
    return record
  }

  private async write(record: ImportRecord) {
    await mkdir(this.dir, { recursive: true })
    await writeJsonAtomic(this.file(record.id), record)
  }

  private async records(): Promise<ImportRecord[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    const records = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => this.read(n.slice(0, -5))))
    return records.filter((r): r is ImportRecord => !!r).sort((a, b) => b.createdAt - a.createdAt)
  }
}

// The import's file or folder, checked enough to say what is wrong before a task starts
async function checkPath(source: ImportSource, from: string) {
  const file = path.resolve(from)
  const found = await stat(file).catch(() => null)
  if (!found) throw new RpcFailure(RpcErrorCode.InvalidParams, t`There is nothing at ${file}.`)
  if (source === "folder" && !found.isDirectory()) throw new RpcFailure(RpcErrorCode.InvalidParams, t`${file} isn't a folder.`)
  if (source === "bibtex" && found.isDirectory()) throw new RpcFailure(RpcErrorCode.InvalidParams, t`${file} isn't a BibTeX file.`)
  return file
}

function describe(entry: ImportEntry): ResolvedPaper {
  return {
    title: entry.title ?? "",
    authors: entry.authors,
    ids: entry.ids,
    ...(entry.year ? { year: entry.year } : {}),
    ...(entry.venue ? { venue: entry.venue } : {}),
    ...(entry.abstract ? { abstract: entry.abstract } : {}),
  }
}

function summarize(record: ImportRecord): ImportSummary {
  const outcomes = Object.entries(record.done)
  return {
    id: record.id,
    taskId: record.taskId,
    source: record.source,
    path: record.path,
    createdAt: record.createdAt,
    ...(record.entries ? { total: record.entries.length } : {}),
    added: outcomes.flatMap(([, o]) => (o.result === "added" ? [o.id] : [])),
    existed: outcomes.filter(([, o]) => o.result === "existed").length,
    failed: outcomes.flatMap(([key, o]) => (o.result === "failed" ? [{ key, ...(o.title ? { title: o.title } : {}), error: o.error }] : [])),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    ...(record.parse !== undefined ? { parse: record.parse } : {}),
    ...(record.dismissed ? { dismissed: true } : {}),
  }
}
