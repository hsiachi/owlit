import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup(files: Record<string, string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-notes-")))
  const root = path.join(base, "ws")
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  await call("docs.list")
  const sidecar = (rel: string) => path.join(root, ".owlit/docs/notes", `${rel}.jsonl`)
  return { root, call, sidecar }
}

const note = (id: string, createdAt = 1) => ({ id, quote: "the words", prefix: "a ", suffix: " b", text: `note ${id}`, by: "Owlit", createdAt })

describe("notes", () => {
  it("keeps notes beside the doc, one per line, in the order written", async () => {
    const { call, sidecar } = await setup({ "w/a.md": "a the words b" })
    await call("notes.add", { path: "w/a.md", note: note("n2", 2) })
    await call("notes.add", { path: "w/a.md", note: note("n1", 1) })
    expect(readFileSync(sidecar("w/a.md"), "utf8").trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["n1", "n2"])
    expect(await call("notes.all")).toEqual({ "w/a.md": [note("n1", 1), note("n2", 2)] })
  })

  it("removes, puts back and re-anchors", async () => {
    const { call, sidecar } = await setup({ "a.md": "x" })
    await call("notes.add", { path: "a.md", note: note("n1") })
    expect(await call("notes.remove", { path: "a.md", id: "n1" })).toEqual(note("n1"))
    expect(existsSync(sidecar("a.md"))).toBe(false)
    await call("notes.add", { path: "a.md", note: note("n1") })
    await call("notes.reanchor", { path: "a.md", moved: { n1: { quote: "new words", prefix: "", suffix: "" } } })
    expect((await call("notes.all"))["a.md"][0]).toMatchObject({ id: "n1", quote: "new words", text: "note n1" })
  })

  it("follows renames and moves made in owlit, files and folders", async () => {
    const { call } = await setup({ "f/a.md": "x", "g/keep.md": "k" })
    await call("notes.add", { path: "f/a.md", note: note("n1") })
    await call("docs.rename", { path: "f/a.md", name: "b" })
    await call("docs.move", { path: "f", folder: "g" })
    expect(Object.keys(await call("notes.all"))).toEqual(["g/f/b.md"])
  })

  it("trashes notes with their doc and brings them back on restore", async () => {
    const { call, root } = await setup({ "f/a.md": "x" })
    await call("notes.add", { path: "f/a.md", note: note("n1") })
    await call("docs.delete", { path: "f" })
    expect(await call("notes.all")).toEqual({})
    expect(existsSync(path.join(root, ".owlit/trash"))).toBe(true)
    await call("docs.restore", { files: [{ id: "x", path: "f/a.md", content: "x" }], folders: ["f"] })
    expect(Object.keys(await call("notes.all"))).toEqual(["f/a.md"])
  })

  it("follows a rename made outside owlit", async () => {
    const { call, root } = await setup({ "a.md": "x" })
    await call("notes.add", { path: "a.md", note: note("n1") })
    await sleep(300)
    renameSync(path.join(root, "a.md"), path.join(root, "renamed.md"))
    for (let i = 0; i < 60 && !(await call("notes.all"))["renamed.md"]; i++) await sleep(25)
    expect(Object.keys(await call("notes.all"))).toEqual(["renamed.md"])
  })
})
