import { RpcErrorCode } from "@owlit/protocol"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup(files: Record<string, string> = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-docs-")))
  const root = path.join(base, "ws")
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  mkdirSync(root, { recursive: true })
  const trashed: string[] = []
  const revealed: string[] = []
  const core = new Core({ userDataDir: path.join(base, "userData"), host: {
    trash: async (p) => {
      trashed.push(p)
      renameSync(p, path.join(base, `trashed-${trashed.length}`))
    },
    revealPath: (p) => void revealed.push(p),
  } })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const disk = (rel: string) => readFileSync(path.join(root, rel), "utf8")
  const exists = (rel: string) => existsSync(path.join(root, rel))
  return { root, call, disk, exists, trashed, revealed }
}

describe("docs.list", () => {
  it("lists docs and folders, hiding library/ and dot-folders but not an old knowledge/ folder", async () => {
    const { call } = await setup({
      "a.md": "# A",
      "notes/b.md": "b",
      "notes/pic.png": "x",
      "library/papers/p/paper.json": "{}",
      ".obsidian/app.json": "{}",
      "notes/.hidden.md": "h",
      "knowledge/topic.md": "t",
    })
    const { files, folders } = await call("docs.list")
    expect(files.map((f: any) => f.path).sort()).toEqual(["a.md", "knowledge/topic.md", "notes/b.md", "notes/pic.png"])
    expect(folders.sort()).toEqual(["knowledge", "notes"])
    const a = files.find((f: any) => f.path === "a.md")
    expect(a.content).toBe("# A")
    expect(a.nameLocked).toBe(true)
    expect(files.find((f: any) => f.path === "notes/pic.png").content).toBeUndefined()
  })

  it("keeps a file's id across lists and renames", async () => {
    const { call } = await setup({ "a.md": "x" })
    const first = (await call("docs.list")).files[0]
    expect((await call("docs.list")).files[0].id).toBe(first.id)
    await call("docs.rename", { path: "a.md", name: "b" })
    const after = (await call("docs.list")).files[0]
    expect(after).toMatchObject({ id: first.id, path: "b.md" })
  })

  it("lists nothing outside the workspace through a symlinked folder", async () => {
    const { call, root } = await setup({ "a.md": "x" })
    symlinkSync(root, path.join(root, "loop"))
    const { files } = await call("docs.list")
    expect(files.map((f: any) => f.path)).toEqual(["a.md"])
  })
})

describe("docs.write", () => {
  it("writes exactly the bytes given, atomically", async () => {
    const { call, disk, root } = await setup({ "a.md": "one\r\ntwo" })
    const [file] = (await call("docs.list")).files
    const text = "one\r\ntwo\r\nthree — 三 "
    const result = await call("docs.write", { path: "a.md", content: text, expectedModifiedAt: file.modifiedAt })
    expect(disk("a.md")).toBe(text)
    expect(result.modifiedAt).toBe(statSync(path.join(root, "a.md")).mtimeMs)
    // No temp files left behind
    expect(readdirSync(root).filter((n) => n.includes(".tmp"))).toEqual([])
  })

  it("refuses a write when the file changed on disk, and says what it is now", async () => {
    const { call, root } = await setup({ "a.md": "old" })
    const [file] = (await call("docs.list")).files
    writeFileSync(path.join(root, "a.md"), "theirs")
    const later = new Date(Date.now() + 5000)
    const { utimesSync } = await import("node:fs")
    utimesSync(path.join(root, "a.md"), later, later)
    const error = await call("docs.write", { path: "a.md", content: "mine", expectedModifiedAt: file.modifiedAt }).catch((e) => e)
    expect(error.code).toBe(RpcErrorCode.Conflict)
    expect(error.data).toMatchObject({ path: "a.md", content: "theirs" })
    await call("docs.write", { path: "a.md", content: "mine", expectedModifiedAt: 0, force: true })
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("mine")
  })

  it("writes through a symlink and keeps permissions", async () => {
    const { call, root } = await setup({ "real.md": "x" })
    symlinkSync(path.join(root, "real.md"), path.join(root, "link.md"))
    const { chmodSync } = await import("node:fs")
    chmodSync(path.join(root, "real.md"), 0o600)
    const link = (await call("docs.list")).files.find((f: any) => f.path === "link.md")
    await call("docs.write", { path: "link.md", content: "y", expectedModifiedAt: link.modifiedAt })
    expect(lstatSync(path.join(root, "link.md")).isSymbolicLink()).toBe(true)
    expect(readFileSync(path.join(root, "real.md"), "utf8")).toBe("y")
    expect(statSync(path.join(root, "real.md")).mode & 0o777).toBe(0o600)
  })
})

describe("naming", () => {
  it("names a new doc after its first line and follows it until renamed by hand", async () => {
    const { call, exists } = await setup({ "notes/Plan.md": "taken" })
    const created = await call("docs.create", { path: "notes/2026-10-09 10.00.md", content: "# Plan\n", followsFirstLine: true, id: "fresh" })
    expect(created).toMatchObject({ id: "fresh", path: "notes/Plan 2.md", nameLocked: false })
    const second = await call("docs.write", { path: created.path, content: "# Budget\n", expectedModifiedAt: created.modifiedAt })
    expect(second.path).toBe("notes/Budget.md")
    expect(exists("notes/Plan 2.md")).toBe(false)
    const renamed = await call("docs.rename", { path: "notes/Budget.md", name: "Money" })
    expect(renamed.path).toBe("notes/Money.md")
    const third = await call("docs.write", { path: "notes/Money.md", content: "# Other\n", expectedModifiedAt: (await call("docs.read", { path: "notes/Money.md" })).modifiedAt })
    expect(third).toMatchObject({ path: "notes/Money.md", nameLocked: true })
  })

  it("remembers which docs follow their first line across restarts", async () => {
    const { call, root } = await setup()
    const created = await call("docs.create", { path: "x.md", content: "# Draft", followsFirstLine: true })
    expect(JSON.parse(readFileSync(path.join(root, ".owlit/docs/names.json"), "utf8")).followFirstLine).toHaveProperty("Draft.md")
    expect(created.path).toBe("Draft.md")
  })

  it("never renames existing files on its own", async () => {
    const { call } = await setup({ "Meeting.md": "# Something else" })
    const [file] = (await call("docs.list")).files
    const written = await call("docs.write", { path: "Meeting.md", content: "# Changed", expectedModifiedAt: file.modifiedAt })
    expect(written.path).toBe("Meeting.md")
  })

  it("makes names unique and allows a change of case", async () => {
    const { call } = await setup({ "a/One.md": "1", "a/Two.md": "2" })
    expect((await call("docs.rename", { path: "a/Two.md", name: "One" })).path).toBe("a/One 2.md")
    expect((await call("docs.rename", { path: "a/One.md", name: "one" })).path).toBe("a/one.md")
    expect((await call("docs.createFolder", { path: "a" })).path).toBe("a 2")
  })
})

describe("folders, moves and deletes", () => {
  it("moves files and folders, carrying ids", async () => {
    const { call, exists } = await setup({ "a/x.md": "x", "b/y.md": "y" })
    const before = (await call("docs.list")).files.find((f: any) => f.path === "a/x.md")
    expect((await call("docs.move", { path: "a/x.md", folder: "b" })).path).toBe("b/x.md")
    expect((await call("docs.move", { path: "b", folder: "a" })).path).toBe("a/b")
    expect(exists("a/b/x.md")).toBe(true)
    const after = (await call("docs.list")).files.find((f: any) => f.path === "a/b/x.md")
    expect(after.id).toBe(before.id)
    const error = await call("docs.move", { path: "a", folder: "a/b" }).catch((e) => e)
    expect(error.code).toBe(RpcErrorCode.InvalidParams)
  })

  it("sends deletes to the trash and restores from the kept text", async () => {
    const { call, trashed, root } = await setup({ "a/x.md": "x" })
    await call("docs.delete", { path: "a" })
    expect(trashed).toEqual([path.join(root, "a")])
    const restored = await call("docs.restore", { files: [{ id: "k", path: "a/x.md", content: "x" }], folders: ["a"] })
    expect(restored.files[0]).toMatchObject({ id: "k", path: "a/x.md" })
  })

  it("refuses paths outside Docs", async () => {
    const { call } = await setup()
    for (const p of ["../x.md", "/etc/passwd", ".owlit/workspace.json", "library/papers/a/paper.json", "a/../../x.md"]) {
      const error = await call("docs.read", { path: p }).catch((e) => e)
      expect(error.code, p).toBe(RpcErrorCode.InvalidParams)
    }
  })

  it("needs a workspace", async () => {
    const core = new Core({ userDataDir: mkdtempSync(path.join(tmpdir(), "owlit-none-")) })
    cores.push(core)
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "docs.list" })
    expect("error" in response && response.error.code).toBe(RpcErrorCode.NoWorkspace)
  })
})

describe("docs.reveal", () => {
  it("shows a file or folder that exists, and refuses one that doesn't or lies outside", async () => {
    const { call, revealed, root } = await setup({ "a/x.md": "x" })
    await call("docs.reveal", { path: "a/x.md" })
    await call("docs.reveal", { path: "a" })
    expect(revealed).toEqual([path.join(root, "a/x.md"), path.join(root, "a")])
    await expect(call("docs.reveal", { path: "a/gone.md" })).rejects.toThrow()
    await expect(call("docs.reveal", { path: "../outside" })).rejects.toThrow()
    expect(revealed).toHaveLength(2)
  })
})
