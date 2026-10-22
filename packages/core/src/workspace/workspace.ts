import { t } from "@lingui/core/macro"
import { isPerson, RpcErrorCode, type CitationPassage, type JournalEntry, type PersonId, type CitedWork, type MemoryLine, type Notifications, type PaperIds, type ProfileSettings, type Project, type Task, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat } from "node:fs/promises"
import path from "node:path"
import { Chats } from "../chats/chats.ts"
import { Citations, type CitationServices } from "../docs/citations.ts"
import { Docs } from "../docs/docs.ts"
import type { Host } from "../host.ts"
import { Http } from "../net/http.ts"
import { ChangeLog } from "../changes/log.ts"
import { newWriteId, Recorder, type ReplyOrigin } from "../changes/record.ts"
import { Members } from "../changes/members.ts"
import { docProposals } from "../changes/proposals.ts"
import { Seen } from "../changes/seen.ts"
import { SettingsStore } from "../settings/store.ts"
import { Memory } from "../memory/memory.ts"
import { Cited } from "../projects/cited.ts"
import { Projects, touchedBy } from "../projects/projects.ts"
import { journalOf, summarize } from "../projects/summary.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, WINDOW } from "../rpc/index.ts"
import { Library, type LibraryServices } from "../library/library.ts"
import { SearchIndex, SETTLE_MS } from "../search/search.ts"
import { Threads, type ThreadsServices } from "../threads/threads.ts"
import { citesOtherIn, placeOf } from "../library/passage.ts"
import { findQuote } from "../library/quotes.ts"
import { isPaperId, paperDir } from "../library/paths.ts"
import { paperIdOf } from "../library/refs.ts"
import { Scheduler, TaskStore, type SchedulerOptions, type TaskDefinition } from "../tasks/index.ts"
import { Shares, type SharesServices } from "../share/shares.ts"
import { acquireLock, lockFileFor, WorkspaceLockedError } from "./lock.ts"
import { OWLIT_DIR } from "./paths.ts"
import { socketHash } from "../rpc/socket.ts"

export { OWLIT_DIR }

// <userData>/workspaces/<the workspace's id>/: what is derived from this workspace or tied to this
// machine (index, task log, share keys). A workspace whose workspace.json can't be read, and so has no
// id, is filed under the first 12 hex of sha1(its path), in NFC so the same folder gets the same
// directory however its name reached us; a folder that gets an id takes that directory over once
// (dataDirFor).
export function workspaceDataDir(userDataDir: string, workspacePath: string, id?: string) {
  return path.join(userDataDir, "workspaces", id ?? socketHash(workspacePath))
}

// <dataDir>/folder.json: where the folder was when it was last opened, to tell a moved folder (which
// keeps its id and data) from a copy of one (which gets an id of its own)
interface FolderRecord {
  path: string
}

// The data directory for the folder at root with the id its workspace.json has (undefined: none). Takes
// over the directory its path was filed under; a copy of a folder that is still where the original
// was opened gets a new id here, so the two never share a task log or share keys.
async function dataDirFor(userDataDir: string, root: string, id: string | undefined): Promise<string> {
  if (!id) return workspaceDataDir(userDataDir, root)
  let dir = workspaceDataDir(userDataDir, root, id)
  const record = await readJson<FolderRecord>(path.join(dir, "folder.json")).catch(() => undefined)
  if (record && record.path !== root && (await idAt(record.path)) === id) {
    dir = workspaceDataDir(userDataDir, root, await newId(root))
  }
  const byPath = workspaceDataDir(userDataDir, root)
  if (!(await exists(dir)) && (await exists(byPath))) await rename(byPath, dir)
  await mkdir(dir, { recursive: true })
  await writeJsonAtomic(path.join(dir, "folder.json"), { path: root } satisfies FolderRecord)
  return dir
}

const exists = (file: string) => stat(file).then(() => true, () => false)
const workspaceFile = (root: string) => path.join(root, OWLIT_DIR, "workspace.json")
const idAt = (root: string) => readJson<WorkspaceSettings>(workspaceFile(root)).then((s) => s?.id, () => undefined)

// Gives the workspace at root a new id, kept with the rest of its workspace.json
async function newId(root: string) {
  const id = randomBytes(8).toString("hex")
  const stored = await readJson<WorkspaceSettings>(workspaceFile(root))
  await writeJsonAtomic(workspaceFile(root), { ...stored, version: 1, id, layout: stored?.layout ?? {} } satisfies WorkspaceSettings)
  return id
}

export interface WorkspaceOptions {
  host?: Host
  library?: LibraryServices
  threads?: ThreadsServices
  tasks?: WorkspaceTasks
  // Owlit's memory changed, by anyone
  memoryChanged?: (lines: MemoryLine[]) => void
  // What projects.list answers changed (Projects.refresh)
  projectsChanged?: (projects: Project[]) => void
  // The profile of the person using this owlit (with its id); read from the app data's settings when
  // not given
  profile?: () => Promise<ProfileSettings>
  // An entry was added to the change log
  changeAdded?: (notification: Notifications["changes.added"]) => void
  // The chat reply a change belongs to (the change log's origin.replyId)
  replyOf?: ReplyOrigin
  // What core saw agents read, for what Owlit's citations rest on; without it, Owlit's writes count as
  // made with reads this workspace never saw
  citations?: Pick<CitationServices, "reads" | "answering">
  // What sharing docs by link needs from outside the workspace (the server, the network, the author)
  shares?: Omit<SharesServices, "owlitDir" | "dataDir" | "readDoc" | "paper">
}

export interface WorkspaceTasks {
  // The kinds of task this workspace can run, made for it (they close over its paths)
  definitions?: (workspace: Workspace) => TaskDefinition[]
  onChange?: (task: Task) => void
  limits?: SchedulerOptions["limits"]
  // Run them once the workspace has opened (the default). Core starts them itself once the workspace is
  // the open one.
  start?: boolean
}

// One open workspace. Everything tied to it hangs off this object, so switching workspaces is
// dispose() and open() again.
export class Workspace {
  readonly info: WorkspaceInfo
  readonly root: string
  readonly dataDir: string
  readonly docs: Docs
  readonly changes: ChangeLog
  readonly recorder: Recorder
  readonly citations: Citations
  readonly members: Members
  readonly seen: Seen
  readonly chats: Chats
  readonly library: Library
  readonly tasks: Scheduler
  readonly search: SearchIndex
  readonly threads: Threads
  readonly memory: Memory
  readonly shares: Shares
  readonly projects: Projects
  readonly cited: Cited
  // The person's journal, read again only once it changed
  private readonly journal: () => Promise<JournalEntry[]>
  private release: () => Promise<void>

  private constructor(root: string, dataDir: string, release: () => Promise<void>, options: WorkspaceOptions, profile: () => Promise<ProfileSettings>) {
    const { host = {}, tasks = {} } = options
    this.root = root
    this.dataDir = dataDir
    this.info = { path: root, name: path.basename(root) }
    this.release = release
    this.docs = new Docs(root, path.join(root, OWLIT_DIR), host)
    this.changes = new ChangeLog(path.join(root, OWLIT_DIR))
    this.recorder = new Recorder(this.changes, {
      profile,
      added: options.changeAdded,
      replyOf: options.replyOf,
      written: (change, before, after) => this.citations.written(change, before, after),
    })
    this.citations = new Citations(path.join(root, OWLIT_DIR), {
      reads: () => [],
      answering: () => false,
      ...options.citations,
      answered: async (chatId, exceptReply) => {
        const chat = await this.chats.get(chatId).catch(() => null)
        return chat?.messages.flatMap((m) => (m.id !== exceptReply && m.readFrom) || []) ?? []
      },
      canonical: (id) => this.library.canonical(id),
      paper: async (id) => {
        const text = path.join(paperDir(this.root, id), "text.md")
        const info = await stat(text).catch(() => null)
        return {
          abstract: (await this.library.get(id))?.abstract,
          hasText: !!info,
          ...(info ? { stamp: `${info.mtimeMs}:${info.size}` } : {}),
          text: () => readFile(text, "utf8").catch(() => null),
        }
      },
    })
    this.members = new Members(path.join(root, OWLIT_DIR))
    this.seen = new Seen(path.join(root, OWLIT_DIR))
    // Saves through docs.write; a doc that followed its first line to a new name is recorded as leaving the
    // old one and arriving at the new. Only the window's fold into the person's typing session; a
    // program's is its own change, said like any other
    this.docs.saved = async (rel, before, after, at, caller) => {
      if (caller.kind === "window") await this.recorder.saved(caller, rel, before, after)
      else if (before !== after) await this.recorder.doc(caller, rel, before, after)
      if (at === rel) return
      const writeId = newWriteId()
      await this.recorder.doc(caller, rel, after, null, { origin: { writeId } }, { quiet: true })
      await this.recorder.doc(caller, at, null, after, { origin: { writeId } }, { quiet: true })
    }
    this.chats = new Chats(path.join(root, OWLIT_DIR))
    this.memory = new Memory(path.join(root, OWLIT_DIR), root, this.recorder, options.memoryChanged, {
      projectsOfChat: (chatId) => this.projects.projectsOf({ kind: "chat", id: chatId }),
    })
    this.library = new Library(root, dataDir, {
      ...(options.library ?? { http: new Http({ fetch: host.fetch, userAgent: "owlit" }), settings: async () => ({}) }),
      person: () => this.recorder.actorOf(WINDOW),
      // The person's import, one change however many papers it brings
      imported: (paper, importId) =>
        void this.recorder
          .record(WINDOW, { action: "create", target: { kind: "paper", path: paper.id }, origin: { writeId: importId } }, { label: paper.title, quiet: true })
          .catch((error) => console.error("[core] couldn't record an imported paper", error)),
    })
    this.search = new SearchIndex(root, dataDir, this.library)
    this.projects = new Projects({
      files: () => this.docs.files(),
      read: (rel) => this.docs.readDisk(rel),
      chat: (id) => this.chats.get(id).catch(() => null),
      changesOf: (chatId) => this.changes.list({ chatId }),
      thread: (id) => this.threads.summary(id),
      docsLinking: async (uri) => (await this.search.linksTo(uri)).flatMap((l) => (l.source === "doc" ? [l.key] : [])),
      canonical: (id) => this.library.canonical(id),
      changed: options.projectsChanged,
    })
    this.cited = new Cited({
      projects: () => this.projects.list(),
      files: () => this.docs.files(),
      read: (rel) => this.docs.readDisk(rel),
      canonical: (id) => this.library.canonical(id),
      owlitDepths: (rel) => this.citations.owlitDepths(rel),
    })
    this.threads = new Threads(path.join(root, OWLIT_DIR), { recorder: this.recorder, changes: this.changes }, {
      // A paper in the Library is what the Library says; one Owlit only found is what the search said
      paper: (id) => this.library.snapshot(id),
      // Added as the writer's own, recorded so it can be taken back, its PDF sought as for any add. Filed
      // by its DOI or arXiv id when it has one, like any add; by the id it was named by otherwise.
      addPaper: async (id, paper, caller) => {
        const { paper: added, existed } = await this.library.addNew(
          { ...(!paperIdOf(paper.ids) && isPaperId(id) ? { id } : {}), title: paper.title, authors: paper.authors, ids: paper.ids, year: paper.year, venue: paper.venue, abstract: paper.abstract, kind: paper.kind },
          await this.recorder.actorOf(caller),
          "background",
        )
        if (!existed) await this.recorder.record(caller, { action: "create", target: { kind: "paper", path: added.id } }, { label: added.title, quiet: true })
        return added.id
      },
      foundBy: (id) => this.library.foundBy(id),
      canonical: (id, ids) => this.library.canonical(id, ids),
      facts: (id) => this.library.threadFacts(id),
      findPassage: (id, quote) => this.findPassage(id, quote),
      searches: (by, since) => this.library.searchesBy(by, since),
      projects: () => this.projects.list(),
      ...options.threads,
    })
    this.tasks = new Scheduler({
      store: new TaskStore(path.join(dataDir, "tasks")),
      definitions: tasks.definitions?.(this) ?? [],
      onChange: tasks.onChange,
      limits: tasks.limits,
    })
    this.library.attach(this.tasks)
    this.shares = new Shares({
      server: () => null,
      author: async () => undefined,
      changed: () => {},
      commentsChanged: () => {},
      ...options.shares,
      owlitDir: path.join(root, OWLIT_DIR),
      dataDir,
      secrets: options.shares?.secrets ?? host.secrets,
      fetch: options.shares?.fetch ?? host.fetch,
      readDoc: (rel) => this.docs.read(rel).then((r) => r.content, () => null),
      // As the doc marks them: Owlit's standing changes since the text the person last had on screen
      held: async (rel, markdown) => {
        const me = await this.recorder.actorOf(WINDOW)
        return isPerson(me) && (await this.proposalsFor(me, rel, markdown)).length > 0
      },
      paper: async (id) => {
        const paper = await this.library.get(id)
        if (!paper) return undefined
        const [digest, note] = await Promise.all([this.library.digest(id), this.library.read(id, "note").then((r) => r.text)])
        return { paper, digest, note }
      },
    })
    this.journal = journalOf(this.owlitPath("journal.jsonl"))
  }

  // Owlit's standing changes to a doc since the text the person last had on screen, as the doc marks them
  private async proposalsFor(me: PersonId, rel: string, markdown: string) {
    const marks = await this.seen.get(me, ["docs"])
    const mark = marks.docs[rel]
    return docProposals(this.changes, rel, markdown, mark ? { hash: mark.hash } : { since: marks.since })
  }

  // Each project as Home shows it to the person (projects/summary.ts)
  projectsSummary(me: PersonId) {
    return summarize(
      {
        projects: () => this.projects.list(),
        files: () => this.docs.files(),
        journal: this.journal,
        comments: (rel) => this.docs.listComments(rel),
        read: (rel) => this.docs.readDisk(rel),
        proposals: async (rel, text) => (await this.proposalsFor(me, rel, text)).length,
        paper: async (id) => {
          const here = await this.library.canonical(id)
          return here ? this.library.get(here) : undefined
        },
        unseen: async () => (await this.seen.unseen(me, { changes: await this.changes.list({ target: { kind: "doc" } }), chats: [], papers: [] })).changes,
        changes: () => this.changes.list({ target: { kind: "doc" } }),
        chatStartedBy: async (id) => {
          const chat = await this.chats.summary(id)
          return chat ? (chat.startedBy ? "owlit" : "person") : null
        },
        chatWork: async (id) => {
          const chat = await this.chats.get(id).catch(() => null)
          if (!chat) return { projects: [], docs: [] }
          const [projects, changes] = await Promise.all([this.projects.projectsOf({ kind: "chat", id }), this.changes.list({ chatId: id })])
          return { projects, docs: touchedBy(chat, changes).docs }
        },
      },
      me,
    )
  }

  // The 1-based page a quote is on in a paper's full text, by any id the paper goes by; null when it
  // isn't there word for word, undefined when owlit has no text of the paper
  async findPassage(id: string, quote: string): Promise<number | null | undefined> {
    const here = await this.library.canonical(id)
    if (!here) return undefined
    const text = await readFile(path.join(paperDir(this.root, here), "text.md"), "utf8").catch(() => null)
    return text === null ? undefined : findQuote(text, quote)
  }

  // Where a citation's sentence sits in a paper, for its card (library/passage.ts placeOf), with the works
  // the sentence cites itself; null when neither the abstract nor the text holds it
  async passage(id: string, quote: string): Promise<{ passage: CitationPassage; citesOther?: CitedWork[] } | null> {
    const here = await this.library.canonical(id)
    if (!here) return null
    const [paper, text] = await Promise.all([this.library.get(here), readFile(path.join(paperDir(this.root, here), "text.md"), "utf8").catch(() => null)])
    const passage = placeOf(quote, { abstract: paper?.abstract, text })
    if (!passage) return null
    const citesOther = citesOtherIn(quote, text)
    return { passage, ...(citesOther.length ? { citesOther } : {}) }
  }

  // Whether owlit has a paper's full text (its text.md), by any id the paper goes by
  async hasText(id: string, ids?: PaperIds): Promise<boolean> {
    const here = await this.library.canonical(id, ids)
    return !!here && (await stat(path.join(paperDir(this.root, here), "text.md")).then(() => true, () => false))
  }

  // Resolves the folder, takes the lock, makes sure .owlit/workspace.json exists, adds the person to
  // .owlit/members.json and picks up the tasks left unfinished (running them unless asked not to yet).
  // Creates nothing else inside the folder.
  static async open(folder: string, userDataDir: string, options: WorkspaceOptions = {}) {
    const root = await resolveFolder(folder)
    let release: () => Promise<void>
    try {
      release = await acquireLock(lockFileFor(root), root)
    } catch (error) {
      if (error instanceof WorkspaceLockedError) {
        const name = path.basename(root)
        throw new RpcFailure(RpcErrorCode.Conflict, t`${name} is already open in another owlit.`, {
          pid: error.pid,
        })
      }
      throw error
    }
    try {
      const dataDir = await dataDirFor(userDataDir, root, await ensureWorkspaceFile(root))
      const settings = options.profile ? undefined : new SettingsStore(userDataDir)
      const profile = options.profile ?? (() => settings!.get().then((s) => s.profile))
      const workspace = new Workspace(root, dataDir, release, options, profile)
      await workspace.members.ensure(await profile())
      await workspace.tasks.load()
      if (options.tasks?.start !== false) await workspace.tasks.start()
      // Changes past the keep rules go when the workspace opens
      void workspace.changes.cleanup().catch((error) => console.error("[core] couldn't clean up the change log", error))
      workspace.search.attach(() => workspace.tasks.debounce("index.sync", "workspace", SETTLE_MS))
      return workspace
    } catch (error) {
      await release()
      throw error
    }
  }

  // Path of something in .owlit/
  owlitPath(...segments: string[]) {
    return path.join(this.root, OWLIT_DIR, ...segments)
  }

  // .owlit/workspace.json's layout. A workspace.json that doesn't parse is left alone and reads as empty.
  async layout(): Promise<Record<string, unknown>> {
    const stored = await readJson<WorkspaceSettings>(this.owlitPath("workspace.json")).catch(() => undefined)
    return stored?.layout ?? {}
  }

  async setLayout(patch: Record<string, unknown>) {
    const file = this.owlitPath("workspace.json")
    const stored = await readJson<WorkspaceSettings>(file).catch(() => null)
    if (stored === null) throw new RpcFailure(RpcErrorCode.Conflict, t`workspace.json in .owlit can't be read, so owlit leaves it alone.`)
    const layout: Record<string, unknown> = { ...stored?.layout }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete layout[key]
      else layout[key] = value
    }
    await writeJsonAtomic(file, { ...stored, version: 1, layout })
    return layout
  }

  async dispose() {
    this.shares.dispose()
    await this.tasks.dispose()
    await this.chats.flush()
    this.docs.dispose()
    this.library.dispose()
    this.search.dispose()
    await this.release()
  }
}

// The folder's real absolute path; a readable error when it is missing, not a folder, or one macOS doesn't
// let owlit read
export async function resolveFolder(folder: string) {
  const absolute = path.resolve(folder)
  let info
  try {
    info = await stat(absolute)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EPERM" || code === "EACCES") {
      throw new RpcFailure(RpcErrorCode.Forbidden, t`owlit isn't allowed to open ${absolute}. Allow it in System Settings › Privacy & Security › Files and Folders, then try again.`, { path: absolute })
    }
    throw new RpcFailure(RpcErrorCode.NotFound, t`There is no folder at ${absolute}.`, { path: absolute })
  }
  if (!info.isDirectory()) {
    const name = path.basename(absolute)
    throw new RpcFailure(RpcErrorCode.NotFound, t`${name} is a file, not a folder.`, { path: absolute })
  }
  return realpath(absolute)
}

// Makes sure .owlit/workspace.json exists and has an id; the id, or undefined when the file is there but
// unreadable (it is the user's, and left alone)
async function ensureWorkspaceFile(root: string): Promise<string | undefined> {
  const file = workspaceFile(root)
  let stored: WorkspaceSettings | undefined
  try {
    stored = await readJson<WorkspaceSettings>(file)
  } catch (error) {
    console.error(`[core] ${file} is not valid JSON; leaving it as it is`, error)
    return undefined
  }
  if (stored?.id) return stored.id
  return newId(root)
}
