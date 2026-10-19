import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { knownProfile, ME, until } from "../test-util.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup(files: Record<string, string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-comments-")))
  const root = path.join(base, "ws")
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")) })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  await call("docs.list")
  const sidecar = (rel: string) => path.join(root, ".owlit/docs/comments", `${rel}.jsonl`)
  return { root, core, call, sidecar }
}

const comment = (id: string, createdAt = 1) => ({
  id,
  quote: "the words",
  prefix: "a ",
  suffix: " b",
  entries: [{ id: `${id}-e`, by: ME, agent: "Claude Code", text: `comment ${id}`, at: createdAt }],
  createdAt,
})

describe("comments", () => {
  it("keeps comments beside the doc, one per line, in the order written", async () => {
    const { call, sidecar } = await setup({ "w/a.md": "a the words b" })
    await call("comments.add", { path: "w/a.md", comment: comment("n2", 2) })
    await call("comments.add", { path: "w/a.md", comment: comment("n1", 1) })
    expect(readFileSync(sidecar("w/a.md"), "utf8").trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["n1", "n2"])
    expect(await call("comments.all")).toEqual({ "w/a.md": [comment("n1", 1), comment("n2", 2)] })
  })

  it("removes, puts back and re-anchors", async () => {
    const { call, sidecar } = await setup({ "a.md": "x" })
    await call("comments.add", { path: "a.md", comment: comment("n1") })
    expect(await call("comments.remove", { path: "a.md", id: "n1" })).toEqual(comment("n1"))
    expect(existsSync(sidecar("a.md"))).toBe(false)
    await call("comments.add", { path: "a.md", comment: comment("n1") })
    await call("comments.reanchor", { path: "a.md", moved: { n1: { quote: "new words", prefix: "", suffix: "" } } })
    expect((await call("comments.all"))["a.md"][0]).toMatchObject({ id: "n1", quote: "new words", entries: [{ text: "comment n1" }] })
  })

  it("follows renames and moves made in owlit, files and folders", async () => {
    const { call } = await setup({ "f/a.md": "x", "g/keep.md": "k" })
    await call("comments.add", { path: "f/a.md", comment: comment("n1") })
    await call("docs.rename", { path: "f/a.md", name: "b" })
    await call("docs.move", { path: "f", folder: "g" })
    expect(Object.keys(await call("comments.all"))).toEqual(["g/f/b.md"])
  })

  it("trashes comments with their doc and brings them back on restore", async () => {
    const { call, root } = await setup({ "f/a.md": "x" })
    await call("comments.add", { path: "f/a.md", comment: comment("n1") })
    await call("docs.delete", { path: "f" })
    expect(await call("comments.all")).toEqual({})
    expect(existsSync(path.join(root, ".owlit/trash"))).toBe(true)
    await call("docs.restore", { files: [{ id: "x", path: "f/a.md", content: "x" }], folders: ["f"] })
    expect(Object.keys(await call("comments.all"))).toEqual(["f/a.md"])
  })

  it("follows a rename made outside owlit", async () => {
    const { call, root, core } = await setup({ "a.md": "x" })
    await call("comments.add", { path: "a.md", comment: comment("n1") })
    // A watcher only just started can miss a change: write a file from outside until it is heard, so the
    // rename, which can't be made twice, comes once the watcher is live
    let probed = false
    core.onNotify((n) => {
      if (n.method === "docs.changed" && (n.params as { changed: { path: string }[] }).changed.some((f) => f.path === "probe.md")) probed = true
    })
    await vi.waitFor(
      () => {
        if (!probed) writeFileSync(path.join(root, "probe.md"), "probe")
        expect(probed).toBe(true)
      },
      { timeout: 4_000, interval: 500 },
    )
    renameSync(path.join(root, "a.md"), path.join(root, "renamed.md"))
    await until(async () => (await call("comments.all"))["renamed.md"], { what: "the comments to follow the rename" })
    expect(Object.keys(await call("comments.all"))).toEqual(["renamed.md"])
  })

  it("replaces a comment as it reads now: a reply, then resolved", async () => {
    const { call } = await setup({ "a.md": "x" })
    await call("comments.add", { path: "a.md", comment: comment("n1") })
    const replied = { ...comment("n1"), entries: [...comment("n1").entries, { id: "r1", by: ME, text: "ok", at: 2 }] }
    expect(await call("comments.put", { path: "a.md", comment: replied })).toEqual(comment("n1"))
    await call("comments.put", { path: "a.md", comment: { ...replied, resolvedAt: 3 } })
    expect((await call("comments.all"))["a.md"]).toEqual([{ ...replied, resolvedAt: 3 }])
  })

  it("signs each entry by who wrote it and records the window's comments, replies, resolves and removals", async () => {
    const { call } = await setup({ "a.md": "a the words b" })
    // A client can't sign for anyone: whatever it says, the window is the person
    await call("comments.add", { path: "a.md", comment: { ...comment("n1"), entries: [{ ...comment("n1").entries[0], by: "o_1234abcd" }] } })
    const [added] = (await call("comments.all"))["a.md"]
    expect(added.entries[0].by).toBe(ME)
    await call("comments.put", { path: "a.md", comment: { ...added, entries: [...added.entries, { id: "r1", text: "ok", at: 2 }] } })
    await call("comments.put", { path: "a.md", comment: { ...(await call("comments.all"))["a.md"][0], resolvedAt: 3 } })
    await call("comments.remove", { path: "a.md", id: "n1" })
    const entries = (await call("changes.list", { target: { kind: "comment", path: "a.md" } })).reverse()
    expect(entries.map((c: any) => [c.action, c.target.part, c.actor, c.origin.via])).toEqual([
      ["create", "n1", ME, "editor"],
      ["create", "n1/r1", ME, "editor"],
      ["update", "n1", ME, "editor"],
      ["delete", "n1", ME, "editor"],
    ])
    expect(entries[1].after).toMatchObject({ id: "r1", by: ME, text: "ok" })
    expect(entries[2]).toMatchObject({ before: { id: "n1" }, after: { id: "n1", resolvedAt: 3 } })
    expect(entries[2].after.entries).toBeUndefined()
  })
})
