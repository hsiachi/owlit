import { t } from "@lingui/core/macro"
import { RpcErrorCode, type MemoryLine, type Notifications, type PaperIds, type ProfileSettings, type Task, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { mkdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Chats } from "../chats/chats.ts"
import { Docs } from "../docs/docs.ts"
import type { Host } from "../host.ts"
import { Http } from "../net/http.ts"
import { ChangeLog } from "../changes/log.ts"
import { newWriteId, Recorder } from "../changes/record.ts"
import { Members } from "../changes/members.ts"
import { Seen } from "../changes/seen.ts"
import { SettingsStore } from "../settings.ts"
import { Memory } from "../memory/memory.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, WINDOW } from "../rpc/index.ts"
import { Library, type LibraryServices } from "../library/library.ts"
import { SearchIndex, SETTLE_MS } from "../search/search.ts"
import { Threads, type ThreadsServices } from "../threads/threads.ts"
import { findQuote } from "../library/quotes.ts"
import { paperDir } from "../library/paths.ts"
import { Scheduler, TaskStore, type SchedulerOptions, type TaskDefinition } from "../tasks/index.ts"
import { Shares, type SharesServices } from "../share/shares.ts"
import { acquireLock, lockFileFor, WorkspaceLockedError } from "./lock.ts"
import { OWLIT_DIR } from "./paths.ts"
import { socketHash } from "../rpc/socket.ts"

export { OWLIT_DIR }

// <userData>/workspaces/<first 12 hex of sha1(path)>/: what is derived from this workspace or tied to
// this machine (index, task log, lock). Paths are hashed in NFC so the same folder gets the same
// directory however its name reached us.
export function workspaceDataDir(userDataDir: string, workspacePath: string) {
  return path.join(userDataDir, "workspaces", socketHash(workspacePath))
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
  // The initiative rule that queued a task, if one did
  ruleOf?: (taskId: string) => string | undefined
  // What sharing docs by link needs from outside the workspace (the server, the network, the author)
  shares?: Omit<SharesServices, "owlitDir" | "dataDir" | "readDoc" | "paper">
}

export interface WorkspaceTasks {
  // The kinds of task this workspace can run, made for it (they close over its paths)
  definitions?: (workspace: Workspace) => TaskDefinition[]
  onChange?: (task: Task) => void
  limits?: SchedulerOptions["limits"]
  // Run them once the workspace has opened (the default). Core starts them itself once the workspace's
  // socket is up, so no agent run starts without owlit's tools.
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
      // A run ("<kind>:<task id>") reports in its task's session
      runOf: (run) => {
        const taskId = run.slice(run.indexOf(":") + 1)
        const ruleId = options.ruleOf?.(taskId)
        return { chatId: this.tasks.get(taskId)?.chatId, ...(ruleId ? { ruleId } : {}) }
      },
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
      canonical: (id, ids) => this.library.canonical(id, ids),
      facts: (id, paper) => this.library.rowFacts(id, paper),
      findPassage: (id, quote) => this.findPassage(id, quote),
      hasText: (id, ids) => this.hasText(id, ids),
      searches: (by, since) => this.library.searchesBy(by, since),
      ...options.threads,
    })
    this.tasks = new Scheduler({
      store: new TaskStore(path.join(dataDir, "tasks")),
      definitions: tasks.definitions?.(this) ?? [],
      onChange: tasks.onChange,
      limits: tasks.limits,
    })
    this.library.attach(this.tasks)
    this.threads.attach(this.tasks)
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
    const dataDir = workspaceDataDir(userDataDir, root)
    await mkdir(dataDir, { recursive: true })
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
      await ensureWorkspaceFile(root)
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

async function ensureWorkspaceFile(root: string) {
  const file = path.join(root, OWLIT_DIR, "workspace.json")
  try {
    if (await readJson<WorkspaceSettings>(file)) return
  } catch (error) {
    // There but unreadable: leave the user's file alone
    console.error(`[core] ${file} is not valid JSON; leaving it as it is`, error)
    return
  }
  const fresh: WorkspaceSettings = { version: 1, layout: {} }
  await writeJsonAtomic(file, fresh)
}
