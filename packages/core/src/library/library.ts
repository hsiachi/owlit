import { t } from "@lingui/core/macro"
import {
  DEFAULT_NOTE_LANGUAGE,
  isTaskFinished,
  RpcErrorCode,
  type ThreadPaper,
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
  type PaperFigure,
  type PaperIds,
  type PaperRecord,
  type PaperState,
  type PaperText,
  type ParsingSettings,
  type ResolvedPaper,
  type Task,
  type TrashedPaper,
  type TaskPriority,
} from "@owlit/protocol"
import { watch, type FSWatcher } from "node:fs"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { NeedsUser, NoPdfOnPage, type BrowserControl, type BrowserHost } from "../host.ts"
import { HttpError, hostOf, sleep, type Http } from "../net/http.ts"
import { browserRoutes, siteOf, yourBrowser, type YourBrowser } from "./browser-routes.ts"
import { DownloadWatch, isThisPaper, sameTitle, WATCH_MS, whoseDownload } from "./downloads.ts"
import { pageVerdict, whereItEnded, type Ended } from "./where-it-ended.ts"
import { PUBLISHERS } from "./publisher-table.ts"
import { Publishers, type VisitEnd } from "./publishers.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import { appendJsonl, ATOMIC_TEMP, exists, ignoreMissing, readJson, readJsonl, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { OWLIT_DIR } from "../workspace/paths.ts"
import { isPaperId, paperDir, PAPERS_DIR, paperStateDir } from "./paths.ts"
import { citationsDue, countCitations } from "./citations.ts"
import { fullyChecked, keepSources, METADATA_CHECKS, PaperIndex, readRecord, recordFrom, writeRecord } from "./records.ts"
import { type Acquisition, type Attempt, describeFailure, downloadPdf, hasPdfFile, isPdfBytes, landingOf, NotAPdf, pdfFile, pdfNamedOnPage, readAcquisition, registeredUrl, type Route, routesFor, unpaywallRoutes, writeAcquisition } from "./pdf.ts"
import { cleanDoi, paperIdOf, parseRef, refOfIds, stripArxivVersion } from "./refs.ts"
import { importPittaPaper, LEGACY_TEXT_MARK, pittaPapers, type PittaPaper } from "./pitta.ts"
import { Imports } from "./bulk/imports.ts"
import { hasText, readText, writeText } from "./text/files.ts"
import { extractText, pageSizes, readPdf, UnreadablePdf } from "./text/extract.ts"
import { contentListToText } from "./parse/convert.ts"
import { awaitCloud, checkCloud, cloudResult, ParseRefused, parseSelfHosted, submitCloud, uploadCloud } from "./parse/mineru.ts"
import { figurePictures, noFigures, readFigures, removeFigures, toPaperFigures, writeFiguresFromLayout, writeFiguresFromText } from "./figures/figures.ts"
import { renderCrops } from "./figures/render.ts"
import { DIGEST_FORMAT, drifted, type DigestRecord } from "./digest/prompt.ts"
import { digestSkill } from "../initiative/skills.ts"
import { identify, type Identified } from "./text/identify.ts"
import { merge, NotAPaper, resolve, type Resolution } from "./resolve.ts"
import { findJournal, listJournal, parseYears, relatedOf, searchSource, type RelatedKind } from "./discover.ts"
import { titleKey, type JournalArticle } from "./sources/crossref.ts"
import type { SourceRecord } from "./sources/types.ts"
import {
  applyPatch,
  freshState,
  readHighlights,
  readNote,
  readState,
  toPaper,
  writeHighlights,
  writeNote,
  writeState,
} from "./state.ts"
import { clean, messageOf, Serial } from "../util.ts"
import { PICTURE_MAX_BYTES } from "../agents/profiles.ts"

// How long a looked-up paper is kept, so adding it right after doesn't ask the services again
const RESOLUTION_TTL_MS = 10 * 60_000
// Long enough for an agent to go through a venue's proceedings before it writes the thread
const FOUND_TTL_MS = 12 * 3_600_000
// How long changes under library/papers/ settle before they are read
const SETTLE_MS = 300
// More papers than this appearing at once from outside are a library brought in, not papers landing
const LANDED_AT_ONCE = 5
// A note saved in bursts (an editor's autosave) is told once it rests
const NOTE_SETTLE_MS = 150
// The steps that find a paper's PDF or read it: a PDF the user puts in stops them
const PDF_STEPS = ["paper.pdf", "paper.pdf.browser", "paper.parse", "paper.figures"]

// Getting PDFs from the user's own browser (getInBrowser): one run at a time, for whichever papers
const FROM_BROWSER = "papers.fromBrowser"
// Each PDF opened there at least this long after the one before, as a person downloading papers one
// after another would. The ACM may block a whole institution's addresses over what looks like
// systematic downloading, and a campus shares one. Through the library's proxy, longer: Tsinghua's
// answers papers 15 s apart with its "minute-limit" page.
const OPEN_GAP_MS = 15_000
const PROXY_GAP_MS = 30_000
// The proxy's limit page: how long to leave it before the next paper through it
const LIMIT_WAIT_MS = 2 * 60_000
// An article page opened for the user: when to look at where it landed (a sign-in stops the run)
const PAGE_LOOK_MS = 10_000
// A check found there is looked at again this often, for this long, before the run stops for it: many
// pass by themselves (Cloudflare's "Just a moment..." can still be running at the 10 s look)
const CHECK_LOOK_MS = 2_000
const CHECK_WAIT_MS = 30_000
// How long an opened PDF may take to land before it counts as not coming (most take 2–12 s, 40 MB about
// 12 s); while a download is still being written, up to the longer limit
const ARRIVAL_MS = 40_000
const ARRIVAL_MAX_MS = 3 * 60_000
// Tests set them shorter (OWLIT_BROWSER_GAP_MS for both gaps, OWLIT_BROWSER_WAIT_MS, _LIMIT_MS, _LOOK_MS, _CHECK_MS)
const openGap = (proxied: boolean) => Number(process.env.OWLIT_BROWSER_GAP_MS ?? (proxied ? PROXY_GAP_MS : OPEN_GAP_MS))
const arrivalWait = () => Number(process.env.OWLIT_BROWSER_WAIT_MS ?? ARRIVAL_MS)
const limitWait = () => Number(process.env.OWLIT_BROWSER_LIMIT_MS ?? LIMIT_WAIT_MS)
// How long after the user's browser was sent for a paper a PDF in Downloads is still taken as its, at
// the next start
const RESUME_MS = 24 * 60 * 60 * 1000
// The daily look for a paper without a PDF, spaced out the longer nothing comes: a day after the first
// look, then 3, 7 and 30 days, since a daily look at every such paper visits their publishers dozens of
// times a day for nothing. New open copies do turn up, so it never stops.
const LOOK_AGAIN_DAYS = [1, 3, 7, 30]
export function lookAgain(acquisition: Pick<Acquisition, "at" | "looks">, now: number) {
  const days = LOOK_AGAIN_DAYS[Math.min(Math.max(acquisition.looks ?? 1, 1), LOOK_AGAIN_DAYS.length) - 1]
  // A little early is fine: a look that ran at 9:05 yesterday is due at 9:00 today
  return now - acquisition.at >= days * 24 * 60 * 60 * 1000 - 60 * 60 * 1000
}
const pageLook = () => Number(process.env.OWLIT_BROWSER_LOOK_MS ?? PAGE_LOOK_MS)
const checkWait = () => Number(process.env.OWLIT_BROWSER_CHECK_MS ?? CHECK_WAIT_MS)
// A paper's turn in a run in the user's browser (Paper.noPdf.fromBrowser, without the browser's name)
type FromBrowser = NonNullable<NonNullable<Paper["noPdf"]>["fromBrowser"]>
// How a PDF owlit didn't fetch itself came, as acquisition.json records it
type PlacedBy = "dropped" | "your-browser"
// What a run in the user's browser did, by paper id: its progress note, as JSON
interface Tally {
  browser?: string
  got: string[]
  noAccess: string[]
  pages: string[]
  missed: string[]
}
// A run as it stood, kept in the workspace's data folder (browser-run.json) while it goes on: the task
// that is the run, the papers it hadn't finished with, and what it had done
interface KeptRun {
  task: string
  left: string[]
  done: number
  tally: Tally
}

// Figures that couldn't be had (the cloud unreachable) are looked for again by a note written after this
const FIGURES_RETRY_MS = 60 * 60_000
// Pictures a digest's agent is shown at most, and the largest (model APIs refuse images over
// 5 MB, Anthropic's limit being the lowest)
const MAX_PICTURES = 16
// How far back the Library's removed papers are offered for restoring
const TRASH_LISTED_MS = 30 * 24 * 60 * 60_000

// A picture for a background agent: an id the prompt names it by, and the image
export interface AgentPicture {
  label: string
  // base64
  data: string
  mimeType: string
}

export interface LibraryServices {
  http: Http
  // A background agent session: one prompt, with pictures for an agent that sees them, and its answer
  // (digests). model is the one chosen for background work, when one is.
  // The user starred a paper (not an agent, not an import)
  starred?: (id: string) => void
  // A paper joined the library one at a time, not by an agent and not in a batch import: the user added
  // it in the app, or another program put its folder in the library
  landed?: (id: string, by: "user" | "outside") => void
  // A background agent run for a task: its session shows beside the paper (ctx.describe)
  agent?: (prompt: string, ctx: TaskContext, pictures?: AgentPicture[]) => Promise<{ text: string; connectorId: string; model?: string }>
  // The language digests are written in: Settings' choice, else the system's
  noteLanguage?: () => Promise<string>
  // The desktop app's hidden browser, for publishers that need cookies, a challenge passed or a login
  browser?: BrowserHost
  // MinerU's settings, read at each use
  parsing?: () => Promise<ParsingSettings>
  // pdfium's wasm, where the desktop app ships it; tests and the CLI find it in the package
  pdfiumWasm?: string
  // Read at each use, so a key the user adds applies at once
  settings: () => Promise<LibrarySettings>
  // A run through the library proxy found its sign-in page (false) or got a PDF through it (true)
  proxySignedIn?: (signedIn: boolean) => void
  // The user's own browser, and the folder it saves to: for papers whose publisher won't let owlit's in
  openExternal?: (url: string, options?: { background?: boolean }) => Promise<void>
  browserName?: () => Promise<string | undefined>
  showBrowser?: () => Promise<void>
  browserControl?: () => Promise<BrowserControl | undefined>
  downloadsDir?: () => string
}

const notFound = (id: string) => new RpcFailure(RpcErrorCode.NotFound, t`That paper is not in the library.`, { id })

// The workspace's papers: library/papers/<id>/ (what each paper is, and the user's note.md beside it) and
// .owlit/papers/<id>/ (the rest of what the user thinks of it: state, highlights). Changes from the app
// are answered, not echoed; changes core makes on its own (a task) or another program makes go out
// through onChange.
// One search in .owlit/searches.jsonl: what was asked where, by whom (chat:<id>, run:<kind>:<task>, agent,
// you), and the ids of what it found
export interface SearchLine {
  at: number
  query: string
  source: string
  filters?: object
  by: string
  results: string[]
}

const RECENT_SEARCHES = 2000

export class Library {
  readonly root: string
  // This workspace's folder in owlit's data directory (machine-specific state)
  readonly dataDir: string
  readonly index: PaperIndex
  private readonly services: LibraryServices
  private resolutions = new Map<string, { resolution: Resolution; at: number; partial: boolean }>()
  // Every paper a search, a neighbour list or a journal list showed lately, as it showed it: what a
  // thread's row takes when the paper isn't in the Library
  private found = new Map<string, { paper: FoundPaper; at: number; query: string }>()
  private searchLog: SearchLine[] | null = null
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
  private readonly serial = new Serial()
  // Libraries brought in at once (Zotero, BibTeX, a folder of PDFs)
  readonly imports: Imports
  // What each import.pitta run did, by task id
  private pittaSummaries = new Map<string, { added: number; skipped: number; failed: string[] }>()
  // SHA-256 of each paper's PDF → paper, built the first time a file is dropped
  private pdfHashes: Map<string, string> | undefined
  // How often owlit visits each publisher's site, and which ones it leaves alone for now
  private readonly publishers: Publishers
  // Papers opened in the user's browser, whose PDF is looked for in their Downloads folder
  private downloadWatch: DownloadWatch | undefined
  // Papers being got from the user's browser, in their turn, and what each is doing; when the last
  // was opened there; that browser's name, for saying what it may be asking; a placed PDF ends a wait
  private browserQueue: string[] = []
  private fromBrowser = new Map<string, FromBrowser>()
  // The tab owlit opened for each paper, where the browser can be driven: Show browser goes there
  private browserTabs = new Map<string, { window: string; tab: string }>()
  private browserOpenedAt = 0
  private browserRunning = false
  // The look in Downloads at start, which a run waits for before it opens anything again
  private resumed: Promise<void> | undefined
  private browserLabel: string | undefined
  private arrivals = new Map<string, () => void>()
  // A downloaded PDF that may be the paper's, waiting for the user to say: paper → file
  private offered = new Map<string, string>()

  constructor(root: string, dataDir: string, services: LibraryServices) {
    this.root = root
    this.dataDir = dataDir
    this.services = services
    this.publishers = new Publishers(dataDir)
    for (const { api } of PUBLISHERS) if (api) services.http.limit(api.host, api.limit)
    this.index = new PaperIndex(root)
    this.imports = new Imports(dataDir, {
      find: async (ids) => (Object.keys(ids).length ? this.index.find(ids) : undefined),
      add: (paper, extra) => this.addNew(paper, "user", "background", extra),
      addPdf: (file, extra) => this.importPdf(file, { priority: "background", ...extra }),
      resolve: (title) => this.byTitle(title),
      parsingOn: async () => {
        const settings = (await this.services.parsing?.()) ?? {}
        return !!settings.service && !(settings.service === "cloud" && !settings.token) && settings.auto !== false
      },
    })
  }

  // The scheduler that runs this library's tasks (paper.metadata and what follows an add)
  attach(scheduler: Scheduler) {
    this.scheduler = scheduler
    this.imports.attach(scheduler)
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
    const pdf = await hasPdfFile(this.root, id)
    const paper = toPaper({ ...record, id }, state, pdf)
    if (await exists(path.join(paperDir(this.root, id), "digest.md"))) {
      paper.hasDigest = true
      Object.assign(paper, await this.digestState(id))
    }
    const text = await this.textQuality(id)
    if (text) paper.text = text
    if (!pdf) {
      const acquisition = await readAcquisition(this.root, id)
      // Routes skipped (Unpaywall without an email) weren't tried, so they aren't named
      const tried = acquisition?.tried.filter((t) => !t.error?.startsWith("Not tried")).map((t) => t.route)
      if (acquisition?.result === "no_pdf") {
        paper.noPdf = { tried: [...new Set(tried)], at: acquisition.at }
        // Whatever the publisher's page wanted (a check, a sign-in) or a publisher that lets only the
        // user's browser in, the way is the same: their own browser
        if (acquisition.needs) paper.noPdf.needs = "browser"
        if (record.ids.doi) paper.noPdf.browserOpens = yourBrowser(record.ids.doi, acquisition.needs?.host).opens
        let from = this.fromBrowser.get(id)
        // An article page opened for the user is looked for in Downloads a while; after that it is just
        // a paper waiting again
        if (from?.state === "page" && !this.downloadWatch?.until(id)) {
          this.fromBrowser.delete(id)
          from = undefined
        }
        if (from) paper.noPdf.fromBrowser = { ...from, ...(this.browserLabel ? { browser: this.browserLabel } : {}) }
        // What the user's browser was told, or else what owlit's own look through the library found,
        // whichever is newer
        const theirs = acquisition.yourBrowser
        const ours = acquisition.looked
        const said = ours && (!theirs || ours.at > theirs.at) ? { ...ours, by: "owlit" as const } : theirs
        // A run that sent the browser and got nothing, before this start: still tried, so Get them
        // doesn't open the same page again
        if (said?.outcome === "missed" && !from) paper.noPdf.fromBrowser = { state: "missed", ...(this.browserLabel ? { browser: this.browserLabel } : {}) }
        else if (said && !from) paper.noPdf.noAccess = { refused: said.outcome === "refused", ...(said.outcome === "missing" ? { missing: true } : {}), at: said.at, ...(said.host ? { host: said.host } : {}), ...(said.title ? { title: said.title } : {}), ...("by" in said ? { by: said.by } : {}) }
        const offered = this.offered.get(id)
        if (offered) paper.noPdf.offered = path.basename(offered)
        if (acquisition.sentToBrowser) paper.noPdf.sentAt = acquisition.sentToBrowser.at
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
    const existingId = (await this.index.find(resolution.ids)) ?? (await this.index.twin(resolution.title, resolution.ids))
    return { paper: { id: resolution.id, ...pick(resolution) }, existingId }
  }

  // The paper with exactly this title, as OpenAlex knows it: an import's entry with nothing else to go on
  // (a book, an old paper). A near match isn't taken, since nobody is there to check it.
  private async byTitle(title: string): Promise<{ paper: ResolvedPaper; existingId?: string }> {
    const found = await searchSource(this.services.http, title, 5, "openalex", {}, await this.services.settings(), { retries: 1 }).catch((error) => {
      throw asRpcFailure(error)
    })
    const hit = found.records.find((r) => r.title && titleKey(r.title) === titleKey(title))
    if (!hit) throw new RpcFailure(RpcErrorCode.NotFound, t`No paper with this title was found.`)
    const [paper] = await this.mark([hit])
    return { paper, ...(paper.inLibrary ? { existingId: paper.inLibrary } : {}) }
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

  // Adds a looked-up paper, saying whether the library had it already (under one of its ids, or as the
  // same title where one of the two has no DOI); one it had is returned as it is. An import hands over the PDF it has (nothing is downloaded then)
  // and the paper's tags.
  addNew(
    resolved: ResolvedPaper,
    addedBy: Paper["addedBy"] = "user",
    priority: TaskPriority = "asked",
    extra: { pdf?: string; tags?: string[]; imported?: { parse: boolean } } = {},
  ): Promise<{ paper: Paper; existed: boolean }> {
    return this.serial.run(async () => {
      const id = resolved.id ?? paperIdOf(resolved.ids)
      if (!id || !isPaperId(id)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`owlit can't tell which paper that is.`)
      // A folder already there is that paper even if the index missed it: never written over
      const existing =
        (await this.index.find(resolved.ids)) ?? ((await readRecord(this.root, id)) ? id : undefined) ?? (await this.index.twin(resolved.title, resolved.ids))
      if (existing) return { paper: (await this.get(existing))!, existed: true }
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
      await writeState(this.root, id, { ...freshState(addedBy), ...(extra.tags?.length ? { tags: extra.tags } : {}) })
      // Known as imported before any step that reads it is queued
      if (extra.imported) this.imports.note(id, extra.imported)
      this.index.set(id, record.ids, record.title)
      // What a lookup didn't fill (or a search result left unchecked: no Crossref title), the services
      // fill now; then the steps that follow an add
      if (!resolution) this.queue("paper.metadata", id, priority)
      else if (!fullyChecked(resolution)) this.queue("paper.metadata", id, "background")
      if (extra.pdf) await this.placePdf(id, extra.pdf, await sha256Of(extra.pdf), priority)
      else for (const kind of ["paper.pdf", "paper.text", "index.paper"]) this.queue(kind, id, priority)
      if (addedBy === "user" && !extra.imported) this.services.landed?.(id, "user")
      return { paper: (await this.get(id))!, existed: false }
    })
  }

  // The user's judgement, position or corrections
  update(id: string, patch: PaperPatch): Promise<Paper> {
    return this.serial.run(async () => {
      const record = await readRecord(this.root, id)
      if (!record) throw notFound(id)
      const state = (await readState(this.root, id)) ?? freshState("user", record.fetchedAt)
      if (id.startsWith("local-") && patch.ids && paperIdOf(cleanIds(patch.ids))) return this.relink(id, record, state, patch)
      await writeState(this.root, id, applyPatch(state, record, patch))
      // Starring a paper says it is worth reading: Owlit's rules hear it (a digest in the background)
      if (patch.starred && !state.starred) this.services.starred?.(id)
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
      throw new RpcFailure(RpcErrorCode.Conflict, t`Another paper in your library already has that id.`, { id: other })
    }
    this.scheduler?.cancelSubject(id)
    await mkdir(path.dirname(paperStateDir(this.root, next)), { recursive: true })
    await rename(paperDir(this.root, id), paperDir(this.root, next))
    await rename(paperStateDir(this.root, id), paperStateDir(this.root, next)).catch(ignoreMissing)
    await writeRecord(this.root, { ...record, id: next, ids })
    const { ids: _ids, ...rest } = patch
    await writeState(this.root, next, applyPatch(state, record, rest))
    this.index.delete(id)
    this.index.set(next, ids, record.title)
    for (const [sha, paper] of this.pdfHashes ?? []) if (paper === id) this.pdfHashes!.set(sha, next)
    const aliases = await this.aliases()
    for (const [from, to] of Object.entries(aliases)) if (to === id) aliases[from] = next
    aliases[id] = next
    await writeJsonAtomic(this.aliasFile(), { version: 1, aliases })
    this.queue("paper.metadata", next, "asked")
    this.queueText(next, "background")
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
    return this.serial.run(async () => {
      const stamp = Date.now()
      for (const id of ids) if (isPaperId(id)) await this.moveToTrash(id, stamp)
      return null
    })
  }

  // An agent taking back papers it added: only those, and only while the user hasn't worked with them
  // (consent follows ownership: what the user has touched is theirs to remove)
  removeByAgent(ids: string[]): Promise<{ removed: string[]; refused: { id: string; why: string }[] }> {
    return this.serial.run(async () => {
      const removed: string[] = []
      const refused: { id: string; why: string }[] = []
      const stamp = Date.now()
      for (const id of ids) {
        if (!isPaperId(id) || !(await readRecord(this.root, id))) refused.push({ id, why: "it isn't in the library" })
        else if ((await readState(this.root, id))?.addedBy !== "agent") refused.push({ id, why: "the user added it; ask them to remove it" })
        else if (await this.touched(id)) refused.push({ id, why: "the user has starred, tagged, marked, highlighted or written about it; ask them" })
        else {
          await this.moveToTrash(id, stamp)
          removed.push(id)
        }
      }
      return { removed, refused }
    })
  }

  // The most recent removal of each paper, put back. Found by the paper's id whichever trash entry holds
  // it, and safe to ask twice: a paper already in the library (Undo pressed again, or restored from the
  // removed list meanwhile) comes back as it is, never from an older entry over what is there.
  restore(ids: string[]): Promise<Paper[]> {
    return this.serial.run(async () => {
      const entries = await this.trashEntries()
      const restored: Paper[] = []
      for (const id of ids) {
        if (!isPaperId(id)) continue
        if (await readRecord(this.root, id)) {
          const paper = await this.get(id)
          if (paper) restored.push(paper)
          continue
        }
        const entry = entries.find((e) => e.id === id)
        if (!entry) continue
        const trash = path.join(this.root, OWLIT_DIR, "trash", entry.name)
        await mkdir(path.dirname(paperDir(this.root, id)), { recursive: true })
        await mkdir(path.dirname(paperStateDir(this.root, id)), { recursive: true })
        await moveInto(path.join(trash, "paper"), paperDir(this.root, id))
        await moveInto(path.join(trash, "state"), paperStateDir(this.root, id))
        await rm(trash, { recursive: true, force: true })
        const record = await readRecord(this.root, id)
        const paper = record && (await this.get(id))
        if (!paper) continue
        this.index.set(id, record.ids, record.title)
        restored.push(paper)
        await this.resume(id)
      }
      return restored
    })
  }

  // Papers removed in the last 30 days, newest first, one entry per paper. A paper back in the library
  // (restored, or added again) and a copy folded into another paper (its id an alias now) aren't listed:
  // restoring either would bring back something the library already has.
  async trash(): Promise<TrashedPaper[]> {
    const since = Date.now() - TRASH_LISTED_MS
    const aliases = await this.aliases()
    const listed: TrashedPaper[] = []
    for (const entry of await this.trashEntries()) {
      if (entry.at < since) break
      if (listed.some((p) => p.id === entry.id) || aliases[entry.id] || (await readRecord(this.root, entry.id))) continue
      const dir = path.join(this.root, OWLIT_DIR, "trash", entry.name)
      const record = await readJson<PaperRecord>(path.join(dir, "paper", "paper.json")).catch(() => undefined)
      if (!record || typeof record.title !== "string") continue
      // Named as the user last saw it: their corrections (state.json's overrides) over the record
      const state = await readJson<PaperState>(path.join(dir, "state", "state.json")).catch(() => undefined)
      const paper = toPaper({ ...record, id: entry.id, authors: Array.isArray(record.authors) ? record.authors : [] }, state ?? freshState("user", entry.at), false)
      listed.push(clean({ id: entry.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, removedAt: entry.at }))
    }
    return listed
  }

  // The papers in .owlit/trash/ (<stamp>-paper-<id>), newest first
  private async trashEntries(): Promise<{ name: string; id: string; at: number }[]> {
    const names = await readdir(path.join(this.root, OWLIT_DIR, "trash")).catch(() => [] as string[])
    return names
      .flatMap((name) => {
        const match = /^(\d+)-paper-(.+)$/.exec(name)
        return match && isPaperId(match[2]) ? [{ name, id: match[2], at: Number(match[1]) }] : []
      })
      .sort((a, b) => b.at - a.at)
  }

  // The steps a removal cancelled, queued again for a paper put back: its PDF, its text, its details
  private async resume(id: string) {
    const pdf = await hasPdfFile(this.root, id)
    if (!pdf && !(await readAcquisition(this.root, id))) this.queue("paper.pdf", id, "background")
    if (pdf && !(await hasText(this.root, id))) this.queue("paper.text", id, "background")
    const record = await readRecord(this.root, id)
    if (record?.fetchedAt && (record.checked ?? 0) < METADATA_CHECKS && refOfIds(record.ids)) this.queue("paper.metadata", id, "background")
  }

  // Adds a highlight, or replaces the one with its id
  putHighlight(highlight: Highlight): Promise<null> {
    return this.serial.run(async () => {
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
    return this.serial.run(async () => {
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
    return this.serial.run(async () => {
      if (!(await readRecord(this.root, paperId))) throw notFound(paperId)
      this.knownNotes.set(paperId, content.trim() ? content : "")
      return writeNote(this.root, paperId, content)
    })
  }

  // An agent's edit to a paper's note (its file is library/papers/<id>/note.md, which agents write through
  // owlit's fs rather than directly): written like the window's own, then told to windows, which take it
  // into the open note as one undoable change
  async writeNoteFor(paperId: string, content: string): Promise<void> {
    await this.serial.run(async () => {
      if (!(await readRecord(this.root, paperId))) throw notFound(paperId)
      // Learned before it changes, so the change is told even for a paper no window has listed yet
      if (!this.knownNotes.has(paperId)) this.knownNotes.set(paperId, (await readNote(this.root, paperId))?.content ?? "")
      await writeNote(this.root, paperId, content)
    })
    await this.noteMayHaveChanged(paperId)
  }

  // The paper a workspace-relative path is the note of, if it is one
  noteOf(rel: string): string | null {
    const prefix = `${PAPERS_DIR.split(path.sep).join("/")}/`
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
    if (!this.scheduler?.knows("paper.pdf")) throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit can't look for PDFs here.`)
    let task = await this.scheduler.run("paper.pdf", id, "waiting")
    // Not after a failure (offline): the browser would only fail too, and its answer would hide why
    if (task.state !== "failed" && !(await hasPdfFile(this.root, id)) && this.scheduler.knows("paper.pdf.browser")) task = await this.scheduler.run("paper.pdf.browser", id, "waiting")
    // Under the library's lock: a run that placed the PDF while this one looked may still be
    // writing what it did (acquisition.json)
    const paper = await this.serial.run(() => this.get(id))
    if (!paper) throw notFound(id)
    if (!paper.pdf && task.state === "failed") throw new RpcFailure(RpcErrorCode.Unavailable, task.error ?? t`owlit couldn't look for a PDF.`)
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
        // A note already there stays, unless the user asked for it to be written again
        const rewrite = await this.rewriteAsked(id)
        if (!rewrite && (await exists(path.join(dir, "digest.md")))) return
        const text = await readFile(path.join(dir, "text.md"), "utf8").catch(() => null)
        if (text === null) {
          if (await hasPdfFile(this.root, id)) ctx.require("paper.text", id)
          return
        }
        // The figures first, so the note can show them. Looking for them never fails (paper.figures
        // notes what went wrong); one that failed a while ago is tried again.
        const figures = await readFigures(this.root, id)
        if ((!figures || (figures.error && Date.now() - figures.at > FIGURES_RETRY_MS)) && (await hasPdfFile(this.root, id))) ctx.require("paper.figures", id)
        ctx.progress(0, undefined, "writing")
        const language = (await this.services.noteLanguage?.()) ?? DEFAULT_NOTE_LANGUAGE
        const listed = figures?.figures ?? []
        const pictures = (await figurePictures(this.root, id, figures ?? { version: 1, source: "text", at: 0, figures: [] }))
          .filter((p) => p.data.length <= PICTURE_MAX_BYTES)
          .slice(0, MAX_PICTURES)
          .map((p) => ({ label: `${p.figure.id} (${p.figure.label}, p. ${p.figure.page + 1})`, data: p.data.toString("base64"), mimeType: p.mimeType }))
        const prompt = digestSkill.instructions({ id, record, text, language, figures: listed, pictures: pictures.length > 0 })
        const { text: answer, connectorId, model } = await agent(prompt, ctx, pictures)
        const digest = cleanDigest(answer)
        if (!digest.startsWith("# ") || digest.length < 200) throw new Error("The agent's note didn't look like a digest.")
        await this.serial.run(async () => {
          // The paper moved to a DOI or went to the trash while the agent wrote (both cancel under this
          // lock): the note isn't written into a folder that is no longer there
          ctx.signal.throwIfAborted()
          // Written meanwhile (an import brought one) and not asked to be replaced: the one there stays
          if (!rewrite && (await exists(path.join(dir, "digest.md")))) return
          const kept: DigestRecord = { version: 1, format: DIGEST_FORMAT, by: connectorId, ...(model ? { model } : {}), language, ...(drifted(digest, language) ? { drift: true } : {}), at: Date.now() }
          await writeFileAtomic(path.join(dir, "digest.md"), digest, { parents: false })
          await writeJsonAtomic(path.join(dir, "digest.json"), kept, { parents: false })
        })
        await this.announce([id])
      },
    })
  }

  // A paper's figures as pictures (figures.json), for its digest: from MinerU's result when the
  // cloud still has it, else from the figure blocks text.json has. Never fails, so the note it comes
  // before never does on its account: what went wrong goes into figures.json, empty.
  private figuresTask() {
    return defineTask("paper.figures", {
      lane: "parse",
      retries: 0,
      run: async (ctx) => {
        const id = ctx.task.subject
        if (!(await readRecord(this.root, id)) || !(await hasPdfFile(this.root, id))) return
        try {
          const pdf = await readFile(pdfFile(this.root, id))
          const parse = await readJson<{ status?: string; job?: string }>(path.join(paperDir(this.root, id), "parse.json")).catch(() => undefined)
          const settings = (await this.services.parsing?.()) ?? {}
          if (parse?.status === "done" && parse.job && settings.service === "cloud" && settings.token) {
            const result = await cloudResult(this.services.http, settings, parse.job, ctx.signal)
            if (result?.layout) {
              await writeFiguresFromLayout(this.root, id, result.layout, result.images, pdf, this.services.pdfiumWasm, ctx.signal)
              return
            }
          }
          const text = await readText(this.root, id)
          await writeFiguresFromText(this.root, id, text?.source === "mineru" ? text : { version: 1, source: "pdfium", pages: [] }, pdf, this.services.pdfiumWasm, ctx.signal)
        } catch (error) {
          if (ctx.signal.aborted) throw error
          await noFigures(this.root, id, messageOf(error))
        }
      },
    })
  }

  // The publisher's page in owlit's hidden browser, directly and then through the library's proxy, with
  // nobody looking. A page that wants a person (a check, a sign-in) is noted in acquisition.json, and the
  // paper waits for the user's own browser (getInBrowser); a check also holds the site: owlit doesn't
  // go back on its own until the hold is over. Unattended visits to one site are spaced out
  // (publishers.ts). A publisher that lets only the user's browser in isn't visited at all.
  private browserTask(browser: BrowserHost) {
    return defineTask("paper.pdf.browser", {
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
        const routes = browserRoutes(record.ids.doi, settings.proxy, registered)
        const { sites } = routes[0]
        if (routes[0].browserOnly) {
          if (previous?.result === "no_pdf" && previous.needs?.reason === "browser") return
          const host = hostOf(routes[0].landing)
          tried.push({ route: routes[0].name, url: routes[0].landing, error: `Not tried: ${host} only lets your own browser in.`, at: Date.now() })
          needs = { reason: "browser", route: routes[0].name, at: Date.now(), host }
          const noted = await this.noPdf(id, ctx.signal, () => ({ version: 1, result: "no_pdf", tried, at: Date.now(), dropHere: dest, needs }))
          if (noted) await this.announce([id])
          return
        }
        // The user waiting on this very paper (Find PDF, Try again) gets one visit now; everything else
        // keeps to the site's hold and its turn
        if (ctx.task.priority !== "waiting") {
          const hold = await this.publishers.heldAny(sites)
          if (hold) {
            // Noted for the user's browser without a visit; a paper already noted stays as it is
            if (previous?.result === "no_pdf" && previous.needs) return
            tried.push({ route: routes[0].name, url: routes[0].landing, error: `Not tried: ${hold.site} asked for a person recently.`, at: Date.now() })
            needs = { reason: hold.reason, route: routes[0].name, at: Date.now(), host: hold.site }
            const noted = await this.noPdf(id, ctx.signal, () => ({ version: 1, result: "no_pdf", tried, at: Date.now(), dropHere: dest, needs }))
            if (noted) await this.announce([id])
            return
          }
          // A site whose last visits were checks and never a PDF: the user's browser without a visit, as
          // for the ACM, until its weekly look (publishers.ts)
          const checking = (await Promise.all(sites.map(async (site) => ((await this.publishers.onlyChecks(site)) ? site : undefined)))).find(Boolean)
          if (checking) {
            if (previous?.result === "no_pdf" && previous.needs) return
            tried.push({ route: routes[0].name, url: routes[0].landing, error: `Not tried: ${checking} keeps showing owlit's browser a check.`, at: Date.now() })
            needs = { reason: "browser", route: routes[0].name, at: Date.now(), host: checking }
            const noted = await this.noPdf(id, ctx.signal, () => ({ version: 1, result: "no_pdf", tried, at: Date.now(), dropHere: dest, needs }))
            if (noted) await this.announce([id])
            return
          }
          const wait = Math.max(0, ...sites.map((site) => this.publishers.waitFor(site)))
          if (wait > 0) ctx.later(wait)
        }
        for (const site of sites) this.publishers.visited(site)
        // Sites that just turned an unattended visit away: the proxy leading back to one is stopped
        const avoid: string[] = []
        // What the pages that gave no PDF were: through the library's proxy, an offer to buy is the library
        // saying no; directly, it may only be that owlit's browser isn't signed in where the user's is
        let looked: Acquisition["looked"]
        // How a direct visit ended, kept against the site it ended on (or the route's own)
        const ended = (host: string | undefined, how: VisitEnd) => {
          const site = host ? siteOf(host) : sites[0]
          return site ? this.publishers.visitEnded(site, how) : undefined
        }
        for (const route of routes) {
          ctx.progress(0, undefined, route.name)
          const { proxied } = route
          try {
            const bytes = await browser.fetchPdf({
              landing: route.landing,
              pdf: route.pdf,
              pdfOnPageHost: proxied,
              proxyHost: proxied && settings.proxy ? hostOf(settings.proxy.base) : undefined,
              allowHosts: route.allowHosts,
              avoidSites: [...avoid],
              signal: ctx.signal,
              report: (event) => void this.publishers.log({ paper: id, route: route.name, ...event }),
            })
            if (!isPdfBytes(bytes)) throw new Error(`${route.name} gave something that isn't a PDF.`)
            tried.push({ route: route.name, url: route.landing, status: 200, at: Date.now() })
            if (proxied) this.services.proxySignedIn?.(true)
            for (const site of sites) await this.publishers.visitEnded(site, "pdf")
            // Under the library's lock, like a no_pdf verdict and a drop: see noPdf()
            await this.serial.run(async () => {
              // Cancelled meanwhile (the user attached a PDF, or the paper moved or went to the trash): it
              // isn't wanted over theirs, nor where the paper was
              ctx.signal.throwIfAborted()
              await writeFileAtomic(dest, Buffer.from(bytes), { parents: false })
              const sha256 = await sha256Of(dest)
              this.pdfHashes?.set(sha256, id)
              await writeAcquisition(this.root, id, { version: 1, result: "ok", route: route.name, tried, at: Date.now(), dropHere: dest, sha256 })
            })
            this.queueText(id, ctx.task.priority)
            await this.announce([id])
            // The site let owlit through (a run the user waited on): its hold is over, and its other papers
            // that waited for the user may now come unattended (their turns spaced out)
            const passed = new Set([...sites, ...(previous?.needs?.host ? [siteOf(previous.needs.host)] : [])])
            if (await this.publishers.heldAny([...passed])) {
              for (const site of passed) await this.publishers.release(site)
              await this.retrySites(passed, id)
            }
            return
          } catch (error) {
            if (ctx.signal.aborted) throw error
            if (proxied && error instanceof NeedsUser && error.reason === "login") this.services.proxySignedIn?.(false)
            tried.push({ route: route.name, url: route.landing, error: messageOf(error), at: Date.now() })
            if (error instanceof NeedsUser) {
              // The proxy's own sign-in stands for the publisher behind it: noted as the publisher's, so
              // the user's browser is sent to that publisher (through the proxy) and not to the proxy
              const host = proxied && error.reason === "login" ? hostOf(routes[0].landing) : error.host
              needs ??= { reason: error.reason, route: route.name, at: Date.now(), ...(host ? { host } : {}) }
              if (error.reason === "challenge" && error.host) {
                await this.publishers.hold(siteOf(error.host), "challenge")
                avoid.push(siteOf(error.host))
                if (!proxied) await ended(error.host, "check")
              }
            } else if (error instanceof NoPdfOnPage) {
              const verdict = pageVerdict(error.seen)
              const host = hostOf(error.seen.url) || undefined
              if (!proxied) await ended(host, verdict)
              if (verdict === "missing" || (verdict === "no-access" && proxied)) {
                looked = { outcome: verdict, at: Date.now(), ...(host ? { host } : {}), ...(error.seen.title ? { title: error.seen.title } : {}) }
              } else {
                // No PDF on the page, or an offer only owlit's browser was shown: the user's browser, with
                // their sign-ins, may still get it there
                needs ??= { reason: "browser", route: route.name, at: Date.now(), ...(host ? { host } : {}) }
              }
            } else if (!proxied) await ended(undefined, "error")
          }
        }
        if (!settings.proxy?.base) tried.push({ route: "browser:proxied", url: "", error: "Not tried: no library proxy is set up.", at: Date.now() })
        // A page that wasn't there isn't the user's browser's to look at either
        if (looked?.outcome === "missing") needs = undefined
        const noted = await this.noPdf(id, ctx.signal, (before) => ({
          version: 1,
          result: "no_pdf",
          tried,
          at: Date.now(),
          dropHere: dest,
          ...(before?.looks ? { looks: before.looks } : {}),
          ...(needs ? { needs } : {}),
          looked,
        }))
        if (noted) await this.announce([id])
      },
    })
  }

  // A digest is wanted (the paper was opened, starred, asked for by the user or an agent): queued
  // when the paper has, or will have, text to read and has no note yet. A note already there, pitta's
  // included, is written again only when the user asks (rewrite), never on owlit's own account.
  async wantDigest(id: string, priority: TaskPriority, options: { rewrite?: boolean } = {}) {
    if (await this.digestHeldBack(id, options.rewrite)) return
    const dir = paperDir(this.root, id)
    // Asked for on disk, beside the note: the task may run after a restart, and must still know
    if (options.rewrite && (await exists(path.join(dir, "digest.md")))) {
      await this.serial.run(async () => {
        // A note with no record (pitta's) gets one that says no more than the file does
        const record = (await readJson<DigestRecord>(path.join(dir, "digest.json")).catch(() => undefined)) ?? {
          version: 1,
          by: "unknown",
          at: Math.round((await stat(path.join(dir, "digest.md"))).mtimeMs),
        }
        await writeJsonAtomic(path.join(dir, "digest.json"), { ...record, rewriteAsked: Date.now() } satisfies DigestRecord, { parents: false })
      })
    }
    this.queue("paper.digest", id, priority)
  }

  // Why no digest would be written for a paper now (Owlit's rules log it), or null when one would
  async digestHeldBack(id: string, rewrite = false): Promise<string | null> {
    if (!this.services.agent) return "no agent to write it"
    if (!isPaperId(id) || !(await readRecord(this.root, id))) return "not in the library"
    const dir = paperDir(this.root, id)
    if (!rewrite && (await exists(path.join(dir, "digest.md")))) return "has a digest"
    if (!(await exists(path.join(dir, "text.md"))) && !(await hasPdfFile(this.root, id))) return "nothing to read"
    return null
  }

  private async rewriteAsked(id: string) {
    const record = await readJson<DigestRecord>(path.join(paperDir(this.root, id), "digest.json")).catch(() => undefined)
    return !!record?.rewriteAsked
  }

  // A paper's figures and tables as pictures, for its digest
  async figures(id: string): Promise<PaperFigure[]> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    return toPaperFigures(id, await readFigures(this.root, id))
  }

  // A page of the paper as a picture, small, for a glance at what a digest points at (p. 7)
  async pagePicture(id: string, page: number): Promise<{ data: string; mimeType: string }> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    if (!(await hasPdfFile(this.root, id))) throw new RpcFailure(RpcErrorCode.NotFound, "The paper has no PDF.", { id })
    const [picture] = await renderCrops(await readFile(pdfFile(this.root, id)), [{ page }], this.services.pdfiumWasm, 1).catch((error) => {
      throw new RpcFailure(RpcErrorCode.NotFound, messageOf(error), { id })
    })
    return { data: picture.toString("base64"), mimeType: "image/png" }
  }

  // When the paper's note was written, and how it stands against how notes are written now
  private async digestState(id: string): Promise<Pick<Paper, "digestAt" | "digestOutdated">> {
    const dir = paperDir(this.root, id)
    const record = await readJson<DigestRecord>(path.join(dir, "digest.json")).catch(() => undefined)
    const at = record?.at ?? (await stat(path.join(dir, "digest.md")).then((s) => s.mtimeMs, () => undefined))
    const state: Pick<Paper, "digestAt" | "digestOutdated"> = at ? { digestAt: Math.round(at) } : {}
    if (record?.format !== DIGEST_FORMAT) return { ...state, digestOutdated: "format" }
    const language = (await this.services.noteLanguage?.()) ?? DEFAULT_NOTE_LANGUAGE
    return record.language && record.language !== language ? { ...state, digestOutdated: "language" } : state
  }

  // The paper's digests (digest.md), or null when it has none
  async digest(id: string): Promise<string | null> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    return readFile(path.join(paperDir(this.root, id), "digest.md"), "utf8").catch(() => null)
  }

  // Brings a pitta library (~/.pitta) into the workspace once, as a task with progress; papers the
  // library already has are left as they are
  async importPitta(root: string): Promise<{ added: number; skipped: number; failed: string[] }> {
    if (!this.scheduler?.knows("import.pitta")) throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit can't import here.`)
    const subject = path.resolve(root)
    const task = await this.scheduler.run("import.pitta", subject, "asked")
    const summary = this.pittaSummaries.get(task.id)
    if (task.state !== "done" || !summary) throw new RpcFailure(RpcErrorCode.InvalidParams, task.error ?? t`The pitta library couldn't be read.`)
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
    const now = Date.now()
    for (const [id, kept] of this.found) if (now - kept.at >= FOUND_TTL_MS) this.found.delete(id)
    for (const p of papers) if (p.id) this.found.set(p.id, { paper: p, at: now, query: asked.query })
    const line: SearchLine = { at: Date.now(), ...asked, by, results: papers.flatMap((f) => (f.id ? [f.id] : [])) }
    ;(await this.recentSearches()).push(line)
    await appendJsonl(path.join(this.root, OWLIT_DIR, "searches.jsonl"), line)
  }

  // The searches one chat or background run made since a moment, for the thread it writes to
  async searchesBy(by: string, since: number): Promise<SearchLine[]> {
    return (await this.recentSearches()).filter((s) => s.by === by && s.at > since)
  }

  // The latest searches, read from the log once (a run that outlived a restart keeps its earlier ones)
  private async recentSearches() {
    if (!this.searchLog) {
      const lines = await readJsonl<SearchLine>(path.join(this.root, OWLIT_DIR, "searches.jsonl"))
      this.searchLog ??= lines.slice(-RECENT_SEARCHES)
    }
    if (this.searchLog.length > RECENT_SEARCHES * 2) this.searchLog.splice(0, this.searchLog.length - RECENT_SEARCHES)
    return this.searchLog
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

  // A PDF the user found, placed as the paper's file; the steps that need it follow. The route says how
  // it came: "dropped" (or chosen) by the user, "your-browser" when taken from Downloads after owlit sent
  // the user's browser for it.
  attachPdf(id: string, file: string, route: PlacedBy = "dropped"): Promise<Paper> {
    return this.serial.run(async () => {
      if (!(await readRecord(this.root, id))) throw notFound(id)
      await assertPdf(file)
      await this.placePdf(id, file, await sha256Of(file), "asked", route)
      return (await this.get(id))!
    })
  }

  private watchDownloads() {
    const dir = this.services.downloadsDir?.()
    if (!dir) return undefined
    this.downloadWatch ??= new DownloadWatch(dir, (file) => this.lookAtPdf(file), (paper, file, sure) => void this.downloadFound(paper, file, sure))
    return this.downloadWatch
  }

  // Papers owlit looked for and couldn't get alone, got from the user's own browser in turn (the
  // papers.fromBrowser task): ones already waiting keep their place, one that came to nothing goes again
  // after them. A run stopped for the user goes on.
  async getInBrowser(ids: string[]): Promise<Paper[]> {
    if (!this.services.openExternal || !this.services.downloadsDir || !this.scheduler?.knows(FROM_BROWSER)) {
      throw new RpcFailure(RpcErrorCode.Unavailable, t`Opening your browser needs the owlit desktop app.`)
    }
    const taken: string[] = []
    for (const id of ids) {
      const record = await readRecord(this.root, id)
      if (!record) throw notFound(id)
      if ((await hasPdfFile(this.root, id)) || !(await this.addressFor(id, record))) continue
      taken.push(id)
    }
    // Added to the queue together, with nothing awaited between, so a run can't end in the middle
    for (const id of taken) {
      const state = this.fromBrowser.get(id)?.state
      if (state === "queued" || state === "opened" || state === "waiting") continue
      this.browserQueue.push(id)
      this.fromBrowser.set(id, { state: "queued" })
    }
    if (taken.length) this.runFromBrowser()
    await this.announce(taken)
    const papers = await Promise.all(ids.map((id) => this.get(id)))
    return papers.filter((p): p is Paper => !!p)
  }

  // Brings the user's browser to the front: at the paper's tab when owlit opened one for it, else at the
  // tab the run stopped on, else as it is
  async showBrowser(id?: string): Promise<null> {
    const waiting = [...this.fromBrowser].find(([, from]) => from.state === "waiting")?.[0]
    const at = (id && this.browserTabs.get(id)) || (waiting && this.browserTabs.get(waiting))
    const control = at ? await this.services.browserControl?.().catch(() => undefined) : undefined
    if (at && control) {
      const there = await control.tab(at.window, at.tab).catch(() => undefined)
      if (there) {
        await control.focusTab(at.window, at.tab)
        return null
      }
    }
    if (!this.services.showBrowser) throw new RpcFailure(RpcErrorCode.Unavailable, t`Opening your browser needs the owlit desktop app.`)
    await this.services.showBrowser()
    return null
  }

  private runFromBrowser() {
    const task = this.scheduler!.enqueue(FROM_BROWSER, "browser", "asked")
    if (task.state === "waiting_for_you") this.scheduler!.resume(task.id)
    // A run that is just ending may not see papers added now: once it has ended, another takes them
    else if (task.state === "running") {
      void this.scheduler!.wait(task.id).then(() => {
        if (this.browserQueue.length && !this.browserRunning) this.runFromBrowser()
      })
    }
  }

  // Where the user's browser goes for this paper (its PDF, or its article page), through the library's
  // proxy when there is one; only for a paper owlit looked for and didn't get
  private async addressFor(id: string, record: PaperRecord): Promise<YourBrowser | undefined> {
    if (!record.ids.doi) return undefined
    const acquisition = await readAcquisition(this.root, id)
    if (acquisition?.result !== "no_pdf") return undefined
    return yourBrowser(record.ids.doi, acquisition.needs?.host, (await this.services.settings()).proxy)
  }

  // The queued paper to open next: one put back to be tried again first, then one whose PDF the browser
  // saves by itself before any article page, which waits on the user. Papers that got a PDF meanwhile
  // leave the queue.
  private async nextFromBrowser(again: string | undefined) {
    let page: { id: string; record: PaperRecord; address: YourBrowser } | undefined
    const order = again && this.browserQueue.includes(again) ? [again, ...this.browserQueue.filter((id) => id !== again)] : [...this.browserQueue]
    for (const id of order) {
      const record = await readRecord(this.root, id)
      const address = record && !(await hasPdfFile(this.root, id)) ? await this.addressFor(id, record) : undefined
      if (!record || !address) {
        this.browserQueue.splice(this.browserQueue.indexOf(id), 1)
        this.fromBrowser.delete(id)
        continue
      }
      if (address.opens === "pdf" || id === again) return { id, record, address }
      page ??= { id, record, address }
    }
    return page
  }

  // Opens each queued paper in the user's browser, one at a time and a while apart. Where the browser can
  // be driven, a run has a window of its own, and every paper opens in it behind whatever is in front;
  // elsewhere it is opened as any link is, in the background. A PDF the browser saves by itself is waited
  // for until it lands in Downloads, and its tab closed if a check page is left in it. An article page is
  // left open for the user to save the PDF from, and Downloads is watched for it a while. A PDF that
  // doesn't come is told by where its tab ended (where-it-ended.ts).
  private fromBrowserTask(open: NonNullable<LibraryServices["openExternal"]>) {
    return defineTask(FROM_BROWSER, {
      // Not the browser lane: owlit's own hidden browser shouldn't hold up what the user just asked for
      lane: "network",
      retries: 0,
      run: async (ctx) => {
        const watch = this.watchDownloads()
        if (!watch) return
        this.browserRunning = true
        this.browserLabel = await this.services.browserName?.().catch(() => undefined)
        const browser = this.browserLabel
        let control = await this.services.browserControl?.().catch(() => undefined)
        let window: string | undefined
        let done = 0
        let current: string | undefined
        let again: string | undefined
        let limitUntil = 0
        // Whether the kept run has been read: closing before then leaves it as it was
        let restored = false
        // The run's progress note, as JSON, for the line that sums it up once it has ended
        const tally: Tally = { browser: this.browserLabel, got: [], noAccess: [], pages: [], missed: [] }
        // The queue and the tally, kept on disk as the run goes. Closing owlit stops the run without ending
        // its task, and the next start runs that task again: it picks up the papers it hadn't finished
        // with and goes on adding to the same tally, where a queue in memory alone would end "0 of 0" and
        // wipe it. The user's Stop ends the run, and the file goes.
        const runFile = path.join(this.dataDir, "browser-run.json")
        let saving = Promise.resolve()
        const keep = () => {
          const run: KeptRun = { task: ctx.task.id, left: [...(current ? [current] : []), ...this.browserQueue], done, tally: structuredClone(tally) }
          saving = saving.then(() => writeJsonAtomic(runFile, run)).catch((error) => console.error("[core] couldn't keep the browser run", error))
        }
        const report = () => {
          ctx.progress(done, done + this.browserQueue.length, JSON.stringify(tally))
          keep()
        }
        // Per site in this run: whether it gave a PDF, how many of its papers didn't come, and whether the
        // run already stopped for a page owlit couldn't read there
        const gave = new Set<string>()
        const missed = new Map<string, number>()
        const puzzled = new Set<string>()
        // Papers tried again after the run stopped for them, once each
        const retried = new Set<string>()

        // Opens the address in the run's window, or as a link where the browser can't be driven
        const openIt = async (id: string, url: string) => {
          if (control) {
            try {
              window ??= await control.openWindow()
              let tab = await control.openTab(window, url)
              // The user closed the run's window: another one
              if (!tab) {
                window = await control.openWindow()
                tab = await control.openTab(window, url)
              }
              if (tab) {
                this.browserTabs.set(id, { window, tab })
                return { window, tab }
              }
            } catch (error) {
              // Not allowed to control it (or it won't answer): links from here on
              console.error("[core] couldn't drive the browser", error)
              control = undefined
            }
          }
          await open(url, { background: true })
          return undefined
        }
        // Where the paper's tab is now: undefined without a tab to read, gone when it closed itself (it
        // started a download, which hasn't landed)
        const endedAt = async (id: string, at: { window: string; tab: string } | undefined, address: YourBrowser): Promise<{ ended: Ended | "gone"; title: string; host: string } | undefined> => {
          if (!at || !control) return undefined
          const there = await control.tab(at.window, at.tab).catch(() => undefined)
          if (!there) return { ended: "gone", title: "", host: "" }
          void this.publishers.log({ paper: id, kind: "ended", url: there.url, title: there.title })
          return { ended: whereItEnded(there, { address: address.address, proxy: address.proxy, page: address.opens === "page" }), title: there.title, host: hostOf(there.url) }
        }
        // Stops the run on this paper until the user says go on; whether to try it again then. The run
        // stops only for what the user can do something about: a sign-in, a check, a page still at the
        // PDF (Safari's question about downloads), or a page owlit can't read, once per site. A publisher
        // or library that said no is noted on the paper (acquisition.json) and the run goes on; the
        // proxy's limit is waited out. Without a tab to read, a site whose first two PDFs don't come
        // stops the run.
        const stopFor = async (id: string, why: NonNullable<FromBrowser["why"]>, page: { title: string; host: string }) => {
          this.fromBrowser.set(id, { state: "waiting", why, page: { title: page.title, host: page.host } })
          await this.announce([id])
          report()
          const title = page.title || page.host
          const host = page.host
          const name = browser ?? ""
          const named = {
            "sign-in": () => t`Sign in to your library in ${name}, then continue.`,
            check: () => t`${name} is showing a check. Pass it there, then continue.`,
            "on-pdf": () => t`${name} is on “${title}” and saved nothing. Answer it there, then continue.`,
            unknown: () => t`${name} is on “${title}” (${host}). Look there, then continue.`,
          }
          const unnamed = {
            "sign-in": () => t`Sign in to your library in your browser, then continue.`,
            check: () => t`Your browser is showing a check. Pass it there, then continue.`,
            "on-pdf": () => t`Your browser is on “${title}” and saved nothing. Answer it there, then continue.`,
            unknown: () => t`Your browser is on “${title}” (${host}). Look there, then continue.`,
          }
          await ctx.waitForUser("browser", (browser ? named : unnamed)[why]())
          // The page may have gone on to the PDF once the user was through
          await sleep(1000, ctx.signal)
          if (await hasPdfFile(this.root, id)) return false
          return (why === "sign-in" || why === "check" || why === "on-pdf") && !retried.has(id)
        }

        try {
          // This task, started again after owlit closed in the middle of it: the papers it hadn't finished
          // with go first (the one it had opened among them), unless a PDF came for one meanwhile (taken from
          // Downloads at start)
          await this.resumed
          const kept = await readJson<KeptRun>(runFile).catch(() => undefined)
          if (kept?.task === ctx.task.id) {
            for (const list of ["got", "noAccess", "pages", "missed"] as const) tally[list] = [...kept.tally[list]]
            done = kept.done
            const counted = new Set([...tally.got, ...tally.noAccess, ...tally.pages, ...tally.missed])
            const back: string[] = []
            for (const id of new Set(kept.left)) {
              if (counted.has(id) || this.browserQueue.includes(id)) continue
              if (await hasPdfFile(this.root, id)) {
                tally.got.push(id)
                done++
              } else back.push(id)
            }
            this.browserQueue.unshift(...back)
            for (const id of back) this.fromBrowser.set(id, { state: "queued" })
            if (back.length) await this.announce(back)
          }
          restored = true
          for (;;) {
            const next = await this.nextFromBrowser(again)
            again = undefined
            if (!next) break
            const { id, record, address } = next
            report()
            current = id
            this.browserQueue.splice(this.browserQueue.indexOf(id), 1)
            const proxied = !!address.proxy
            await sleep(Math.max(0, this.browserOpenedAt + openGap(proxied) - Date.now(), proxied ? limitUntil - Date.now() : 0), ctx.signal)
            watch.watch({ id, doi: record.ids.doi, title: record.title })
            await this.noteSent(id, address.opens === "page")

            if (address.opens === "page") {
              this.fromBrowser.set(id, { state: "page" })
              await this.announce([id])
              this.browserOpenedAt = Date.now()
              const at = await openIt(id, address.url)
              // Where it landed, a moment later: a sign-in or a check is the user's to pass first
              let look = at ? await sleep(pageLook(), ctx.signal).then(() => endedAt(id, at, address)) : undefined
              // A check that passes by itself isn't the user's: the page it goes on to is
              const checkUntil = Date.now() + checkWait()
              while (look?.ended === "check" && Date.now() < checkUntil) {
                await sleep(Math.min(CHECK_LOOK_MS, Math.max(0, checkUntil - Date.now())), ctx.signal)
                look = await endedAt(id, at, address)
              }
              if (look?.ended === "limit" && !retried.has(id)) {
                retried.add(id)
                limitUntil = Date.now() + limitWait()
                this.browserQueue.unshift(id)
                again = id
                continue
              }
              // The proxy said the library hasn't got it: nothing to save there
              if (look?.ended === "refused") {
                await this.saidNo(id, "refused", look)
                this.fromBrowser.delete(id)
                tally.noAccess.push(id)
                done++
                await this.announce([id])
                continue
              }
              if (look && (look.ended === "sign-in" || look.ended === "check")) {
                await stopFor(id, look.ended, look)
                this.fromBrowser.set(id, { state: "page" })
                await this.announce([id])
              }
              tally.pages.push(id)
              done++
              continue
            }

            const arrived = new Promise<void>((resolve) => this.arrivals.set(id, resolve))
            this.fromBrowser.set(id, { state: "opened" })
            await this.announce([id])
            this.browserOpenedAt = Date.now()
            const at = await openIt(id, address.url)
            const came = await this.arrival(arrived, ctx.signal)
            this.arrivals.delete(id)
            if (came) {
              this.fromBrowser.delete(id)
              gave.add(address.site)
              tally.got.push(id)
              done++
              // A check page the download left behind
              if (at && control && (await control.tab(at.window, at.tab).catch(() => undefined))) await control.closeTab(at.window, at.tab).catch(() => undefined)
              continue
            }

            const look = await endedAt(id, at, address)
            if (look?.ended === "no-access" || look?.ended === "refused" || look?.ended === "missing") {
              await this.saidNo(id, look.ended, look)
              this.fromBrowser.delete(id)
              // A page the publisher hasn't got isn't a matter of access: counted with what didn't come
              ;(look.ended === "missing" ? tally.missed : tally.noAccess).push(id)
              done++
              await this.announce([id])
              continue
            }
            if (look?.ended === "limit" && !retried.has(id)) {
              retried.add(id)
              limitUntil = Date.now() + limitWait()
              this.browserQueue.unshift(id)
              again = id
              continue
            }
            if (look && look.ended !== "limit" && look.ended !== "gone" && look.ended !== "landed" && !(look.ended === "unknown" && puzzled.has(address.site))) {
              if (look.ended === "unknown") puzzled.add(address.site)
              if (await stopFor(id, look.ended, look)) {
                retried.add(id)
                this.fromBrowser.set(id, { state: "queued" })
                this.browserQueue.unshift(id)
                again = id
                continue
              }
              if (await hasPdfFile(this.root, id)) {
                this.fromBrowser.delete(id)
                tally.got.push(id)
              } else {
                this.fromBrowser.set(id, { state: "missed" })
                await this.saidNo(id, "missed")
                tally.missed.push(id)
              }
              done++
              await this.announce([id])
              continue
            }

            // Nothing to read (the browser can't be driven, or the tab closed itself), or read twice to no end
            this.fromBrowser.set(id, { state: "missed" })
            await this.saidNo(id, "missed")
            tally.missed.push(id)
            done++
            await this.announce([id])
            const misses = (missed.get(address.site) ?? 0) + 1
            missed.set(address.site, misses)
            if (!at && !gave.has(address.site) && misses >= 2 && this.browserQueue.length) {
              report()
              const site = address.site
              const name = browser ?? ""
              await ctx.waitForUser(
                "browser",
                browser
                  ? t`${name} may be asking you something: a check, a sign-in, or whether ${site} may download files.`
                  : t`Your browser may be asking you something: a check, a sign-in, or whether ${site} may download files.`,
              )
              missed.set(address.site, 0)
            }
          }
          report()
        } finally {
          // Closing owlit rather than the user's Stop (which ends the task): kept for the next start
          const closing = ctx.signal.aborted && !isTaskFinished(this.scheduler!.get(ctx.task.id) ?? ctx.task)
          if (closing) {
            if (restored) keep()
          } else saving = saving.then(() => rm(runFile, { force: true })).catch((error) => console.error("[core] couldn't clear the browser run", error))
          await saving
          this.browserRunning = false
          // Stopped: the papers that hadn't had their turn are as they were before (the one opened last
          // is still looked for in Downloads a while)
          const left = this.browserQueue.splice(0)
          const state = current ? this.fromBrowser.get(current)?.state : undefined
          if (current && (state === "opened" || state === "waiting" || state === "queued")) left.push(current)
          for (const id of left) if (this.fromBrowser.get(id)?.state !== "missed") this.fromBrowser.delete(id)
          for (const id of left) this.arrivals.delete(id)
          if (left.length) void this.announce(left)
        }
      },
    })
  }

  // Open copies of a paper known only by its title (no DOI), from arXiv, Semantic Scholar and OpenAlex:
  // only a record with the very same title, and the same first author's surname when both name one.
  // What comes is checked against the title on its pages before it is kept (Route.checkTitle).
  private async copiesByTitle(record: PaperRecord, http: Http, signal: AbortSignal): Promise<Route[]> {
    if (!sameTitle(record.title, record.title)) return []
    const settings = await this.services.settings()
    const surname = (name?: string) => name?.trim().split(/\s+/).at(-1)?.toLowerCase()
    const routes: Route[] = []
    const seen = new Set<string>()
    for (const source of ["arxiv", "s2", "openalex"] as const) {
      const found = await searchSource(http, record.title, 3, source, {}, settings, { retries: 1, signal }).catch((error) => {
        if (signal.aborted) throw error
        return { records: [] }
      })
      for (const hit of found.records) {
        if (!hit.title || !sameTitle(hit.title, record.title)) continue
        const theirs = surname(hit.authors?.[0])
        const ours = surname(record.authors[0])
        if (theirs && ours && theirs !== ours) continue
        const urls = [...(hit.ids.arxiv ? [`https://arxiv.org/pdf/${hit.ids.arxiv}`] : []), ...(hit.pdfUrls ?? [])]
        for (const url of urls) {
          if (seen.has(url)) continue
          seen.add(url)
          routes.push({ kind: "upstream", name: `title:${source}`, url, checkTitle: true })
        }
      }
      if (routes.length) break
    }
    return routes
  }

  // When the user's browser was sent for the paper, so a PDF saved after a restart is still found
  private async noteSent(id: string, page: boolean) {
    await this.serial.run(async () => {
      const acquisition = await readAcquisition(this.root, id)
      if (acquisition?.result !== "no_pdf") return
      await writeAcquisition(this.root, id, { ...acquisition, sentToBrowser: { at: Date.now(), page } })
    })
  }

  // Papers the user's browser was sent for before this start whose PDF hasn't come. The Downloads watch
  // lived only while owlit ran: a restart (or a quit) in the 15 minutes after a run opened an article
  // page lost the PDFs saved from it. A PDF saved to Downloads since a
  // paper was sent that is surely that paper's is taken now; ones still within their time are watched
  // again, an article page among them counted as open again. An unsure file is left: nobody is there to
  // be asked about it.
  private async resumeDownloads() {
    const dir = this.services.downloadsDir?.()
    if (!dir) return
    const now = Date.now()
    const sent: { id: string; doi?: string; title: string; at: number; page: boolean }[] = []
    for (const id of await this.ids()) {
      const acquisition = await readAcquisition(this.root, id)
      const was = acquisition?.sentToBrowser
      if (acquisition?.result !== "no_pdf" || !was || now - was.at > RESUME_MS || (await hasPdfFile(this.root, id))) continue
      const record = await readRecord(this.root, id)
      if (record) sent.push({ id, doi: record.ids.doi, title: record.title, at: was.at, page: was.page })
    }
    if (!sent.length) return
    const since = Math.min(...sent.map((p) => p.at))
    const taken = new Set<string>()
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!/\.pdf$/i.test(name)) continue
      const file = path.join(dir, name)
      const info = await stat(file).catch(() => undefined)
      if (!info?.isFile() || info.mtimeMs < since) continue
      const left = sent.filter((p) => p.at <= info.mtimeMs && !taken.has(p.id))
      if (!left.length) continue
      const match = await whoseDownload(file, left, (f) => this.lookAtPdf(f)).catch(() => undefined)
      if (!match?.sure) continue
      taken.add(match.id)
      await this.downloadFound(match.id, file, true)
    }
    const again = sent.filter((p) => !taken.has(p.id) && p.at + WATCH_MS > now)
    const watch = again.length ? this.watchDownloads() : undefined
    for (const p of again) {
      watch?.watch(p, p.at + WATCH_MS)
      if (p.page && !this.fromBrowser.has(p.id)) this.fromBrowser.set(p.id, { state: "page" })
    }
    if (again.length) await this.announce(again.map((p) => p.id))
  }

  // The user's browser reached the publisher and was told no, or nothing came of sending it there: kept
  // on the paper until a PDF comes or it is sent there again
  private async saidNo(id: string, ended: "no-access" | "refused" | "missing" | "missed", page: { title: string; host: string } = { title: "", host: "" }) {
    await this.serial.run(async () => {
      const acquisition = await readAcquisition(this.root, id)
      if (acquisition?.result !== "no_pdf") return
      await writeAcquisition(this.root, id, {
        ...acquisition,
        yourBrowser: { outcome: ended, at: Date.now(), ...(page.host ? { host: page.host } : {}), ...(page.title ? { title: page.title } : {}) },
      })
    })
  }

  // Whether the PDF the user's browser was sent to came (any PDF placed for the paper counts, the user's
  // own drop too). A download still being written gets longer.
  private async arrival(arrived: Promise<void>, signal: AbortSignal) {
    const start = Date.now()
    let deadline = start + arrivalWait()
    for (;;) {
      const came = await Promise.race([arrived.then(() => true), sleep(Math.max(0, deadline - Date.now()), signal).then(() => false)])
      if (came) return true
      if (!this.downloadWatch?.busy(5_000) || Date.now() - start >= ARRIVAL_MAX_MS) return false
      deadline = Math.min(Date.now() + 10_000, start + ARRIVAL_MAX_MS)
    }
  }

  // The user's answer about a downloaded PDF owlit wasn't sure of: take it as the paper's, or keep looking
  async takeDownload(id: string, take: boolean): Promise<Paper> {
    const file = this.offered.get(id)
    this.offered.delete(id)
    if (take && file) {
      this.downloadWatch?.stop(id)
      return this.attachPdf(id, file, "your-browser")
    }
    const paper = await this.get(id)
    if (!paper) throw notFound(id)
    return paper
  }

  private async lookAtPdf(file: string) {
    const bytes = await readFile(file)
    if (!isPdfBytes(bytes)) return undefined
    const { text, meta } = await readPdf(bytes, { wasmPath: this.services.pdfiumWasm, maxPages: 2 }).catch(() => ({ text: undefined, meta: {} }))
    if (!text) return undefined
    const found = identify(text, meta)
    const words = text.pages.flatMap((p) => p.blocks.flatMap((b) => b.lines.map((l) => l.text))).join(" ")
    return { doi: found.ref?.kind === "doi" ? found.ref.value : undefined, text: words }
  }

  private async downloadFound(id: string, file: string, sure: boolean) {
    if (await hasPdfFile(this.root, id)) return this.downloadWatch?.stop(id)
    if (sure) await this.attachPdf(id, file, "your-browser").catch((error) => console.error("[core] couldn't take a downloaded PDF", error))
    else this.offered.set(id, file)
    await this.announce([id])
  }

  // The paper whose PDF is this very file (the same bytes), if the library has one; reads nothing else
  async paperOfFile(file: string): Promise<string | undefined> {
    const sha = await sha256Of(file)
    return this.serial.run(() => this.paperWithPdf(sha))
  }

  // A PDF dropped on the library: which paper it is (arXiv's stamp, a DOI on its first pages), added
  // with its metadata when the services know it, or kept as local-<hash> with a title guessed from the
  // file. The same file dropped again is the paper it already is.
  // Reading and looking up happen outside the write queue, so a slow service never holds up a star or a
  // note; only placing the paper is queued.
  async importPdf(file: string, options: { priority?: TaskPriority; tags?: string[]; imported?: { parse: boolean } } = {}): Promise<{ paper: Paper; existed: boolean }> {
    const priority = options.priority ?? "asked"
    await assertPdf(file)
    const sha = await sha256Of(file)
    const same = await this.serial.run(() => this.paperWithPdf(sha))
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
    return this.serial.run(async () => {
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
      await writeState(this.root, id, { ...freshState("user"), ...(options.tags?.length ? { tags: options.tags } : {}) })
      if (options.imported) this.imports.note(id, options.imported)
      this.index.set(id, record.ids, record.title)
      // An id the services couldn't be asked about (offline) gets its metadata later
      if ((!resolution && found.ref) || (resolution && !fullyChecked(resolution))) this.queue("paper.metadata", id, priority)
      await this.placePdf(id, file, sha, priority)
      if (!options.imported) this.services.landed?.(id, "user")
      return { paper: (await this.get(id))!, existed: false }
    })
  }

  // The file becomes the paper's PDF, and the steps that read it follow
  private async placePdf(id: string, file: string, sha: string, priority: TaskPriority = "asked", route: PlacedBy = "dropped") {
    // A download or a publisher's page still looking must not replace the user's file when it lands,
    // nor a reading of the old file come back over the new one's
    for (const t of this.scheduler?.list() ?? []) {
      if (t.subject === id && !isTaskFinished(t) && PDF_STEPS.includes(t.kind)) this.scheduler!.cancel(t.id)
    }
    // Not looked for in Downloads any more, and nothing there to confirm
    this.downloadWatch?.stop(id)
    this.offered.delete(id)
    const dest = pdfFile(this.root, id)
    // Its own temporary name: a cancelled download may still be cleaning up its .part
    const part = `${dest}.${process.pid}-${Date.now()}.part`
    await copyFile(file, part)
    await rename(part, dest)
    // What was read from the file it replaces goes, so the new one is read (and MinerU reads it again)
    const dir = paperDir(this.root, id)
    await Promise.all(["text.json", "text.md", "text.pdfium.json", "parse.json"].map((name) => rm(path.join(dir, name), { force: true })))
    await removeFigures(this.root, id)
    const previous = await readAcquisition(this.root, id)
    await writeAcquisition(this.root, id, {
      version: 1,
      result: "ok",
      route,
      tried: [...(previous?.tried ?? []), { route, url: file, at: Date.now() }],
      at: Date.now(),
      dropHere: dest,
      sha256: sha,
    })
    this.pdfHashes?.set(sha, id)
    this.queueText(id, priority)
    this.arrivals.get(id)?.()
    // Saved from a page owlit opened, or after it didn't come: nothing left to wait for
    const state = this.fromBrowser.get(id)?.state
    if (state === "page" || state === "missed") this.fromBrowser.delete(id)
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
  // in an older build): its text, read now, in the background; and its details looked up again when
  // they predate the current round of checks (METADATA_CHECKS)
  private async catchUp() {
    for (const id of await this.ids()) {
      if ((await hasPdfFile(this.root, id)) && !(await hasText(this.root, id))) this.queue("paper.text", id, "background")
      // Only details the services gave: a record written some other way (by hand, by another program)
      // is left as its author wrote it
      const record = await readRecord(this.root, id)
      if (record?.fetchedAt && (record.checked ?? 0) < METADATA_CHECKS && refOfIds(record.ids)) this.queue("paper.metadata", id, "background")
    }
  }

  // Papers left without a PDF get another try once a day: open copies appear over time
  private async retryMissingDaily() {
    const file = path.join(this.dataDir, "library.json")
    const today = new Date().toISOString().slice(0, 10)
    const kept = (await readJson<{ missingRetriedOn?: string }>(file).catch(() => undefined)) ?? {}
    if (kept.missingRetriedOn === today) return
    await writeJsonAtomic(file, { ...kept, missingRetriedOn: today })
    const now = Date.now()
    for (const id of await this.ids()) {
      const acquisition = await readAcquisition(this.root, id)
      if (acquisition?.result !== "no_pdf" || !lookAgain(acquisition, now) || (await hasPdfFile(this.root, id))) continue
      this.queue("paper.pdf", id, "background")
    }
  }

  // Citation counts over a month old counted again (citations.ts), once a day at most, quietly: a count is
  // the service's fact, not something Owlit wrote, so nothing marks it. A day the services can't be
  // reached is tried again on the next open.
  private async recountCitationsDaily() {
    const file = path.join(this.dataDir, "library.json")
    const today = new Date().toISOString().slice(0, 10)
    if ((await readJson<{ citationsCountedOn?: string }>(file).catch(() => undefined))?.citationsCountedOn === today) return
    const now = Date.now()
    const due: { id: string; ids: PaperIds }[] = []
    for (const id of await this.ids()) {
      const record = await readRecord(this.root, id)
      if (record && citationsDue(record, now)) due.push({ id, ids: record.ids })
    }
    const counted = due.length ? await countCitations(this.services.http, due, await this.services.settings(), { retries: 1 }) : new Map()
    const changed = await this.serial.run(async () => {
      const changed: string[] = []
      for (const { id } of due) {
        const found = counted.get(id)
        const current = await readRecord(this.root, id)
        if (!found || !current) continue
        const same = current.citationCount === found.count && current.fields.citationCount === found.source
        await writeRecord(this.root, { ...current, citationCount: found.count, citationsAt: now, fields: { ...current.fields, citationCount: found.source } })
        if (!same) changed.push(id)
      }
      return changed
    })
    // Written after the counts, so a day they couldn't be had is tried again on the next open
    const kept = (await readJson<Record<string, unknown>>(file).catch(() => undefined)) ?? {}
    await writeJsonAtomic(file, { ...kept, citationsCountedOn: today })
    if (changed.length) await this.announce(changed)
  }

  // ---- Hearing about changes

  // Changes core makes on its own and changes other programs make under library/papers/
  async watch(onChange: (change: LibraryChange) => void, onNote?: (paperId: string, note: PaperNote | null, before: string) => void) {
    this.onChange = onChange
    if (onNote) this.onNote = onNote
    void this.retryMissingDaily().catch((error) => console.error("[core] couldn't retry missing PDFs", error))
    void this.recountCitationsDaily().catch((error) => console.error("[core] couldn't count citations", error))
    // Before any paper is read: imported papers skip the digest and maybe MinerU
    await this.imports.load().catch((error) => console.error("[core] couldn't read the imports", error))
    void this.catchUp().catch((error) => console.error("[core] couldn't catch up on the library", error))
    this.resumed = this.resumeDownloads().catch((error) => console.error("[core] couldn't look in Downloads", error))
    // A library that can't be read yet still opens; lookups just find less
    await this.index.load().catch((error) => console.error("[core] couldn't read the library", error))
    if (this.watcher) return
    const prefix = PAPERS_DIR.split(path.sep).join("/") + "/"
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      const rel = filename ? filename.split(path.sep).join("/") : ""
      // A paper's note, changed by an agent that writes the disk itself or by another program. It sits in
      // the paper's folder, so it is taken before the folder's other files: a note write is news for the
      // note alone, not a change of the paper. owlit's own save lands as note.md.<hex>.tmp first
      // (writeFileAtomic), which counts as the note too, or every keystroke saved would re-announce the paper
      const noteOf = this.noteOf(rel.replace(ATOMIC_TEMP, ""))
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
      // A digest by a background agent session, from the paper's full text
      ...(this.services.agent ? [this.digestTask(this.services.agent)] : []),
      ...this.imports.tasks(),
      this.figuresTask(),
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
            let result
            if (settings.service === "self-hosted") {
              result = await parseSelfHosted(this.services.http, settings, `${id}.pdf`, bytes, ctx.signal)
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
              result = await awaitCloud(this.services.http, settings, batchId, { signal: ctx.signal, onProgress: (done, total) => ctx.progress(done, total) })
            }
            const text = contentListToText(result.blocks, await pageSizes(bytes, this.services.pdfiumWasm))
            // Cancelled meanwhile (the PDF was replaced): this reading is of the old file
            ctx.signal.throwIfAborted()
            const dir = paperDir(this.root, id)
            const previous = await readText(this.root, id)
            if (previous?.source === "pdfium") await writeJsonAtomic(path.join(dir, "text.pdfium.json"), previous, { parents: false })
            await writeText(this.root, id, text)
            await writeJsonAtomic(path.join(dir, "parse.json"), { version: 1, status: "done", service: settings.service, at: Date.now(), ...(job ? { job } : {}) }, { parents: false })
            // The figures come with the reading; they are a bonus, so failing them fails nothing
            try {
              if (result.layout) await writeFiguresFromLayout(this.root, id, result.layout, result.images, bytes, this.services.pdfiumWasm, ctx.signal)
              else await writeFiguresFromText(this.root, id, text, bytes, this.services.pdfiumWasm, ctx.signal)
            } catch (error) {
              if (ctx.signal.aborted) throw error
              await noFigures(this.root, id, messageOf(error))
            }
            this.queue("index.paper", id, "background")
            await this.announce([id])
          } catch (error) {
            if (ctx.signal.aborted) throw error
            const message = messageOf(error)
            await writeJsonAtomic(path.join(paperDir(this.root, id), "parse.json"), { version: 1, status: "failed", error: message, attempts: ctx.task.attempts, at: Date.now() }, { parents: false })
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
            throw new TaskFailure(messageOf(error))
          }
          const summary = { added: 0, skipped: 0, failed: [] as string[] }
          const added: string[] = []
          for (const [i, paper] of papers.entries()) {
            ctx.signal.throwIfAborted()
            ctx.progress(i, papers.length, paper.id)
            try {
              const placed = await this.serial.run(async () => {
                if (await readRecord(this.root, paper.id)) return false
                const brought = await importPittaPaper(this.root, paper)
                const record = (await readRecord(this.root, paper.id))!
                if (await this.index.find(record.ids).then((other) => other && other !== paper.id)) {
                  // Known under another id: keep the one the library has
                  await rm(paperDir(this.root, paper.id), { recursive: true, force: true })
                  return false
                }
                await writeState(this.root, paper.id, freshState("user", record.fetchedAt ?? Date.now()))
                this.index.set(paper.id, record.ids, record.title)
                if (brought.pdf) this.queue("paper.text", paper.id, "background")
                return true
              })
              if (placed) {
                summary.added++
                added.push(paper.id)
              } else summary.skipped++
            } catch (error) {
              summary.failed.push(`${paper.id}: ${messageOf(error)}`)
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
          // Moved to a DOI or trashed while it was read: nothing is written, or queued, for the old id
          ctx.signal.throwIfAborted()
          await writeText(this.root, id, text, { markdown: !legacy })
          this.queue("index.paper", id, "background")
          // An imported paper gets no digest of its own accord, and MinerU only if the import allowed it
          const imported = this.imports.imported(id)
          if (!imported && (await this.services.settings()).digestEveryPaper) void this.wantDigest(id, "background")
          // A scan has no text at all until MinerU reads it. pitta's text.md is MinerU's already.
          if (!legacy && imported?.parse !== false) this.queue("paper.parse", id, text.needsOcr ? "asked" : "background")
        },
      }),
      // Tries each route for the paper's PDF until one gives a real PDF. Every route failing is a fact
      // (acquisition.json, result no_pdf); only a machine with no network at all tries again later.
      defineTask("paper.pdf", {
        lane: "network",
        run: async (ctx) => {
          const id = ctx.task.subject
          let record = await readRecord(this.root, id)
          if (!record) throw new TaskFailure(`${id} is not in the library.`)
          if (await hasPdfFile(this.root, id)) return
          // One of ACL's older papers, kept before owlit read Semantic Scholar's Anthology id: asked about
          // again, so the Anthology is tried before the ACM, which lists these papers without their PDFs
          if (record.ids.doi?.startsWith("10.3115/") && !record.ids.acl) {
            try {
              await this.refreshRecord(id, ctx.signal, true)
            } catch (error) {
              if (ctx.signal.aborted) throw error
            }
            // Folded into a copy of it meanwhile: that paper is the one to get a PDF for
            record = await readRecord(this.root, id)
            if (!record) return
          }
          const { http, heard } = watchedHttp(this.services.http)
          const settings = await this.services.settings()
          const tried: Attempt[] = []
          const routes = routesFor(record, {
            landing: (doi) => landingOf(http, doi, ctx.signal),
            unpaywall: (doi) => unpaywallRoutes(http, doi, settings.contactEmail, ctx.signal),
            keys: { elsevierApiKey: settings.elsevierApiKey, wileyTdmToken: settings.wileyTdmToken },
          })
          const dest = pdfFile(this.root, id)
          // A repository's page that came instead of its PDF may name the PDF: tried next, once
          const pages: Route[] = []
          const iterator = routes[Symbol.asyncIterator]()
          // A paper without a DOI has only the links it came with: once they fail, open copies of a paper
          // with its very title are looked for (copiesByTitle)
          let byTitle = !record.ids.doi
          const next = async (): Promise<Route | undefined> => {
            const route = pages.shift() ?? ((await iterator.next()).value as Route | undefined)
            if (route || !byTitle) return route
            byTitle = false
            pages.push(...(await this.copiesByTitle(record!, http, ctx.signal)))
            return pages.shift()
          }
          for (let route = await next(); route; route = await next()) {
            ctx.progress(tried.length, undefined, route.name)
            // A site that answers plain downloads with a check is left to the browser for a while:
            // asking again only counts against this network
            const site = siteOf(hostOf(route.url))
            if (route.kind !== "api" && (await this.publishers.plainRefused(site))) {
              tried.push({ route: route.name, url: route.url, error: `Not tried: ${site} only lets browsers in.`, at: Date.now() })
              continue
            }
            try {
              await downloadPdf(http, route.url, dest, ctx.signal, route.headers)
              await route.verify?.(dest, this.services.pdfiumWasm)
              // A PDF owlit didn't pick by its address must be the paper: a repository's page can name
              // another paper's file, or its logo
              if (route.checkTitle && isThisPaper(await this.lookAtPdf(dest), { doi: record.ids.doi, title: record.title }) === "no") {
                await rm(dest, { force: true })
                throw new NotAPdf(`${hostOf(route.url)} gave the PDF of another paper.`)
              }
            } catch (error) {
              if (ctx.signal.aborted) throw error
              if (error instanceof NotAPdf && error.page && (route.kind === "upstream" || route.kind === "unpaywall") && !route.checkTitle) {
                const named = await pdfNamedOnPage(http, error.page, ctx.signal)
                if (named && named !== route.url) pages.push({ kind: route.kind, name: `${route.name}:page`, url: named, checkTitle: true })
              }
              // Held against the site that put up the check, not where the route starts: a doi.org
              // link that lands on dl.acm.org says nothing about doi.org
              if (error instanceof HttpError && error.challenged) {
                const host = hostOf(error.finalUrl)
                await this.publishers.refusePlain(siteOf(host))
                void this.publishers.log({ paper: id, route: route.name, kind: "plain-refused", host, status: error.status })
              }
              tried.push({ route: route.name, url: route.url, ...describeFailure(error), at: Date.now() })
              continue
            }
            tried.push({ route: route.name, url: route.url, status: 200, at: Date.now() })
            // Under the library's lock, like a no_pdf verdict and a drop: see noPdf()
            await this.serial.run(async () => {
              ctx.signal.throwIfAborted()
              const sha256 = await sha256Of(dest)
              this.pdfHashes?.set(sha256, id)
              await writeAcquisition(this.root, id, { version: 1, result: "ok", route: route.name, tried, at: Date.now(), dropHere: dest, sha256 })
            })
            this.queueText(id, ctx.task.priority)
            await this.announce([id])
            return
          }
          if (record.ids.doi && !settings.contactEmail) {
            tried.push({ route: "unpaywall", url: "", error: "Not tried: Unpaywall needs a contact email in settings.", at: Date.now() })
          }
          // No server answered at all (doi.org, Unpaywall, the routes): the machine is offline, which
          // passes. One dead host among ones that answered is just a route that failed.
          if (heard.asked && !heard.answered) throw new HttpError(0, tried[0]?.url ?? "", t`Couldn't reach any source of PDFs.`)
          let before: Acquisition | undefined
          const noted = await this.noPdf(id, ctx.signal, (previous) => {
            before = previous
            return {
              version: 1,
              result: "no_pdf",
              tried,
              at: Date.now(),
              dropHere: dest,
              looks: (previous?.result === "no_pdf" ? (previous.looks ?? 1) : 0) + 1,
              // A check the publisher wants stays noted until the browser looks again (queued below)
              ...(previous?.needs ? { needs: previous.needs } : {}),
            }
          })
          if (!noted) return
          // The publisher may still give it to a browser: cookies, a challenge, the library's proxy. Not on
          // owlit's own account once the publisher said no (to the user's browser, or to owlit's through
          // the library): only the user asking looks again there.
          const saidNo = !!before?.looked || (!!before?.yourBrowser && before.yourBrowser.outcome !== "missed")
          if (record.ids.doi && (ctx.task.priority !== "background" || !saidNo)) this.queue("paper.pdf.browser", id, ctx.task.priority)
          await this.announce([id])
        },
      }),
      // The publisher's page in the hidden browser, directly and then through the library's proxy, with
      // nobody looking
      ...(this.services.browser
        ? [this.browserTask(this.services.browser)]
        : []),
      // The user's own browser, for publishers that let only it in
      ...(this.services.openExternal ? [this.fromBrowserTask(this.services.openExternal)] : []),
      // Asks the services about a paper already in the library and rewrites its paper.json
      defineTask("paper.metadata", {
        lane: "network",
        run: async (ctx) => {
          try {
            await this.refreshRecord(ctx.task.subject, ctx.signal)
          } catch (error) {
            if (error instanceof NotAPaper) throw new TaskFailure(error.message)
            throw error
          }
        },
      }),
    ]
  }

  // The user's Refresh details: the services asked again now, whatever was looked up a moment ago
  async refresh(id: string, signal?: AbortSignal): Promise<Paper | null> {
    if (!(await readRecord(this.root, id))) throw notFound(id)
    try {
      await this.refreshRecord(id, signal ?? new AbortController().signal, true)
    } catch (error) {
      throw asRpcFailure(error)
    }
    // Folded into the paper it was a copy of: that one is the answer
    return (await this.get(id)) ?? (await this.get((await this.aliases())[id] ?? "")) ?? null
  }

  // ---- inside

  // Asks the services about a paper and rewrites its paper.json. A record that turns out to be a copy
  // of another paper in the library (the DOI it was found to have is that paper's, or the titles match
  // where one has no DOI) is folded into that paper when the user has done nothing with it.
  private async refreshRecord(id: string, signal: AbortSignal, fresh = false) {
    const record = await readRecord(this.root, id)
    if (!record) throw new TaskFailure(`${id} is not in the library.`)
    const ref = refOfIds(record.ids)
    // A file nobody has identified: there is nobody to ask
    if (!ref) return
    let resolution = fresh ? undefined : this.recent(id)
    if (!resolution || !fullyChecked(resolution)) resolution = await resolve(this.services.http, ref, await this.services.settings(), { signal })
    const found = resolution
    const twin = await this.serial.run(async () => {
      const current = await readRecord(this.root, id)
      if (!current) return undefined
      // Its DOI is another paper's: writing it here would give two papers one id
      const holder = found.ids.doi ? await this.index.find({ doi: found.ids.doi }) : undefined
      if (holder && holder !== id) return holder
      await keepSources(this.root, id, found.records)
      const next = recordFrom(id, found, current)
      await writeRecord(this.root, next)
      this.index.set(id, next.ids, next.title)
      return this.index.twin(next.title, next.ids, id)
    })
    if (twin) await this.fold(id, twin)
    await this.announce([id])
  }

  // Two records of one paper: the one without a DOI goes (to the trash, its id kept as an alias of the
  // other), unless the user has starred, tagged, marked, highlighted or written about it. Then both stay.
  private async fold(a: string, b: string) {
    await this.serial.run(async () => {
      const [ra, rb] = await Promise.all([readRecord(this.root, a), readRecord(this.root, b)])
      if (!ra || !rb) return
      const [copy, kept] = !ra.ids.doi && rb.ids.doi ? [a, b] : !rb.ids.doi && ra.ids.doi ? [b, a] : [a, b]
      if (await this.touched(copy)) {
        console.log(`[core] ${copy} looks like a copy of ${kept}, but the user has worked with it; both stay`)
        return
      }
      // The lookup that found the copy (paper.metadata, running) ends on its own
      await this.moveToTrash(copy, Date.now(), (task) => task.kind === "paper.metadata" && task.state === "running")
      const aliases = await this.aliases()
      for (const [from, to] of Object.entries(aliases)) if (to === copy) aliases[from] = kept
      aliases[copy] = kept
      await writeJsonAtomic(this.aliasFile(), { version: 1, aliases })
      const paper = await this.get(kept)
      this.onChange({ papers: paper ? [paper] : [], removed: [copy], renamed: { [copy]: kept } })
    })
  }

  // Whether the user has done anything with a paper beyond having it; an agent's own highlights don't count
  private async touched(id: string) {
    const state = await readState(this.root, id)
    if (state && (state.starred || state.tags.length || state.status !== "unread" || Object.keys(state.overrides ?? {}).length)) return true
    if ((await readHighlights(this.root, id)).some((h) => h.addedBy !== "agent")) return true
    return !!(await readNote(this.root, id))?.content.trim()
  }

  // Both halves of a paper to .owlit/trash/, where restore() finds them
  private async moveToTrash(id: string, stamp: number, spare?: (task: Task) => boolean) {
    this.scheduler?.cancelSubject(id, spare)
    // A paper already gone (undoing an agent's add after it took the paper back) leaves no entry: an empty
    // one would be the newest, so restore would take it and bring nothing back
    const present = await Promise.all([paperDir(this.root, id), paperStateDir(this.root, id)].map((dir) => stat(dir).then(() => true, () => false)))
    if (!present.includes(true)) {
      this.index.delete(id)
      return
    }
    const trash = this.trashDir(stamp, id)
    await mkdir(trash, { recursive: true })
    await rename(paperDir(this.root, id), path.join(trash, "paper")).catch(ignoreMissing)
    await rename(paperStateDir(this.root, id), path.join(trash, "state")).catch(ignoreMissing)
    this.index.delete(id)
  }

  // Notes that a run found no PDF, unless another route (the browser, a drop) placed one meanwhile:
  // its record stands. paper.pdf and paper.pdf.browser can run at once for a paper (the user asks
  // just after the automatic run), so the look and the write share the library's lock with the
  // writers of an ok record; otherwise a no_pdf could land last over a PDF that is there. Whether
  // it was noted. Not once the run is cancelled: the paper may have moved to a DOI or gone to the trash
  // while this run waited for the lock.
  private noPdf(id: string, signal: AbortSignal, acquisition: (previous: Acquisition | undefined) => Acquisition): Promise<boolean> {
    return this.serial.run(async () => {
      signal.throwIfAborted()
      if (await hasPdfFile(this.root, id)) return false
      const previous = await readAcquisition(this.root, id)
      const next = acquisition(previous)
      // What the user's browser was told stands through owlit's own looks
      if (previous?.yourBrowser && !next.yourBrowser) next.yourBrowser = previous.yourBrowser
      if (previous?.sentToBrowser && !next.sentToBrowser) next.sentToBrowser = previous.sentToBrowser
      // What owlit's own browser found stands until it looks again (which says, even if only undefined)
      if (previous?.looked && !("looked" in next)) next.looked = previous.looked
      await writeAcquisition(this.root, id, next)
      return true
    })
  }

  // Papers whose publisher's page, on one of these sites, wanted a person: back to the hidden browser,
  // which now holds what the user's check or sign-in left in its session. Ones it still can't get stay
  // noted.
  private async retrySites(sites: Set<string>, except: string) {
    for (const id of await this.ids()) {
      if (id === except) continue
      const acquisition = await readAcquisition(this.root, id)
      if (acquisition?.result !== "no_pdf" || !acquisition.needs?.host || !sites.has(siteOf(acquisition.needs.host))) continue
      this.queue("paper.pdf.browser", id, "background")
    }
  }

  // Queues a step for a paper when this build knows it (paper.pdf comes with T15, and so on)
  private queue(kind: string, id: string, priority: TaskPriority) {
    if (this.scheduler?.knows(kind)) this.scheduler.enqueue(kind, id, priority)
  }

  // A new PDF's text, and the search index that reads it
  private queueText(id: string, priority: TaskPriority) {
    for (const kind of ["paper.text", "index.paper"]) this.queue(kind, id, priority)
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
    await this.serial.run(async () => {
      let ids = dirty
      // The system lost track: look at every folder, and at every paper that had one
      const all = ids.includes("*")
      if (all) ids = [...new Set([...(await this.ids()), ...this.index.ids()])]
      const known = new Set(this.index.ids())
      const arrived: string[] = []
      for (const id of ids) {
        const record = await readRecord(this.root, id)
        if (record) this.index.set(id, record.ids, record.title)
        else this.index.delete(id)
        // Another program's paper: a folder owlit didn't write (the app indexes its own adds before the
        // watcher hears them) and has no state for
        if (record && !all && !known.has(id) && !(await readState(this.root, id))) arrived.push(id)
      }
      // A few at a time are papers landing; many at once are a library brought in, which isn't
      if (arrived.length <= LANDED_AT_ONCE) for (const id of arrived) this.services.landed?.(id, "outside")
      // Told from inside the lock, so a write queued behind this look (a restore, for Undo) can't land
      // between reading the folders and telling the window: "removed" would then arrive after the paper
      // was back, and the window would lose it again
      await this.announce(ids)
    }).catch((error) => console.error("[core] couldn't read changes in the library", error))
  }

  private trashDir(stamp: number, id: string) {
    return path.join(this.root, OWLIT_DIR, "trash", `${stamp}-paper-${id}`)
  }

  // A resolution looked up a moment ago, so add() and paper.metadata can use it whole. A partial one (a
  // search result from a source that isn't the paper's authority) only previews: what it says is kept
  // only after the services are asked.
  private recent(id: string): Resolution | undefined {
    const kept = this.kept(id)
    return kept && !kept.partial ? kept.resolution : undefined
  }

  // What a paper is, for a thread's row: the Library's record when the paper is here, otherwise what a
  // search found lately (partial or not: a thread keeps what the search showed)
  async snapshot(id: string): Promise<ThreadPaper | undefined> {
    const here = isPaperId(id) ? await readRecord(this.root, id) : undefined
    const from: Resolution | PaperRecord | undefined = here ?? this.kept(id)?.resolution
    if (from) return clean({ ...pick(from), tldr: from.tldr, citationCount: from.citationCount, openPdf: (from.pdfUrls?.length ?? 0) > 0 || undefined })
    const found = this.found.get(id)
    if (!found || Date.now() - found.at >= FOUND_TTL_MS) return undefined
    const p = found.paper
    return clean({ title: p.title, authors: p.authors, ids: p.ids, year: p.year, venue: p.venue, abstract: p.abstract, tldr: p.tldr, kind: p.kind, citationCount: p.citationCount, openPdf: p.openPdf })
  }

  // The search that showed a paper lately, for a row's foundBy
  foundBy(id: string): string | undefined {
    const found = this.found.get(id)
    return found && Date.now() - found.at < FOUND_TTL_MS ? found.query : undefined
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
// that has since been published, an S2 search) gives only part of the picture: a paper added from an
// arXiv search is otherwise kept with its preprint's year.
function fromAuthority(resolution: Resolution) {
  const authority = resolution.ids.doi ? "openalex" : "arxiv"
  return resolution.records.some((r) => r.source === authority)
}

function asRpcFailure(error: unknown) {
  if (error instanceof NotAPaper) return new RpcFailure(RpcErrorCode.NotFound, error.message)
  if (error instanceof HttpError) return new RpcFailure(RpcErrorCode.Unavailable, error.message, { status: error.status })
  return error
}

// Moves a folder to where it belongs, when something has made that place again meanwhile: a step that was
// running when the paper was removed can write its file (a PDF, its text) before it hears it was
// cancelled, and a rename onto a folder that isn't empty fails. That made Undo bring nothing back in a blind
// test, the paper's folder left in the trash. The moved folder's files win; what only the newcomer has (a
// PDF that finished downloading) stays. A folder that isn't there (a paper with no state yet) is nothing to move.
async function moveInto(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" && !(await exists(from))) return
    if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error
  }
  for (const name of await readdir(from)) {
    const source = path.join(from, name)
    const target = path.join(to, name)
    const [a, b] = await Promise.all([stat(source), stat(target).catch(() => undefined)])
    if (b && a.isDirectory() && b.isDirectory()) await moveInto(source, target)
    else {
      if (b) await rm(target, { recursive: true, force: true })
      await rename(source, target)
    }
  }
  await rm(from, { recursive: true, force: true })
}

const mtimeOf = (file: string) => stat(file).then((info) => info.mtimeMs, () => 0)

async function sha256Of(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function assertPdf(file: string) {
  const handle = await open(file, "r").catch(() => {
    throw new RpcFailure(RpcErrorCode.NotFound, t`That file can't be opened.`, { file })
  })
  const head = Buffer.alloc(5)
  await handle.read(head, 0, 5, 0)
  await handle.close()
  if (!isPdfBytes(head)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`That file isn't a PDF.`)
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
