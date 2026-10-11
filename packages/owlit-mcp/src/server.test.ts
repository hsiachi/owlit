import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Core } from "@owlit/core"
import type { UiRequest } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { makePdf, paragraph } from "../../core/src/library/text/make-pdf.ts"
import { pdfFact } from "./server.ts"

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
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(decodeURIComponent(url.replace(/\+/g, " ")))
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
  return { root, core, call, mcp, tool, asked }
}

describe("pdfFact", () => {
  it("says why a paper has no PDF and what the user can do", () => {
    const doi = { doi: "10.1145/1" }
    expect(pdfFact({ pdf: { url: "owlit-pdf://doi-10.1145-1" }, ids: doi })).toBe("")
    expect(pdfFact({ ids: doi })).toBe("no PDF yet (still looking)")
    expect(pdfFact({ ids: doi, noPdf: { tried: ["browser:acm"], at: 1, needs: "check" } })).toMatch(/person to pass a check; the user can press Check now/)
    expect(pdfFact({ ids: doi, noPdf: { tried: ["browser:acm", "browser:acm:proxied"], at: 1 } })).toMatch(/library proxy didn't get it either/)
    expect(pdfFact({ ids: doi, noPdf: { tried: ["browser:acm"], at: 1 } })).toMatch(/no library proxy is set up/)
    expect(pdfFact({ ids: {}, noPdf: { tried: [], at: 1 } })).toMatch(/without a DOI/)
  })
})

describe("owlit-mcp", () => {
  it("lists owlit's tools and tells the agent how to work", async () => {
    const { mcp } = await setup()
    const { tools } = await mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["library_list", "library_read", "library_search", "library_add", "library_remove", "docs_add_note", "chats_read"]))
    expect(mcp.getInstructions()).toMatch(/owlit/)
  })

  it("answers questions about using owlit itself", async () => {
    const { tool } = await setup()
    expect((await tool("owlit_help")).text).toMatch(/^How to use owlit\. Ask for one topic:/)
    expect((await tool("owlit_help", { topic: "pdfs" })).text).toMatch(/^Getting PDFs \(library proxy\)/)
  })

  it("lists and reads the library", async () => {
    const { root, call, tool } = await setup()
    expect((await tool("library_list")).text).toBe("The library is empty.")
    await call("library.add", { paper: { id: "arxiv-1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    writeFileSync(path.join(root, "library/papers/arxiv-1706.03762/text.md"), "<!-- page 1 -->\n\n## 1 Introduction\n\nRecurrent models.\n\n<!-- page 2 -->\n\n## 2 Attention\n\nScaled dot-product attention.\n")
    expect((await tool("library_list")).text).toMatch(/^- arxiv-1706\.03762 · Attention Is All You Need · Vaswani et al\., 2017 · unread, no PDF(: owlit couldn't download it; the user can drop the PDF on the paper| yet \(still looking\))$/)
    expect((await tool("library_read", { id: "arxiv-1706.03762", pages: "2" })).text).toBe("<!-- page 2 -->\n\n## 2 Attention\n\nScaled dot-product attention.\n\n\n(The paper has 2 pages.)")
    expect((await tool("library_read", { id: "arxiv-1706.03762", section: "introduction" })).text).toMatch(/^## 1 Introduction\n\nRecurrent models\./)
    expect(JSON.parse((await tool("library_get", { id: "arxiv-1706.03762" })).text)).toMatchObject({ cite: "[Vaswani et al. 2017](owlit://library/arxiv-1706.03762)", highlights: 0 })
  })

  it("searches outside the library, records the search, and adds as the agent", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const routes: Record<string, string> = { "api.openalex.org/works?search": JSON.stringify({ meta: { count: 1 }, results: [JSON.parse(openalex)] }) }
    const { root, tool, call } = await setup({ routes })
    const found = await tool("library_search", { query: "historical newspapers question answering" })
    expect(found.text).toMatch(/^from OpenAlex\n- doi-10\.1145-3626772\.3657891 · ChroniclingAmericaQA.* · 7 citations/)
    const searches = readFileSync(path.join(root, ".owlit/searches.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(searches).toMatchObject([{ query: "historical newspapers question answering", source: "openalex", by: "chat:chat-1", results: ["doi-10.1145-3626772.3657891"] }])
    // What a search just found is added without asking the services again
    expect((await tool("library_add", { refs: ["doi-10.1145-3626772.3657891"] })).text).toMatch(/^Added doi-10\.1145-3626772\.3657891/)
    expect((await call("library.list")).papers[0]).toMatchObject({ addedBy: "agent" })
    routes["api.openalex.org/works/doi:10.1145"] = openalex
    expect((await tool("library_add", { refs: ["10.1145/3626772.3657891"] })).text).toMatch(/^Already in the library as doi-10\.1145-3626772\.3657891/)
    // and a search marks it as the library's, saying it has no PDF yet
    expect((await tool("library_search", { query: "newspapers" })).text).toMatch(/already in the library as doi-10\.1145-3626772\.3657891 \(no PDF yet\)/)
  })

  it("adds several papers in one call, saying which couldn't be added", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const { tool } = await setup({ routes: { "api.openalex.org/works/doi:10.1145": openalex } })
    const added = await tool("library_add", { refs: ["10.1145/3626772.3657891", "not a paper"] })
    expect(added.text).toMatch(/^Added doi-10\.1145-3626772\.3657891: ChroniclingAmericaQA.*\nCouldn't add not a paper: .+\nPDFs and text arrive by themselves/)
    expect((await tool("library_add", { refs: [] })).text).toBe("library_add needs at least one ref.")
  })

  it("applies each source's own filters, and refuses one the source can't apply", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const s2 = JSON.parse(readFileSync(path.join(fixtures, "s2-doi.json"), "utf8"))
    const arxiv = readFileSync(path.join(fixtures, "arxiv-1706.03762.xml"), "utf8")
    const sources = { results: [
      { id: "https://openalex.org/S1", display_name: "CHI Conference on Human Factors in Computing Systems", type: "conference" },
      { id: "https://openalex.org/S2", display_name: "Extended Abstracts of the CHI Conference on Human Factors in Computing Systems", type: "conference" },
      { id: "https://openalex.org/S3", display_name: "ACM SIGCHI Conference on Human Factors in Computing Systems (CHI)", type: "conference" },
    ] }
    const { tool, asked } = await setup({
      routes: {
        "api.openalex.org/sources?": JSON.stringify(sources),
        "api.openalex.org/works?": JSON.stringify({ meta: { count: 120 }, results: [JSON.parse(openalex)] }),
        "api.semanticscholar.org/graph/v1/paper/search": JSON.stringify({ total: 3, data: [s2] }),
        "export.arxiv.org/api/query?search_query": arxiv,
      },
    })

    const chi = await tool("library_search", { query: "sensemaking", venue: "CHI", year: "2019-2023", min_citations: 10, sort: "citations", type: "article", author: "Pirolli", open_access: true })
    expect(chi.text).toMatch(/^venue: CHI Conference on Human Factors in Computing Systems; ACM SIGCHI Conference .* · from OpenAlex · 1 of 120\n/)
    const works = asked.find((u) => u.includes("/works?"))!
    // The main track only: the extended abstracts share the name
    expect(works).toContain("primary_location.source.id:S1|S3,")
    for (const part of ["type:article|conference-paper", "publication_year:2019-2023", "cited_by_count:>9", "raw_author_name.search:Pirolli", "is_oa:true", "sort=cited_by_count:desc"]) expect(works).toContain(part)

    const ranked = await tool("library_search", { query: "newspaper qa", source: "s2", year: "2023-", type: "review" })
    expect(ranked.text).toMatch(/^from Semantic Scholar · 1 of 3\n- doi-10\.1145-3626772\.3657891 · .*\n  TLDR: ChroniclingAmericaQA/)
    expect(asked.find((u) => u.includes("paper/search"))).toMatch(/year=2023-&.*publicationTypes=Review/)

    const preprints = await tool("library_search", { query: "attention transformer", source: "arxiv", author: "Vaswani", sort: "newest", year: "2017" })
    expect(preprints.text).toMatch(/^from arXiv\n- arxiv-1706\.03762 · Attention Is All You Need/)
    expect(asked.find((u) => u.includes("search_query"))).toContain('search_query=all:attention AND all:transformer AND au:"Vaswani" AND submittedDate:[201701010000 TO 201712312359]')

    for (const [args, says] of [
      [{ source: "s2", sort: "newest" }, /^Semantic Scholar only ranks by relevance; use source openalex/],
      [{ source: "s2", author: "Lewis" }, /^Semantic Scholar search can't filter by author/],
      [{ source: "arxiv", min_citations: 5 }, /^arXiv doesn't count citations/],
      [{ year: "last year" }, /^year should look like 2023/],
    ] as const) {
      const refused = await tool("library_search", { query: "x", ...args })
      expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(says) })
    }
  })

  it("follows a paper's citations: OpenAlex for published work, Semantic Scholar for preprints and similar ones", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const s2 = JSON.parse(readFileSync(path.join(fixtures, "s2-doi.json"), "utf8"))
    const older = { ...s2, paperId: "b".repeat(40), externalIds: { ArXiv: "2005.11401" }, title: "Retrieval-Augmented Generation", year: 2020, citationCount: 5000 }
    const { call, tool, asked } = await setup({
      routes: {
        "api.openalex.org/works/doi:10.1145": openalex,
        "api.openalex.org/works?filter=": JSON.stringify({ meta: { count: 7 }, results: [JSON.parse(openalex)] }),
        "/references?": JSON.stringify({ data: [{ citedPaper: s2 }, { citedPaper: older }] }),
        "/citations?": JSON.stringify({ next: 1000, data: [{ citingPaper: s2 }] }),
        "recommendations/v1/papers/forpaper": JSON.stringify({ recommendedPapers: [older] }),
      },
    })
    await call("library.add", { paper: { id: "doi-10.1145-3626772.3657891", title: "ChroniclingAmericaQA", authors: ["Bhawna Piryani"], ids: { doi: "10.1145/3626772.3657891" }, year: 2024 } })
    const citing = await tool("library_related", { id: "doi-10.1145-3626772.3657891", kind: "cited_by", sort: "newest", year: "2024-" })
    expect(citing.text).toMatch(/^Papers citing ChroniclingAmericaQA.* · from OpenAlex · 1 of 7\n- doi-10\.1145-3626772\.3657891 · .*already in the library/)
    expect(asked.find((u) => u.includes("works?filter="))).toMatch(/filter=cites:W4393248081,.*publication_year:>2023.*sort=publication_date:desc/)

    // A preprint goes to S2, which neither sorts nor filters: owlit does, over the whole page
    const refs = await tool("library_related", { id: "arxiv-2403.17859", kind: "references", sort: "citations" })
    expect(refs.text).toMatch(/^References of arxiv-2403\.17859 · from Semantic Scholar\n- arxiv-2005\.11401 · Retrieval-Augmented Generation .*5000 citations[\s\S]*\n- doi-10\.1145/)
    expect(asked.find((u) => u.includes("graph/v1/paper/ARXIV:2403.17859/references"))).not.toContain("tldr")
    expect((await tool("library_related", { id: "arxiv-2403.17859", kind: "cited_by", sort: "citations" })).text).toMatch(
      /^Papers citing arxiv-2403\.17859 · from Semantic Scholar · Semantic Scholar gives only the first 1000, sorted among those; for the most cited overall, use library_search on the topic with sort citations\n/,
    )

    const like = await tool("library_related", { id: "10.1145/3626772.3657891", kind: "similar" })
    expect(like.text).toMatch(/^Papers like 10\.1145\/3626772\.3657891 · from Semantic Scholar\n- arxiv-2005\.11401/)
    expect((await tool("library_related", { id: "nothing here", kind: "references" })).text).toMatch(/^That isn't a paper owlit knows/)
    // Semantic Scholar without a key: one request every two seconds
  }, 30_000)

  it("lists a journal's articles a page at a time, and refuses a conference", async () => {
    const work = (n: number, title: string, issue: string) => ({
      DOI: `10.1016/j.ipm.2024.${n}`,
      title: [title],
      author: [{ given: "Ada", family: "Lovelace" }],
      issued: { "date-parts": [[2024, 5]] },
      "container-title": ["Information Processing &amp; Management"],
      volume: "61",
      issue,
      page: String(n),
      abstract: n === 2 ? "<jats:title>Abstract</jats:title><jats:p>We study retrieval &amp; ranking.</jats:p>" : undefined,
      "is-referenced-by-count": n,
    })
    const crossref = { message: { "total-results": 4, items: [work(3, "Graphs", "4"), work(2, "Dense retrieval at scale", "3"), work(1, "Query logs", "3"), work(9, "Editorial Board", "4")] } }
    // OpenAlex leads with the journal's old ISSN, under which Crossref has nothing recent
    const journals = { results: [{ id: "https://openalex.org/S174847851", display_name: "Information Processing & Management", type: "journal", issn_l: "0020-0271", issn: ["0020-0271", "0306-4573"] }] }
    const { tool, asked, root } = await setup({ routes: { "api.openalex.org/sources?search=Information": JSON.stringify(journals), "api.openalex.org/sources?search=CHI": JSON.stringify({ results: [{ id: "S1", display_name: "CHI Conference on Human Factors in Computing Systems", type: "conference" }] }), "api.crossref.org/journals/0306-4573/works": JSON.stringify(crossref), "api.crossref.org/journals/0020-0271/works": JSON.stringify({ message: { "total-results": 0, items: [] } }) } })

    const first = await tool("library_journal", { journal: "Information Processing and Management", year: "2024", limit: 2 })
    expect(first.text).toBe(
      [
        "Information Processing & Management (ISSN 0306-4573), 2024: 3 research articles (Crossref's full list, by issue date). 1–2: Pass offset 2 for the next.",
        "- doi-10.1016-j.ipm.2024.1 · Query logs · Lovelace, 2024, Information Processing & Management, vol. 61(3) · 1 citations",
        "- doi-10.1016-j.ipm.2024.2 · Dense retrieval at scale · Lovelace, 2024, Information Processing & Management, vol. 61(3) · 2 citations",
        "  We study retrieval & ranking.",
      ].join("\n"),
    )
    expect(asked.find((u) => u.includes("crossref"))).toContain("filter=from-pub-date:2024-01-01,until-pub-date:2024-12-31,type:journal-article")
    // The next page and a query use the list fetched a moment ago
    expect((await tool("library_journal", { journal: "Information Processing and Management", year: "2024", offset: 2 })).text).toMatch(/1 research article|3–3:\n- doi-10\.1016-j\.ipm\.2024\.3 · Graphs/)
    expect((await tool("library_journal", { journal: "Information Processing and Management", year: "2024", query: "Retrieval" })).text).toMatch(/: 1 research article with “Retrieval” \(Crossref's full list, by issue date\)\. 1–1:\n- doi-10\.1016-j\.ipm\.2024\.2/)
    expect(asked.filter((u) => u.includes("crossref"))).toHaveLength(2)
    expect(readFileSync(path.join(root, ".owlit/searches.jsonl"), "utf8")).toContain('"source":"crossref"')

    const chi = await tool("library_journal", { journal: "CHI", year: "2024" })
    expect(chi).toMatchObject({ isError: true, text: expect.stringMatching(/is a conference, and owlit can only list a journal's papers for now\. Use library_search with venue “CHI” instead\./) })
    expect((await tool("library_journal", { journal: "Information Processing and Management", year: "2015-2024" })).text).toMatch(/at most five years/)
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
    await tool("library_add", { refs: ["10.1145/3626772.3657891"] })
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

describe("docs_read on a PDF", () => {
  it("gives the text page by page with the page numbers to cite, or only the pages asked for", async () => {
    const { root, tool } = await setup()
    mkdirSync(path.join(root, "reviews"))
    writeFileSync(path.join(root, "reviews/round1.pdf"), makePdf([paragraph(72, 100, ["Reviewer one asks for a field study."]), paragraph(72, 100, ["Reviewer two likes the method."])]))
    const all = await tool("docs_read", { path: "reviews/round1.pdf" })
    expect(all.isError).toBe(false)
    expect(all.text).toMatch(/<!-- page 1 -->[\s\S]*field study[\s\S]*<!-- page 2 -->[\s\S]*likes the method/)
    const second = await tool("docs_read", { path: "reviews/round1.pdf", pages: "2" })
    expect(second.text).not.toMatch(/field study/)
    expect(second.text).toMatch(/likes the method[\s\S]*\(The PDF has 2 pages\.\)/)
    // A file that isn't a PDF owlit can read says so
    writeFileSync(path.join(root, "broken.pdf"), "not a pdf")
    expect((await tool("docs_read", { path: "broken.pdf" })).text).toMatch(/isn't a PDF owlit can read/)
  }, 30_000)
})
