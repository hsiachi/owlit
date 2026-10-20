import { t } from "@lingui/core/macro"
import { isPerson, RpcErrorCode, type MemoryLine, type Notifications, type PaperIds, type ProfileSettings, type Task, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat } from "node:fs/promises"
import path from "node:path"
import { Chats } from "../chats/chats.ts"
import { Docs } from "../docs/docs.ts"
import type { Host } from "../host.ts"
import { Http } from "../net/http.ts"
import { ChangeLog } from "../changes/log.ts"
import { newWriteId, Recorder, type ReplyOrigin } from "../changes/record.ts"
import { Members } from "../changes/members.ts"
import { docProposals } from "../changes/proposals.ts"
import { Seen } from "../changes/seen.ts"
import { SettingsStore } from "../settings.ts"
import { Memory } from "../memory/memory.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, WINDOW } from "../rpc/index.ts"
import { Library, type LibraryServices } from "../library/library.ts"
import { SearchIndex, SETTLE_MS } from "../search/search.ts"
import { Threads, type ThreadsServices } from "../threads/threads.ts"
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
// directory however its name reached us; that was every workspace's place before ids, and is adopted
// once by the id (dataDirFor).
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
  // The profile of the person using this owlit (with its id); read from the app data's settings when
  // not given
  profile?: () => Promise<ProfileSettings>
  // An entry was added to the change log
  changeAdded?: (notification: Notifications["changes.added"]) => void
  // The chat reply a change belongs to (the change log's origin.replyId)
  replyOf?: ReplyOrigin
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
  readonly members: Members
  readonly seen: Seen
  readonly chats: Chats
  readonly library: Library
  readonly tasks: Scheduler
  readonly search: SearchIndex
  readonly threads: Threads
  readonly memory: Memory
  readonly shares: Shares
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
    })
    this.members = new Members(path.join(root, OWLIT_DIR))
    this.seen = new Seen(path.join(root, OWLIT_DIR))
    // The window's saves; a doc that followed its first line to a new name is recorded as leaving the old
    // one and arriving at the new
    this.docs.saved = async (rel, before, after, at) => {
      await this.recorder.saved(WINDOW, rel, before, after)
      if (at === rel) return
      const writeId = newWriteId()
      await this.recorder.doc(WINDOW, rel, after, null, { origin: { writeId } }, { quiet: true })
      await this.recorder.doc(WINDOW, at, null, after, { origin: { writeId } }, { quiet: true })
    }
    this.chats = new Chats(path.join(root, OWLIT_DIR))
    this.memory = new Memory(path.join(root, OWLIT_DIR), root, this.recorder, options.memoryChanged)
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
    this.threads = new Threads(path.join(root, OWLIT_DIR), { recorder: this.recorder }, {
      // A paper in the Library is what the Library says; one Owlit only found is what the search said
      paper: (id) => this.library.snapshot(id),
      // Added as the writer's own, recorded so it can be taken back, and with no PDF sought. Filed by its
      // DOI or arXiv id when it has one, like any add; by the id it was named by otherwise.
      addPaper: async (id, paper, caller) => {
        const { paper: added, existed } = await this.library.addNew(
          { ...(!paperIdOf(paper.ids) && isPaperId(id) ? { id } : {}), title: paper.title, authors: paper.authors, ids: paper.ids, year: paper.year, venue: paper.venue, abstract: paper.abstract, kind: paper.kind },
          await this.recorder.actorOf(caller),
          "background",
          { fetchPdf: false },
        )
        if (!existed) await this.recorder.record(caller, { action: "create", target: { kind: "paper", path: added.id } }, { label: added.title, quiet: true })
        return added.id
      },
      foundBy: (id) => this.library.foundBy(id),
      canonical: (id, ids) => this.library.canonical(id, ids),
      facts: (id) => this.library.threadFacts(id),
      findPassage: (id, quote) => this.findPassage(id, quote),
      hasText: (id) => this.hasText(id),
      searches: (by, since) => this.library.searchesBy(by, since),
      chatAbout: async (chatId) => {
        const chat = await this.chats.get(chatId).catch(() => null)
        return chat?.startedBy ? chat.about : undefined
      },
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
        if (!isPerson(me)) return false
        const marks = await this.seen.get(me, ["docs"])
        const mark = marks.docs[rel]
        return (await docProposals(this.changes, rel, markdown, mark ? { hash: mark.hash } : { since: marks.since })).length > 0
      },
      paper: async (id) => {
        const paper = await this.library.get(id)
        if (!paper) return undefined
        const [digest, note] = await Promise.all([this.library.digest(id), this.library.read(id, "note").then((r) => r.text)])
        return { paper, digest, note }
      },
    })
  }

  // The 1-based page a quote is on in a paper's full text, by any id the paper goes by; null when it
  // isn't there word for word, undefined when owlit has no text of the paper
  async findPassage(id: string, quote: string): Promise<number | null | undefined> {
    const here = await this.library.canonical(id)
    if (!here) return undefined
    const text = await readFile(path.join(paperDir(this.root, here), "text.md"), "utf8").catch(() => null)
    return text === null ? undefined : findQuote(text, quote)
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
