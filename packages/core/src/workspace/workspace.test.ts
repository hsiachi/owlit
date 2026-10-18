import { RpcErrorCode, type RpcNotification } from "@owlit/protocol"
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { acquireLock, lockFileFor } from "./lock.ts"
import { workspaceDataDir, type Workspace } from "./workspace.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-ws-")))
  const userDataDir = path.join(base, "userData")
  const core = new Core({ userDataDir })
  cores.push(core)
  const heard: RpcNotification[] = []
  core.onNotify((n) => heard.push(n))
  const call = async (method: string, params?: unknown) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const folder = (name: string) => {
    const dir = path.join(base, name)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return { base, userDataDir, core, heard, call, folder }
}

// Every file under dir, relative, sorted
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort()
}

describe("workspace.open", () => {
  it("creates only .owlit/workspace.json in an empty folder", async () => {
    const { call, folder } = setup()
    const empty = folder("empty")
    const info = await call("workspace.open", { path: empty })
    expect(info).toEqual({ path: empty, name: "empty" })
    expect(tree(empty)).toEqual([path.join(".owlit", "workspace.json")])
    expect(JSON.parse(readFileSync(path.join(empty, ".owlit/workspace.json"), "utf8"))).toEqual({ version: 1, layout: {} })
  })

  it("keeps an existing workspace.json as it is", async () => {
    const { call, folder } = setup()
    const ws = folder("kept")
    mkdirSync(path.join(ws, ".owlit"))
    writeFileSync(path.join(ws, ".owlit/workspace.json"), '{"version":1,"layout":{"x":1}}')
    await call("workspace.open", { path: ws })
    expect(readFileSync(path.join(ws, ".owlit/workspace.json"), "utf8")).toBe('{"version":1,"layout":{"x":1}}')
  })

  it("takes the lock beside the workspace's socket and notifies", async () => {
    const { call, folder, heard } = setup()
    const ws = folder("locked")
    await call("workspace.open", { path: ws })
    const lock = lockFileFor(ws)
    expect(JSON.parse(readFileSync(lock, "utf8"))).toMatchObject({ pid: process.pid, workspace: ws })
    expect(path.basename(lock)).toMatch(/^owlit-[0-9a-f]{12}\.lock$/)
    // Background tasks (the search index) may report too
    expect(heard.map((n) => n.method).filter((m) => m !== "tasks.changed")).toEqual(["workspace.state", "workspace.opened", "workspace.state"])
    expect(heard.find((n) => n.method === "workspace.opened")?.params).toEqual({ path: ws, name: "locked" })
  })

  it("remembers recent and last workspaces in settings.json", async () => {
    const { call, folder, userDataDir } = setup()
    const a = folder("a")
    const b = folder("b")
    await call("workspace.open", { path: a })
    await call("workspace.open", { path: b })
    await call("workspace.open", { path: a })
    expect(await call("workspace.recent")).toEqual([
      { path: a, name: "a" },
      { path: b, name: "b" },
    ])
    expect(await call("workspace.current")).toEqual({ path: a, name: "a" })
    const settings = JSON.parse(readFileSync(path.join(userDataDir, "settings.json"), "utf8"))
    expect(settings).toMatchObject({ version: 1, lastWorkspace: a, recentWorkspaces: [a, b] })

    // A fresh core (the next launch) reopens the last one
    const next = new Core({ userDataDir })
    expect(await next.lastWorkspace()).toBe(a)
  })

  it("releases the old workspace's lock on switch", async () => {
    const { call, folder } = setup()
    const a = folder("a")
    const b = folder("b")
    await call("workspace.open", { path: a })
    await call("workspace.open", { path: b })
    expect(existsSync(lockFileFor(a))).toBe(false)
    expect(existsSync(lockFileFor(b))).toBe(true)
  })

  it("opens the next workspace even when the last one fails to close", async () => {
    const { core, call, folder } = setup()
    const a = folder("a")
    const b = folder("b")
    await call("workspace.open", { path: a })
    const old = (core as unknown as { workspace: Workspace }).workspace
    const dispose = old.dispose.bind(old)
    vi.spyOn(old, "dispose").mockImplementation(async () => {
      await dispose()
      throw new Error("The disk went away.")
    })
    await call("workspace.open", { path: b })
    expect(await call("workspace.current")).toEqual({ path: b, name: "b" })
    expect(existsSync(lockFileFor(b))).toBe(true)
  })

  it("works with Chinese and spaces in the path", async () => {
    const { call, folder } = setup()
    const ws = folder("研究 笔记/第 2 章")
    const info = await call("workspace.open", { path: ws })
    expect(info).toEqual({ path: ws, name: "第 2 章" })
    expect(existsSync(path.join(ws, ".owlit/workspace.json"))).toBe(true)
  })

  it("hashes the same folder to the same data directory in NFC and NFD", () => {
    const nfc = "/Users/x/研究/Café"
    expect(workspaceDataDir("/u", nfc)).toBe(workspaceDataDir("/u", nfc.normalize("NFD")))
  })

  it("explains a missing folder or a file, and forgets a vanished recent", async () => {
    const { call, folder, base } = setup()
    const gone = folder("gone")
    await call("workspace.open", { path: gone })
    await expect(call("workspace.open", { path: path.join(base, "nope") })).rejects.toMatchObject({
      code: RpcErrorCode.NotFound,
      message: `There is no folder at ${path.join(base, "nope")}.`,
    })
    writeFileSync(path.join(base, "file.md"), "x")
    await expect(call("workspace.open", { path: path.join(base, "file.md") })).rejects.toMatchObject({
      message: "file.md is a file, not a folder.",
    })
    // The failed opens left the current workspace open
    expect(await call("workspace.current")).toEqual({ path: gone, name: "gone" })
  })

  it("says a folder owlit isn't allowed to read needs access, and keeps it in the recent list", async () => {
    const { call, folder } = setup()
    const parent = folder("guarded")
    const ws = path.join(parent, "Research")
    mkdirSync(ws)
    await call("workspace.open", { path: ws })
    await call("workspace.open", { path: folder("other") })
    // A folder macOS's privacy settings keep from owlit fails its stat the same way
    chmodSync(parent, 0)
    try {
      await expect(call("workspace.open", { path: ws })).rejects.toMatchObject({
        code: RpcErrorCode.Forbidden,
        message: expect.stringContaining("System Settings"),
      })
      const { recent } = await call("workspace.welcome")
      expect(recent.find((r: { path: string }) => r.path === ws)).toMatchObject({ missing: false })
    } finally {
      chmodSync(parent, 0o755)
    }
  })

  it("refuses a workspace another live process holds, and takes over a dead one's lock", async () => {
    const { call, folder } = setup()
    const ws = folder("shared")
    const lock = lockFileFor(ws)
    // pid 1 (launchd) is always alive and never us
    writeFileSync(lock, JSON.stringify({ pid: 1, workspace: ws, since: Date.now() }))
    await expect(call("workspace.open", { path: ws })).rejects.toMatchObject({
      code: RpcErrorCode.Conflict,
      message: "shared is already open in another owlit.",
    })
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, workspace: ws, since: Date.now() }))
    await expect(call("workspace.open", { path: ws })).resolves.toMatchObject({ name: "shared" })
  })

  it("takes over a lock whose pid now belongs to a process that started after it", async () => {
    const { call, folder } = setup()
    const ws = folder("reused")
    const since = Date.now() - 2000
    const other = spawn("sleep", ["30"])
    try {
      writeFileSync(lockFileFor(ws), JSON.stringify({ pid: other.pid, workspace: ws, since }))
      await expect(call("workspace.open", { path: ws })).resolves.toMatchObject({ name: "reused" })
    } finally {
      other.kill()
    }
  })
})

describe("acquireLock", () => {
  it("releases only its own lock", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "owlit-lock-"))
    const release = await acquireLock(lockFileFor("/w", dir), "/w")
    expect(existsSync(lockFileFor("/w", dir))).toBe(true)
    await release()
    expect(existsSync(lockFileFor("/w", dir))).toBe(false)
  })

  it("takes over a lock from before the machine last started", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "owlit-lock-"))
    // pid 1 is alive, but the lock is older than this boot
    writeFileSync(lockFileFor("/w", dir), JSON.stringify({ pid: 1, workspace: "/w", since: 0 }))
    const release = await acquireLock(lockFileFor("/w", dir), "/w")
    await release()
  })
})
