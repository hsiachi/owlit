import { open, readFile, rm } from "node:fs/promises"
import path from "node:path"

interface LockInfo {
  pid: number
  workspace: string
  since: number
}

export class WorkspaceLockedError extends Error {
  readonly pid: number
  constructor(pid: number) {
    super(`The workspace is held by process ${pid}`)
    this.pid = pid
  }
}

// <dataDir>/lock: one process works on a workspace at a time. Electron's single-instance lock already
// keeps a second owlit window away; this file also covers anything else that opens the workspace
// (a second build with its own app data, later the CLI). A lock left by a dead process is taken over.
export async function acquireLock(dataDir: string, workspace: string) {
  const file = path.join(dataDir, "lock")
  const info: LockInfo = { pid: process.pid, workspace, since: Date.now() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, "wx")
      await handle.writeFile(JSON.stringify(info) + "\n")
      await handle.close()
      return () => releaseLock(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const holder = await readLock(file)
      if (holder && holder.pid !== process.pid && isAlive(holder.pid)) throw new WorkspaceLockedError(holder.pid)
      await rm(file, { force: true })
    }
  }
  throw new Error(`Could not take ${file}`)
}

async function releaseLock(file: string) {
  const holder = await readLock(file)
  if (holder?.pid === process.pid) await rm(file, { force: true })
}

async function readLock(file: string): Promise<LockInfo | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LockInfo
  } catch {
    return undefined
  }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists but belongs to someone else
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
