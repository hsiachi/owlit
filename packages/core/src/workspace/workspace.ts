import { RpcErrorCode, type Task, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { mkdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Chats } from "../chats/chats.ts"
import { Docs, type Host } from "../docs/docs.ts"
import { Versions } from "../docs/versions.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { Scheduler, TaskStore, type TaskDefinition } from "../tasks/index.ts"
import { acquireLock, WorkspaceLockedError } from "./lock.ts"

// The workspace's own state folder, inside it
export const OWLIT_DIR = ".owlit"

// <userData>/workspaces/<first 12 hex of sha1(path)>/: what is derived from this workspace or tied to
// this machine (index, task log, lock). Paths are hashed in NFC so the same folder gets the same
// directory however its name reached us.
export function workspaceDataDir(userDataDir: string, workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath.normalize("NFC")).digest("hex").slice(0, 12)
  return path.join(userDataDir, "workspaces", hash)
}

export interface WorkspaceTasks {
  // The kinds of task this workspace can run, made for it (they close over its paths)
  definitions?: (workspace: Workspace) => TaskDefinition[]
  onChange?: (task: Task) => void
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
  readonly tasks: Scheduler
  private release: () => Promise<void>

  private constructor(root: string, dataDir: string, release: () => Promise<void>, host: Host, tasks: WorkspaceTasks) {
    this.root = root
    this.dataDir = dataDir
    this.info = { path: root, name: path.basename(root) }
    this.release = release
    this.docs = new Docs(root, path.join(root, OWLIT_DIR), host)
    this.versions = new Versions(path.join(root, OWLIT_DIR))
    this.chats = new Chats(path.join(root, OWLIT_DIR))
    this.tasks = new Scheduler({
      store: new TaskStore(path.join(dataDir, "tasks")),
      definitions: tasks.definitions?.(this) ?? [],
      onChange: tasks.onChange,
    })
  }

  // Resolves the folder, takes the lock, makes sure .owlit/workspace.json exists and picks up the tasks
  // left unfinished. Creates nothing else inside the folder.
  static async open(folder: string, userDataDir: string, host: Host = {}, tasks: WorkspaceTasks = {}) {
    const root = await resolveFolder(folder)
    const dataDir = workspaceDataDir(userDataDir, root)
    await mkdir(dataDir, { recursive: true })
    let release: () => Promise<void>
    try {
      release = await acquireLock(dataDir, root)
    } catch (error) {
      if (error instanceof WorkspaceLockedError) {
        throw new RpcFailure(RpcErrorCode.Conflict, `${path.basename(root)} is already open in another owlit.`, {
          pid: error.pid,
        })
      }
      throw error
    }
    try {
      await ensureWorkspaceFile(root)
      const workspace = new Workspace(root, dataDir, release, host, tasks)
      await workspace.tasks.start()
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
    if (stored === null) throw new RpcFailure(RpcErrorCode.Conflict, "workspace.json in .owlit can't be read, so owlit leaves it alone.")
    const layout: Record<string, unknown> = { ...stored?.layout }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete layout[key]
      else layout[key] = value
    }
    await writeJsonAtomic(file, { ...stored, version: 1, layout })
    return layout
  }

  async dispose() {
    await this.tasks.dispose()
    await this.chats.flush()
    this.docs.dispose()
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
    throw new RpcFailure(RpcErrorCode.NotFound, `There is no folder at ${absolute}.`, { path: absolute })
  }
  if (!info.isDirectory()) {
    throw new RpcFailure(RpcErrorCode.NotFound, `${path.basename(absolute)} is a file, not a folder.`, { path: absolute })
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
