import type { DocsChange, RpcNotification } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup(files: Record<string, string> = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-watch-")))
  const root = path.join(base, "ws")
  mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const changes: DocsChange[] = []
  core.onNotify((n: RpcNotification) => n.method === "docs.changed" && changes.push(n.params as DocsChange))
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const listing = await call("docs.list")
  // FSEvents can deliver events from before the watcher started; let them pass
  await sleep(300)
  changes.length = 0
  const at = (rel: string) => path.join(root, rel)
  // Waits until the watcher has said something (or a while has passed)
  const settled = async (ms = 1500) => {
    const start = Date.now()
    while (!changes.length && Date.now() - start < ms) await sleep(25)
    await sleep(250)
    return changes.splice(0)
  }
  return { root, call, listing, changes, at, settled }
}

const merged = (changes: DocsChange[]) => ({
  changed: changes.flatMap((c) => c.changed),
  deleted: changes.flatMap((c) => c.deleted),
  created: changes.flatMap((c) => c.folders.created),
  folderDeleted: changes.flatMap((c) => c.folders.deleted),
  reload: changes.some((c) => c.reload),
})

describe("docs watcher", () => {
  it("hears an edit made by another program, with the new text", async () => {
    const { at, settled, listing } = await setup({ "a.md": "one" })
    writeFileSync(at("a.md"), "two")
    const m = merged(await settled())
    expect(m.changed).toHaveLength(1)
    expect(m.changed[0]).toMatchObject({ id: listing.files[0].id, path: "a.md", content: "two" })
  })

  it("keeps the id of a file renamed or moved outside", async () => {
    const { at, settled, listing } = await setup({ "a.md": "x", "sub/keep.md": "k" })
    const id = listing.files.find((f: any) => f.path === "a.md").id
    renameSync(at("a.md"), at("sub/b.md"))
    const m = merged(await settled())
    expect(m.changed.map((f) => [f.id, f.path])).toEqual([[id, "sub/b.md"]])
    expect(m.deleted).toEqual([])
  })

  it("reports deletes, new files and folders", async () => {
    const { at, settled } = await setup({ "gone.md": "x" })
    rmSync(at("gone.md"))
    mkdirSync(at("new/deeper"), { recursive: true })
    writeFileSync(at("new/deeper/n.md"), "n")
    const m = merged(await settled())
    expect(m.deleted.map((d) => d.path)).toEqual(["gone.md"])
    expect(m.created.sort()).toEqual(["new", "new/deeper"])
    expect(m.changed.map((f) => f.path)).toEqual(["new/deeper/n.md"])
  })

  it("follows a folder moved outside, with the files in it", async () => {
    const { at, settled, listing } = await setup({ "f/a.md": "a", "f/b.md": "b" })
    renameSync(at("f"), at("g"))
    const m = merged(await settled())
    expect(m.folderDeleted).toEqual(["f"])
    expect(m.created).toEqual(["g"])
    const ids = Object.fromEntries(listing.files.map((f: any) => [f.path, f.id]))
    expect(m.changed.map((f) => [f.path, f.id]).sort()).toEqual([["g/a.md", ids["f/a.md"]], ["g/b.md", ids["f/b.md"]]])
  })

  it("never echoes core's own changes", async () => {
    const { call, settled, listing } = await setup({ "a.md": "x" })
    const file = listing.files[0]
    const written = await call("docs.write", { path: "a.md", content: "y", expectedModifiedAt: file.modifiedAt })
    await call("docs.create", { path: "n.md", content: "# New", followsFirstLine: true })
    await call("docs.createFolder", { path: "folder" })
    await call("docs.move", { path: "a.md", folder: "folder" })
    await call("docs.rename", { path: "folder", name: "renamed" })
    await call("docs.write", { path: "renamed/a.md", content: "z", expectedModifiedAt: (await call("docs.read", { path: "renamed/a.md" })).modifiedAt })
    expect(written.path).toBe("a.md")
    expect(await settled(1200)).toEqual([])
  })

  it("ignores .owlit, library and dot-folders", async () => {
    const { at, settled } = await setup()
    mkdirSync(at("library/papers/p"), { recursive: true })
    writeFileSync(at("library/papers/p/paper.json"), "{}")
    mkdirSync(at(".git"), { recursive: true })
    writeFileSync(at(".git/HEAD"), "ref")
    writeFileSync(at(".owlit/x.json"), "{}")
    expect(await settled(1000)).toEqual([])
  })

  it("asks for a reload when too much changes at once", async () => {
    const { at, settled } = await setup()
    for (let i = 0; i < 300; i++) writeFileSync(at(`n${i}.md`), String(i))
    const m = merged(await settled())
    expect(m.reload).toBe(true)
  })
})
