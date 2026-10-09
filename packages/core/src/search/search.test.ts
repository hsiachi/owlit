import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { linksIn, toMatch } from "./index-db.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

function workspaceFolder() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-search-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  return { base, root }
}

function putPaper(root: string, id: string, title: string, text = "", extra: object = {}) {
  const dir = path.join(root, "library/papers", id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, id, ids: { doi: `10.1/${id}` }, title, authors: ["A. Author"], fields: {}, ...extra }))
  if (text) writeFileSync(path.join(dir, "text.md"), `<!-- page 1 -->\n\n${text}\n`)
}

async function open(base: string, root: string) {
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  // The first sync waits for things to settle; run it now
  const synced = () => workspace.tasks.run("index.sync", "workspace", "waiting")
  await synced()
  return { core, call, workspace, synced }
}

describe("search index", () => {
  it("puts papers with every word in the title before those with the words only in their text", async () => {
    const { base, root } = workspaceFolder()
    putPaper(root, "body", "A study of sequence models", "We use attention throughout, and a transformer encoder.")
    putPaper(root, "title", "Attention in the transformer", "Nothing more to say.")
    putPaper(root, "neither", "Unrelated", "Only attention here.")
    const { call } = await open(base, root)
    const { papers } = await call("search.palette", { q: "attention transformer" })
    expect(papers.map((p: { key: string }) => p.key)).toEqual(["title", "body"])
    expect(papers[0].inTitle).toBe(true)
    expect(papers[1].snippet).toMatch(/attention/i)
    // Words are matched as the start of a word
    expect((await call("search.papers", { q: "transf" })).map((p: { key: string }) => p.key).sort()).toEqual(["body", "title"])
    // Find in the Library asks for the matched words marked, to show where they were
    const [hit] = await call("search.papers", { q: "encoder", marked: true })
    expect(hit).toMatchObject({ key: "body", snippet: expect.stringContaining("transformer \uE000encoder\uE001") })
  })

  it("finds docs and chats, and keeps up with changes", async () => {
    const { base, root } = workspaceFolder()
    writeFileSync(path.join(root, "draft.md"), "# Margins\n\nNotes on marginalia and reading.")
    const { call, synced } = await open(base, root)
    expect((await call("search.palette", { q: "marginalia" })).docs).toMatchObject([{ key: "draft.md", title: "Margins" }])
    await call("docs.write", { path: "draft.md", content: "# Margins\n\nNow about footnotes.", expectedModifiedAt: 0, force: true })
    await synced()
    expect((await call("search.palette", { q: "marginalia" })).docs).toEqual([])
    expect((await call("search.palette", { q: "footnotes" })).docs).toHaveLength(1)
    await call("chats.create", { chat: { id: "c1", title: "About footnotes", createdAt: 1, updatedAt: 1, pinned: false } })
    await call("chats.appendMessage", { id: "c1", message: { id: "m1", role: "user", parts: [{ type: "text", text: "Where do footnotes go?" }], createdAt: 2 } })
    await synced()
    expect((await call("search.palette", { q: "footnotes" })).chats).toMatchObject([{ key: "c1", title: "About footnotes" }])
    await call("docs.delete", { path: "draft.md" }).catch(() => {})
  })

  it("knows what mentions a paper, under any id it has had", async () => {
    const { base, root } = workspaceFolder()
    putPaper(root, "doi-10.1-x", "Cited paper")
    writeFileSync(path.join(root, "essay.md"), "# Essay\n\nAs [Author 2020](owlit://library/doi-10.1-x) says.")
    writeFileSync(path.join(root, "old.md"), "# Old\n\nSee [the scan](owlit://library/local-abc123).")
    mkdirSync(path.join(root, ".owlit/papers"), { recursive: true })
    writeFileSync(path.join(root, ".owlit/papers/aliases.json"), JSON.stringify({ version: 1, aliases: { "local-abc123": "doi-10.1-x" } }))
    const { call, synced } = await open(base, root)
    const links = await call("links.to", { uri: "owlit://library/doi-10.1-x" })
    expect(links.map((l: { key: string }) => l.key).sort()).toEqual(["essay.md", "old.md"])
    writeFileSync(path.join(root, "essay.md"), "# Essay\n\nNo mention now.")
    await synced()
    expect((await call("links.to", { uri: "owlit://library/doi-10.1-x" })).map((l: { key: string }) => l.key)).toEqual(["old.md"])
  })

  it("reads everything again when index.db is gone", async () => {
    const { base, root } = workspaceFolder()
    putPaper(root, "p", "Persistent paper")
    const first = await open(base, root)
    expect((await first.call("search.status")).papers).toBe(1)
    const file = path.join(first.workspace.dataDir, "index.db")
    await first.core.dispose()
    for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true })
    const again = await open(base, root)
    expect(existsSync(file)).toBe(true)
    expect((await again.call("search.palette", { q: "persistent" })).papers).toHaveLength(1)
    await again.call("search.rebuild")
    await again.synced()
    expect((await again.call("search.palette", { q: "persistent" })).papers).toHaveLength(1)
  })

  it("indexes 300 papers and 500 docs quickly and answers in milliseconds", async () => {
    const { base, root } = workspaceFolder()
    const words = "retrieval attention transformer sensemaking margins absence interface reading writing cognition".split(" ")
    const body = (i: number) => Array.from({ length: 400 }, (_, j) => words[(i * 7 + j) % words.length]).join(" ")
    for (let i = 0; i < 300; i++) putPaper(root, `doi-10.1-p${i}`, `Paper ${i} on ${words[i % words.length]}`, body(i))
    mkdirSync(path.join(root, "notes"))
    for (let i = 0; i < 500; i++) writeFileSync(path.join(root, "notes", `n${i}.md`), `# Note ${i}\n\n${body(i).slice(0, 2000)}`)
    let started = performance.now()
    const { call, synced, core } = await open(base, root)
    const first = performance.now() - started
    started = performance.now()
    await call("search.palette", { q: "attention trans" })
    const query = performance.now() - started
    await core.dispose()
    started = performance.now()
    const again = await open(base, root)
    const incremental = performance.now() - started
    expect((await again.call("search.status")).papers).toBe(300)
    console.log(`first index ${Math.round(first)}ms, query ${query.toFixed(1)}ms, reopen ${Math.round(incremental)}ms`)
    expect(first).toBeLessThan(60_000)
    expect(incremental).toBeLessThan(3_000)
    expect(query).toBeLessThan(50)
    void synced
  }, 120_000)
})

describe("helpers", () => {
  it("turns words into a prefix AND query", () => {
    expect(toMatch("Attention, transformer!")).toBe('"attention"* AND "transformer"*')
    expect(toMatch("  ")).toBe("")
  })

  it("finds owlit mentions and wikilinks", () => {
    expect(linksIn("[A](owlit://library/doi-10.1-x#p3) and [[Reading notes|notes]] and owlit://docs/a%20b.md")).toEqual([
      { to: "owlit://library/doi-10.1-x", kind: "mention" },
      { to: "owlit://docs/a b.md", kind: "mention" },
      { to: "wikilink:Reading notes", kind: "wikilink" },
    ])
  })
})
