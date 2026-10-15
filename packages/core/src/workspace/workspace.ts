import { t } from "@lingui/core/macro"
import { RpcErrorCode, type MemoryLine, type Task, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { mkdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Chats } from "../chats/chats.ts"
import { Docs } from "../docs/docs.ts"
import type { Host } from "../host.ts"
import { Http } from "../net/http.ts"
import { Versions } from "../docs/versions.ts"
import { Memory } from "../memory/memory.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { Library, type LibraryServices } from "../library/library.ts"
import { SearchIndex, SETTLE_MS } from "../search/search.ts"
import { Threads, type ThreadsServices } from "../threads/threads.ts"
import { findQuote } from "../library/quotes.ts"
import { isPaperId, paperDir } from "../library/paths.ts"
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
  // What sharing docs by link needs from outside the workspace (the server, the network, the author)
  shares?: Omit<SharesServices, "owlitDir" | "dataDir" | "readDoc" | "paper">
}

export interface WorkspaceTasks {
  // The kinds of task this workspace can run, made for it (they close over its paths)
  definitions?: (workspace: Workspace) => TaskDefinition[]
  onChange?: (task: Task) => void
  limits?: SchedulerOptions["limits"]
}

// One open workspace. Everything tied to it hangs off this object, so switching workspaces is
// dispose() and open() again.
export class Workspace {
  readonly info: WorkspaceInfo
  readonly root: string
  readonly dataDir: string
  readonly docs: Docs
  readonly versions: Versions
  readonly chats: Chats
  readonly library: Library
  readonly tasks: Scheduler
  readonly search: SearchIndex
  readonly threads: Threads
  readonly memory: Memory
  readonly shares: Shares
  private release: () => Promise<void>

  private constructor(root: string, dataDir: string, release: () => Promise<void>, options: WorkspaceOptions) {
    const { host = {}, tasks = {} } = options
    this.root = root
    this.dataDir = dataDir
    this.info = { path: root, name: path.basename(root) }
    this.release = release
    this.docs = new Docs(root, path.join(root, OWLIT_DIR), host)
    this.versions = new Versions(path.join(root, OWLIT_DIR))
    this.chats = new Chats(path.join(root, OWLIT_DIR))
    this.memory = new Memory(path.join(root, OWLIT_DIR), root, this.versions, options.memoryChanged)
    this.library = new Library(root, dataDir, options.library ?? { http: new Http({ fetch: host.fetch, userAgent: "owlit" }), settings: async () => ({}) })
    this.search = new SearchIndex(root, dataDir, this.library)
    this.threads = new Threads(path.join(root, OWLIT_DIR), { versions: this.versions }, {
      // A paper in the Library is what the Library says; one Owlit only found is what the search said
      paper: (id) => this.library.snapshot(id),
      findPassage: async (id, quote) => {
        if (!isPaperId(id)) return undefined
        const text = await readFile(path.join(paperDir(root, id), "text.md"), "utf8").catch(() => null)
        return text === null ? undefined : findQuote(text, quote)
      },
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

  // Resolves the folder, takes the lock, makes sure .owlit/workspace.json exists and picks up the tasks
  // left unfinished. Creates nothing else inside the folder.
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
      const workspace = new Workspace(root, dataDir, release, options)
      await workspace.tasks.start()
      // Versions past the keep rules go when the workspace opens
      void workspace.versions.cleanup().catch((error) => console.error("[core] couldn't clean up versions", error))
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

// The folder's real absolute path; a readable error when it is missing or not a folder
export async function resolveFolder(folder: string) {
  const absolute = path.resolve(folder)
  let info
  try {
    info = await stat(absolute)
  } catch {
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
