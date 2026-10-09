import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Core } from "@owlit/core"
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
  return { root, call, mcp, tool }
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
    const { root, call, tool } = await setup()
    const doc = "# Related work\n\nFirst paragraph.\n\nSecond paragraph argues that attention\nis all you need.\n"
    writeFileSync(path.join(root, "Related work.md"), doc)
    const result = await tool("docs_add_note", { path: "Related work.md", quote: "attention is all you need", note: "Cite Vaswani 2017 here." })
    expect(result.isError).toBe(false)
    expect(readFileSync(path.join(root, "Related work.md"), "utf8")).toBe(doc)
    const notes = await call("notes.all")
    expect(notes["Related work.md"]).toMatchObject([{ quote: "attention\nis all you need", text: "Cite Vaswani 2017 here.", by: "Owlit", chatId: "chat-1" }])
    expect((await tool("docs_add_note", { path: "Related work.md", quote: "not in the doc", note: "x" })).text).toMatch(/isn't in Related work\.md word for word/)
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
