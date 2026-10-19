import { execFile } from "node:child_process"
import { link, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { socketHash } from "../rpc/socket.ts"

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

// One process works on a workspace at a time. Electron's single-instance lock already keeps a second
// owlit window away; this file also covers anything else that opens the workspace (a second build with
// its own app data, later the CLI), so it sits beside the workspace's socket in $TMPDIR, keyed the same
// way, not in one owlit's app data. A lock whose pid is gone, or now belongs to a process that started
// after the lock was taken (a reused pid, or one from before a restart), is taken over.
export const lockFileFor = (workspace: string, dir = tmpdir()) => path.join(dir, `owlit-${socketHash(workspace)}.lock`)

export async function acquireLock(file: string, workspace: string) {
  const info: LockInfo = { pid: process.pid, workspace, since: Date.now() }
  // Written aside and linked into place, so a second opener never reads a half-written lock as no lock
  const draft = `${file}.${process.pid}.tmp`
  await writeFile(draft, JSON.stringify(info) + "\n")
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await link(draft, file)
        return () => releaseLock(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const holder = await readLock(file)
        if (holder && holder.pid !== process.pid && (await heldSince(holder))) throw new WorkspaceLockedError(holder.pid)
        await rm(file, { force: true })
      }
    }
  } finally {
    await rm(draft, { force: true })
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

// The process holding `pid` now is the one that took the lock only if it was already running then.
// ps prints the start to the second, so the holder's start is never after its own `since`.
async function heldSince(holder: LockInfo) {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-o", "lstart=", "-p", String(holder.pid)], {
      env: { ...process.env, LC_ALL: "C" },
    })
    const started = Date.parse(stdout.trim())
    return Number.isFinite(started) && started <= holder.since
  } catch {
    // ps exits 1 when no process has that pid
    return false
  }
}
