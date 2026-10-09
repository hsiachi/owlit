import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Core } from "@owlit/core"
import type { UiRequest } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const MAIN = path.join(import.meta.dirname, "main.ts")
const fixtures = path.join(import.meta.dirname, "../../core/src/library/fixtures")

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined)
})

// A core with its workspace on a socket, and owlit-mcp started for it as an agent would start it
async function setup(options: { open?: boolean; routes?: Record<string, string> } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-mcp-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const dir = realpathSync(mkdtempSync("/tmp/owm-"))
  const fetch = (async (url: string) => {
    const match = Object.entries(options.routes ?? {}).find(([pattern]) => url.includes(pattern))
    return match ? new Response(match[1]) : new Response("", { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir }, host: { fetch }, retryBaseMs: 1 })
  cleanups.push(() => core.dispose())
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  if (options.open !== false) await call("workspace.open", { path: root })
  const transport = new StdioClientTransport({ command: process.execPath, args: [MAIN, "--workspace", root, "--socket-dir", dir, "--chat", "chat-1"], stderr: "pipe" })
  const mcp = new Client({ name: "test-agent", version: "1" })
  await mcp.connect(transport)
  cleanups.push(() => mcp.close())
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
    return { text: result.content.map((c) => c.text).join(""), isError: !!result.isError }
  }
  return { root, core, call, mcp, tool }
}

describe("owlit-mcp", () => {
  it("lists owlit's tools and tells the agent how to work", async () => {
    const { mcp } = await setup()
    const { tools } = await mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["library_list", "library_read", "library_search", "library_add", "docs_add_note", "chats_read"]))
    expect(mcp.getInstructions()).toMatch(/owlit/)
  })

  it("lists and reads the library", async () => {
    const { root, call, tool } = await setup()
    expect((await tool("library_list")).text).toBe("The library is empty.")
    await call("library.add", { paper: { id: "arxiv-1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    writeFileSync(path.join(root, "library/papers/arxiv-1706.03762/text.md"), "<!-- page 1 -->\n\n## 1 Introduction\n\nRecurrent models.\n\n<!-- page 2 -->\n\n## 2 Attention\n\nScaled dot-product attention.\n")
    expect((await tool("library_list")).text).toMatch(/^- arxiv-1706\.03762 · Attention Is All You Need · Vaswani et al\., 2017 · unread, no PDF$/)
    expect((await tool("library_read", { id: "arxiv-1706.03762", pages: "2" })).text).toBe("<!-- page 2 -->\n\n## 2 Attention\n\nScaled dot-product attention.\n\n\n(The paper has 2 pages.)")
    expect((await tool("library_read", { id: "arxiv-1706.03762", section: "introduction" })).text).toMatch(/^## 1 Introduction\n\nRecurrent models\./)
    expect(JSON.parse((await tool("library_get", { id: "arxiv-1706.03762" })).text)).toMatchObject({ cite: "[Vaswani et al. 2017](owlit://library/arxiv-1706.03762)", highlights: 0 })
  })

  it("searches outside the library, records the search, and adds as the agent", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const routes: Record<string, string> = { "api.openalex.org/works?search": JSON.stringify({ results: [JSON.parse(openalex)] }) }
    const { root, tool, call } = await setup({ routes })
    const found = await tool("library_search", { query: "historical newspapers question answering" })
    expect(found.text).toMatch(/^- doi-10\.1145-3626772\.3657891 · ChroniclingAmericaQA/)
    const searches = readFileSync(path.join(root, ".owlit/searches.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(searches).toMatchObject([{ query: "historical newspapers question answering", by: "chat:chat-1", results: ["doi-10.1145-3626772.3657891"] }])
    // What a search just found is added without asking the services again
    expect((await tool("library_add", { ref: "doi-10.1145-3626772.3657891" })).text).toMatch(/^Added doi-10\.1145-3626772\.3657891/)
    expect((await call("library.list")).papers[0]).toMatchObject({ addedBy: "agent" })
    routes["api.openalex.org/works/doi:10.1145"] = openalex
    expect((await tool("library_add", { ref: "10.1145/3626772.3657891" })).text).toMatch(/^Already in the library as doi-10\.1145-3626772\.3657891/)
  })

  it("leaves a note on a doc without changing the file", async () => {
    const { root, core, call, tool } = await setup()
    const doc = "# Related work\n\nFirst paragraph.\n\nSecond paragraph argues that attention\nis all you need.\n"
    writeFileSync(path.join(root, "Related work.md"), doc)
    const told: unknown[] = []
    core.onNotify((n) => n.method === "notes.added" && told.push(n.params))
    const result = await tool("docs_add_note", { path: "Related work.md", quote: "attention is all you need", note: "Cite Vaswani 2017 here." })
    expect(result.isError).toBe(false)
    expect(readFileSync(path.join(root, "Related work.md"), "utf8")).toBe(doc)
    const notes = await call("notes.all")
    expect(notes["Related work.md"]).toMatchObject([{ quote: "attention\nis all you need", text: "Cite Vaswani 2017 here.", by: "Owlit", chatId: "chat-1" }])
    // Windows hear of it, so the note shows up in an open doc
    expect(told).toMatchObject([{ path: "Related work.md", note: { text: "Cite Vaswani 2017 here." } }])
    expect((await tool("docs_add_note", { path: "Related work.md", quote: "not in the doc", note: "x" })).text).toMatch(/isn't in Related work\.md word for word/)
  })

  it("shows things in the window the user is in", async () => {
    const { core, call, tool } = await setup()
    expect(await tool("ui_open", { uri: "owlit://library/arxiv-1706.03762" })).toEqual({ text: "No owlit window is open.", isError: true })

    // A window: it answers what it can show and refuses what isn't there
    const asked: UiRequest[] = []
    core.onNotify((n) => {
      if (n.method !== "ui.request") return
      const req = n.params as UiRequest
      asked.push(req)
      const answer =
        req.method === "open" ? { result: { title: "Attention Is All You Need" } }
        : req.method === "jump" ? { result: { title: "Related work", found: false } }
        : req.method === "mark" ? { error: "That paper isn't in the library." }
        : { result: null }
      void call("ui.respond", { requestId: req.requestId, ...answer })
    })
    await call("ui.focus", { clientId: "w1" })
    await call("ui.focus", { clientId: "w2" })
    expect(await tool("ui_open", { uri: "owlit://library/arxiv-1706.03762" })).toEqual({ text: "Showing Attention Is All You Need in owlit.", isError: false })
    // The window the user was in last
    expect(asked[0]).toMatchObject({ clientId: "w2", method: "open", params: { uri: "owlit://library/arxiv-1706.03762" } })
    expect((await tool("ui_jump", { uri: "owlit://docs/Related work.md", quote: "Second paragraph" })).text).toMatch(/^Opened Related work, but that passage isn't in it/)
    expect(asked[1]).toMatchObject({ method: "jump", params: { uri: "owlit://docs/Related work.md", quote: "Second paragraph" } })
    expect(await tool("ui_mark", { id: "doi-10.1-nope", quote: "x" })).toEqual({ text: "That paper isn't in the library.", isError: true })
    expect(asked[2]).toMatchObject({ method: "mark", params: { uri: "owlit://library/doi-10.1-nope", quote: "x" } })
    // The asking chat goes along, so the window can keep it in view
    expect(asked[2].params).toMatchObject({ chatId: "chat-1" })
    // Windows that closed are not asked
    await call("ui.leave", { clientId: "w2" })
    await call("ui.leave", { clientId: "w1" })
    expect(await tool("ui_open", { uri: "owlit://library/arxiv-1706.03762" })).toEqual({ text: "No owlit window is open.", isError: true })
  })

  it("reads and writes Knowledge, refusing what breaks the rules", async () => {
    const { root, call, tool } = await setup()
    expect((await tool("knowledge_read")).text).toMatch(/^There are no topics yet\.\n\nA topic file:/)
    await call("library.add", { paper: { id: "arxiv-2005.11401", title: "Retrieval-Augmented Generation", authors: ["Patrick Lewis", "Ethan Perez"], ids: { arxiv: "2005.11401" }, year: 2020 } })
    const quote = "In the RAG-Token model we can draw a different latent document for each target token"
    writeFileSync(path.join(root, "library/papers/arxiv-2005.11401/text.md"), `<!-- page 3 -->\n\nRAG-Token Model ${quote} and marginalize accordingly.\n`)

    const nine = Array.from({ length: 9 }, (_, i) => `- Owlit thinks: Point ${i + 1}.`).join("\n")
    const tooLong = await tool("knowledge_write", { topic: "Retrieval granularity", content: `# Retrieval granularity\n\n## Understanding\n\n${nine}\n`, why: "you read Lewis et al. 2020" })
    expect(tooLong).toEqual({ isError: true, text: "owlit didn't write it:\n- Understanding has 9 lines; at most 7, so 2 too many. Merge lines, or say in your answer that the topic should be split." })

    const content = "# Retrieval granularity\n\nPer-token retrieval lets one answer draw on several documents.\n\n## Understanding\n\n- Lewis et al. 2020: RAG-Token can use a different document for each token.\n  - [§2.1](owlit://library/arxiv-2005.11401#passage=rag-token)\n"
    const passages = JSON.stringify([{ id: "rag-token", paper: "arxiv-2005.11401", quote }])
    expect(await tool("knowledge_write", { topic: "Retrieval granularity", content, why: "you highlighted §2.1", passages })).toEqual({
      isError: false,
      text: "Wrote knowledge/Retrieval granularity.md: Started, Added ^s1.",
    })
    expect((await tool("knowledge_read")).text).toMatch(/^- retrieval-granularity · Retrieval granularity · 1 line, 0 questions · updated \d{4}-/)
    expect((await tool("knowledge_read", { topic: "retrieval-granularity" })).text).toMatch(/^knowledge\/Retrieval granularity\.md \(id retrieval-granularity\)\n\n---\nid: retrieval-granularity/)
    expect((await tool("knowledge_write", { topic: "Retrieval granularity", content, why: "x", passages: "not json" })).text).toMatch(/^passages should be a JSON array/)
  })

  it("lets the user undo an agent's note and paper, and undo the undo", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const { root, core, call, tool } = await setup({ routes: { "api.openalex.org/works/doi:10.1145": openalex } })
    const changed: { kind: string; versionId: string; label: string; chatId?: string }[] = []
    const removed: unknown[] = []
    core.onNotify((n) => {
      if (n.method === "agent.changed") changed.push(n.params as (typeof changed)[number])
      if (n.method === "notes.removed") removed.push(n.params)
    })
    writeFileSync(path.join(root, "Draft.md"), "# Draft\n\nAttention is all you need.\n")
    await tool("docs_add_note", { path: "Draft.md", quote: "all you need", note: "Cite it." })
    await tool("library_add", { ref: "10.1145/3626772.3657891" })
    expect(changed).toMatchObject([
      { kind: "note", label: "Draft", chatId: "chat-1" },
      { kind: "paper", label: expect.stringMatching(/^ChroniclingAmericaQA/), chatId: "chat-1" },
    ])

    const note = await call("versions.restore", { id: changed[0].versionId })
    expect((await call("notes.all"))["Draft.md"]).toBeUndefined()
    expect(removed).toMatchObject([{ path: "Draft.md" }])
    await call("versions.restore", { id: note.redoId })
    expect((await call("notes.all"))["Draft.md"]).toMatchObject([{ text: "Cite it." }])

    const paper = await call("versions.restore", { id: changed[1].versionId })
    expect((await call("library.list")).papers).toEqual([])
    await call("versions.restore", { id: paper.redoId })
    expect((await call("library.list")).papers).toMatchObject([{ id: "doi-10.1145-3626772.3657891", addedBy: "agent" }])
  })

  it("answers mistakes in a sentence instead of failing", async () => {
    const { tool } = await setup()
    expect(await tool("library_get")).toEqual({ text: "library_get needs id.", isError: true })
    expect(await tool("library_list", { limit: "ten" })).toEqual({ text: "limit should be a number.", isError: true })
    expect(await tool("library_read", { id: "doi-10.1-nope" })).toMatchObject({ isError: true, text: "That paper is not in the library." })
  })

  it("says so when owlit isn't open with the workspace", async () => {
    const { tool } = await setup({ open: false })
    expect(await tool("library_list")).toEqual({ text: "owlit isn't open with ws. Open it in owlit first.", isError: true })
  })
})
