import { RpcErrorCode, type PaperRecord } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

// A core whose network serves recorded responses
async function setup(routes: Record<string, string | number>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-library-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(url)
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    return typeof match[1] === "number" ? new Response("", { status: match[1] }) : new Response(match[1])
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  return { root, call, asked, core }
}

const published = {
  "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
  "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
}

function putPaper(root: string, record: Partial<PaperRecord> & { id: string }) {
  const dir = path.join(root, "library/papers", record.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, title: "?", authors: [], fields: {}, ...record }))
}

describe("library over RPC", () => {
  it("resolves a pasted DOI link into a preview with its library id", async () => {
    const { call } = await setup(published)
    const { paper, existingId } = await call("library.resolve", { input: "https://doi.org/10.1145/3626772.3657891" })
    expect(existingId).toBeUndefined()
    expect(paper).toMatchObject({ id: "doi-10.1145-3626772.3657891", year: 2024, kind: "conference", ids: { arxiv: "2403.17859" } })
  })

  it("finds a paper the library has under another of its ids, without asking anyone", async () => {
    const { root, call, asked } = await setup({})
    putPaper(root, { id: "arxiv-2403.17859", title: "ChroniclingAmericaQA", ids: { arxiv: "2403.17859", doi: "10.1145/3626772.3657891" } })
    const { existingId, paper } = await call("library.resolve", { input: "10.1145/3626772.3657891" })
    expect(existingId).toBe("arxiv-2403.17859")
    expect(paper.title).toBe("ChroniclingAmericaQA")
    expect(asked).toEqual([])
    expect(await call("library.known", { inputs: ["arXiv:2403.17859v2", "10.9999/x", "words"] })).toEqual(["arxiv-2403.17859", null, null])
  })

  it("answers in sentences when it can't", async () => {
    const { call } = await setup({ "api.openalex.org": 503, "api.semanticscholar.org": 503 })
    await expect(call("library.resolve", { input: "hello there" })).rejects.toMatchObject({ code: RpcErrorCode.NotFound })
    await expect(call("library.resolve", { input: "10.1145/3626772.3657891" })).rejects.toMatchObject({
      code: RpcErrorCode.Unavailable,
      message: "api.openalex.org is having trouble right now.",
    })
  })

  it("paper.metadata rewrites paper.json, keeps the sources and keeps fields the services lack", async () => {
    const { root, core } = await setup(published)
    putPaper(root, { id: "doi-10.1145-3626772.3657891", title: "Old title", ids: { doi: "10.1145/3626772.3657891" }, venue: "kept?" })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    const done = await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")
    expect(done.state).toBe("done")
    const dir = path.join(root, "library/papers/doi-10.1145-3626772.3657891")
    const record = JSON.parse(readFileSync(path.join(dir, "paper.json"), "utf8")) as PaperRecord
    expect(record).toMatchObject({
      id: "doi-10.1145-3626772.3657891",
      ids: { doi: "10.1145/3626772.3657891", arxiv: "2403.17859", openalex: "W4393248081" },
      year: 2024,
      kind: "conference",
      fields: { title: "openalex", tldr: "s2" },
      pdfUrls: ["https://arxiv.org/pdf/2403.17859"],
    })
    expect(record.title).toMatch(/^ChroniclingAmericaQA/)
    expect(record.fetchedAt).toBeGreaterThan(0)
    expect(existsSync(path.join(dir, "sources/openalex.json"))).toBe(true)
    expect(existsSync(path.join(dir, "sources/s2.json"))).toBe(true)
  })

  it("paper.metadata leaves a paper nobody can be asked about alone", async () => {
    const { root, core, asked } = await setup({})
    putPaper(root, { id: "local-abc123", title: "Scanned notes", ids: {} })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    expect((await workspace.tasks.run("paper.metadata", "local-abc123")).state).toBe("done")
    expect(asked).toEqual([])
  })
})

describe("library on disk", () => {
  const resolvedArxiv = { id: "arxiv-1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 }

  it("adds a paper as paper.json and state.json, lists it, and keeps it across a restart", async () => {
    const { root, call, core } = await setup({ "export.arxiv.org": fixture("arxiv-1706.03762.xml") })
    const paper = await call("library.add", { paper: resolvedArxiv })
    expect(paper).toMatchObject({ id: "arxiv-1706.03762", status: "unread", starred: false, addedBy: "user", tags: [] })
    expect(existsSync(path.join(root, "library/papers/arxiv-1706.03762/paper.json"))).toBe(true)
    const state = JSON.parse(readFileSync(path.join(root, ".owlit/papers/arxiv-1706.03762/state.json"), "utf8"))
    expect(state).toMatchObject({ version: 1, addedBy: "user", status: "unread" })
    // Added twice, by another of its ids: one paper
    expect((await call("library.add", { paper: { ...resolvedArxiv, id: undefined } })).id).toBe("arxiv-1706.03762")
    await core.dispose()
    const again = new Core({ userDataDir: path.join(path.dirname(root), "userData"), retryBaseMs: 1 })
    cores.push(again)
    await again.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const listed = await again.handle({ jsonrpc: "2.0", id: 2, method: "library.list" })
    expect((listed as any).result.papers.map((p: { id: string }) => p.id)).toEqual(["arxiv-1706.03762"])
  })

  it("keeps the user's judgement, position, highlights and note, in readable files", async () => {
    const { root, call } = await setup({})
    await call("library.add", { paper: resolvedArxiv })
    const id = "arxiv-1706.03762"
    await call("library.update", { id, patch: { starred: true, status: "reading", tags: ["attention"], position: { page: 3, y: 120 }, lastOpenedAt: 5 } })
    await call("library.putHighlight", {
      highlight: { id: "h1", paperId: id, page: 2, rects: [{ page: 2, x: 1, y: 2, w: 3, h: 4 }], text: "scaled dot-product", color: "yellow", createdAt: 1 },
    })
    await call("library.putHighlight", {
      highlight: { id: "h1", paperId: id, page: 2, rects: [{ page: 2, x: 1, y: 2, w: 3, h: 4 }], text: "scaled dot-product", color: "green", comment: "key idea", createdAt: 1 },
    })
    const note = await call("library.setNote", { paperId: id, content: "# Notes\n\nSee [Vaswani 2017](owlit://library/arxiv-1706.03762).\n" })
    expect(note.updatedAt).toBeGreaterThan(0)

    const { papers, highlights, notes } = await call("library.list")
    expect(papers[0]).toMatchObject({ starred: true, status: "reading", tags: ["attention"], position: { page: 3, y: 120 }, lastOpenedAt: 5 })
    expect(highlights).toMatchObject([{ id: "h1", color: "green", comment: "key idea" }])
    expect(notes[0].content).toMatch(/^# Notes/)
    expect(readFileSync(path.join(root, ".owlit/papers", id, "note.md"), "utf8")).toBe("# Notes\n\nSee [Vaswani 2017](owlit://library/arxiv-1706.03762).\n")
    expect(await call("library.removeHighlight", { paperId: id, id: "h1" })).toMatchObject({ id: "h1" })
    expect((await call("library.list")).highlights).toEqual([])
  })

  it("keeps a title the user corrected when the metadata is fetched again", async () => {
    const { root, call, core } = await setup(published)
    await call("library.add", { paper: { id: "doi-10.1145-3626772.3657891", title: "?", authors: [], ids: { doi: "10.1145/3626772.3657891" } } })
    await call("library.update", { id: "doi-10.1145-3626772.3657891", patch: { title: "My title", year: undefined } })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")
    const paper = await call("library.list").then((l) => l.papers[0])
    expect(paper.title).toBe("My title")
    expect(paper.year).toBeUndefined()
    expect(paper.venue).toMatch(/SIGIR/)
    const record = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.json"), "utf8"))
    expect(record.title).toMatch(/^ChroniclingAmericaQA/)
    // Set back to what the record says: no longer an override
    await call("library.update", { id: "doi-10.1145-3626772.3657891", patch: { title: record.title } })
    const state = JSON.parse(readFileSync(path.join(root, ".owlit/papers/doi-10.1145-3626772.3657891/state.json"), "utf8"))
    expect(state.overrides).toEqual({ year: null })
  })

  it("moves a removed paper to the trash and Undo brings it back whole", async () => {
    const { root, call } = await setup({})
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: resolvedArxiv })
    await call("library.setNote", { paperId: id, content: "kept" })
    await call("library.putHighlight", { highlight: { id: "h", paperId: id, page: 0, rects: [], text: "t", color: "blue", createdAt: 1 } })
    await call("library.remove", { ids: [id] })
    expect(existsSync(path.join(root, "library/papers", id))).toBe(false)
    expect((await call("library.list")).papers).toEqual([])
    expect(await call("library.known", { inputs: ["1706.03762"] })).toEqual([null])
    const [back] = await call("library.restore", { ids: [id] })
    expect(back.id).toBe(id)
    const { highlights, notes } = await call("library.list")
    expect(highlights).toHaveLength(1)
    expect(notes[0].content).toBe("kept")
    expect(await call("library.known", { inputs: ["1706.03762"] })).toEqual([id])
  })

  it("hears about a paper folder another program puts in library/papers", async () => {
    const { root, core } = await setup({})
    const heard: any[] = []
    core.onNotify((n) => n.method === "library.changed" && heard.push(n.params))
    // The system's watcher takes a moment to start after the workspace opens
    await new Promise((r) => setTimeout(r, 300))
    putPaper(root, { id: "arxiv-2408.00447", title: "Dropped in by the CLI", ids: { arxiv: "2408.00447" } })
    const started = Date.now()
    while (!heard.some((c) => c.papers.some((p: { id: string }) => p.id === "arxiv-2408.00447")) && Date.now() - started < 2000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    const paper = heard.flatMap((c) => c.papers).find((p) => p.id === "arxiv-2408.00447")
    expect(paper).toMatchObject({ title: "Dropped in by the CLI", status: "unread", addedBy: "user" })
  })
})
