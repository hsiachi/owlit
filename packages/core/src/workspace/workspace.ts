import { RpcErrorCode, type WorkspaceInfo, type WorkspaceSettings } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { mkdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
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

// One open workspace. Everything tied to it hangs off this object, so switching workspaces is
// dispose() and open() again.
export class Workspace {
  readonly info: WorkspaceInfo
  readonly root: string
  readonly dataDir: string
  private release: () => Promise<void>

  private constructor(root: string, dataDir: string, release: () => Promise<void>) {
    this.root = root
    this.dataDir = dataDir
    this.info = { path: root, name: path.basename(root) }
    this.release = release
  }

  // Resolves the folder, takes the lock and makes sure .owlit/workspace.json exists. Creates nothing
  // else inside the folder.
  static async open(folder: string, userDataDir: string) {
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
    } catch (error) {
      await release()
      throw error
    }
    return new Workspace(root, dataDir, release)
  }

  // Path of something in .owlit/
  owlitPath(...segments: string[]) {
    return path.join(this.root, OWLIT_DIR, ...segments)
  }

  async dispose() {
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
