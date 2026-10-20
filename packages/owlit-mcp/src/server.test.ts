import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Core } from "@owlit/core"
import type { Notifications, PdfTry, UiRequest } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { makePdf, paragraph } from "../../core/src/library/text/make-pdf.ts"
import { pdfFact } from "./server.ts"

const MAIN = path.join(import.meta.dirname, "main.ts")
const fixtures = path.join(import.meta.dirname, "../../core/src/library/fixtures")
const FAKE_AGENT = path.join(import.meta.dirname, "../../core/src/agents/fake-acp.ts")

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
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir }, host: { fetch }, retryBaseMs: 1, mcp: { command: process.execPath, args: [MAIN, "--socket-dir", dir] } })
  cleanups.push(() => core.dispose())
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  if (options.open !== false) {
    await call("workspace.open", { path: root })
    await call("chats.create", { chat: { id: "chat-1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
  }
  // As core hands it to the chat's agent session, with the session secret that names the chat
  const [given] = core.mcpServers(root, "chat-1")
  const env = Object.fromEntries([...Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined), ...(given?.env ?? []).map((e) => [e.name, e.value])])
  const transport = new StdioClientTransport({ command: process.execPath, args: given?.args ?? [MAIN, "--socket-dir", dir, "--workspace", root, "--chat", "chat-1"], env, stderr: "pipe" })
  const mcp = new Client({ name: "test-agent", version: "1" })
  await mcp.connect(transport)
  cleanups.push(() => mcp.close())
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
    return { text: result.content.map((c) => c.text).join(""), isError: !!result.isError }
  }
  return { root, dir, core, call, mcp, tool, asked, transport }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("owlit-mcp", () => {
  it("tells an agent outside owlit that it reads the workspace and changes nothing from there", async () => {
    const { root, dir, mcp } = await setup()
    expect(mcp.getInstructions()).toMatch(/^owlit agent rules/)
    const outside = new Client({ name: "outside-agent", version: "1" })
    await outside.connect(new StdioClientTransport({ command: process.execPath, args: [MAIN, "--workspace", root, "--socket-dir", dir], stderr: "pipe" }))
    cleanups.push(() => outside.close())
    expect(outside.getInstructions()).toMatch(/^You are reading the user's owlit workspace from outside owlit\.[\s\S]*\n\nowlit agent rules/)
  })

  it("leaves when the agent that started it closes its stdin, after using owlit", async () => {
    const { tool, transport } = await setup()
    await tool("library_list")
    const pid = transport.pid!
    // What a crashed agent leaves: its end of the pipe closed, and nobody to send a signal
    ;(transport as unknown as { _process: { stdin: NodeJS.WritableStream } })._process.stdin.end()
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 5_000, interval: 20 })
  })
})

describe("pdfFact", () => {
  // With a browser extension allowed, as most of these are read
  const fact = (p: Parameters<typeof pdfFact>[0]) => pdfFact(p, true)
  const noPdf = (ended: PdfTry["ended"], by: PdfTry["by"] = "search") => ({ pdfState: { state: "no-pdf" as const, tried: [{ by, ended, at: 1 }], reason: { by, ended, at: 1 } } })

  it("says nothing of a paper with its PDF, and that owlit is at it while it is finding", () => {
    expect(fact({ pdf: { url: "owlit-pdf://doi-10.1145-1" } })).toBe("")
    expect(fact({})).toBe("no PDF yet (owlit is looking)")
    expect(fact({ pdfState: { state: "finding", tried: [] } })).toBe("no PDF yet (owlit is looking)")
    expect(fact({ pdfState: { state: "finding", tried: [{ by: "search", ended: "offline", at: 1 }], reason: { by: "search", ended: "offline", at: 1 } } })).toBe("no PDF yet (waiting for the network)")
  })

  it("says what the extension in the user's browser waits for, and that one step covers every such paper", () => {
    const tried = (ended: PdfTry["ended"]) => ({ by: "extension" as const, ended, at: 1 })
    expect(fact({ pdfState: { state: "finding", tried: [tried("sign-in")], reason: tried("sign-in"), extension: { host: "tlink.lib.tsinghua.edu.cn", waits: "sign-in", proxied: true } } })).toMatch(
      /waits for the user's library sign-in.*Home says so; one sign-in covers every such paper/,
    )
    // A publisher's own sign-in, with no library proxy in between
    const publisher = fact({ pdfState: { state: "finding", tried: [tried("sign-in")], reason: tried("sign-in"), extension: { host: "sagepub.com", waits: "sign-in" } } })
    expect(publisher).toMatch(/waits for the user to sign in at sagepub.com/)
    expect(publisher).not.toMatch(/library/)
    expect(fact({ pdfState: { state: "finding", tried: [tried("check")], reason: tried("check") } })).toMatch(/pass a check/)
    expect(fact({ pdfState: { state: "finding", tried: [tried("no-permission")], reason: tried("no-permission") } })).toMatch(/let the owlit extension.*read/)
    expect(fact({ pdfState: { state: "finding", tried: [], extension: { host: "sagepub.com" } } })).toBe("no PDF yet (owlit is getting it through the user's browser)")
    // What the extension saw is a reason like any other
    expect(fact(noPdf("no-access", "extension"))).toMatch(/offered access instead/)
    expect(fact(noPdf("not-offered", "extension"))).toMatch(/library proxy doesn't offer/)
  })

  it("says why for each way a try can end, and what the user can do", () => {
    expect(fact(noPdf("no-copy"))).toMatch(/found no copy.*drop the PDF on the paper/)
    expect(fact(noPdf("no-access", "person"))).toMatch(/offered access instead.*drop the PDF/)
    expect(fact(noPdf("not-offered", "person"))).toMatch(/library proxy doesn't offer this paper.*drop the PDF/)
    expect(fact(noPdf("not-there"))).toMatch(/no PDF at the paper's address.*drop the PDF/)
    expect(fact(noPdf("check"))).toMatch(/stopped owlit's own look with a check.*drop the PDF/)
    expect(fact(noPdf("sign-in"))).toMatch(/wanted a sign-in.*drop the PDF/)
  })

  it("says the extension could try, for a paper with no PDF, while no browser's extension may connect", () => {
    expect(pdfFact(noPdf("no-copy"), false)).toMatch(/found no copy.*\(with the owlit extension the user's browser could try; Settings › Papers › Browser extension\)$/)
    expect(pdfFact(noPdf("no-copy"), true)).not.toMatch(/owlit extension/)
    // Still finding: nothing to suggest yet
    expect(pdfFact({ pdfState: { state: "finding", tried: [] } }, false)).toBe("no PDF yet (owlit is looking)")
  })
})

describe("owlit-mcp", () => {
  it("lists owlit's tools and tells the agent how to work", async () => {
    const { mcp } = await setup()
    const { tools } = await mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["library_list", "library_read", "library_search", "library_add", "library_remove", "docs_add_comment", "chats_read"]))
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
    expect((await tool("library_list")).text).toMatch(/^- arxiv-1706\.03762 · Attention Is All You Need · Vaswani et al\., 2017 · unread, no PDF(: owlit found no copy .*; the user can drop the PDF on the paper| yet \((owlit is looking|waiting for the network)\))$/)
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
    expect((await call("library.list")).papers[0]).toMatchObject({ addedBy: expect.stringMatching(/^o_/) })
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

  it("leaves a comment on a doc without changing the file", async () => {
    const { root, core, call, tool } = await setup()
    const doc = "# Related work\n\nFirst paragraph.\n\nSecond paragraph argues that attention\nis all you need.\n"
    writeFileSync(path.join(root, "Related work.md"), doc)
    const told: unknown[] = []
    core.onNotify((n) => n.method === "comments.changed" && told.push(n.params))
    const result = await tool("docs_add_comment", { path: "Related work.md", quote: "attention is all you need", comment: "Cite Vaswani 2017 here." })
    expect(result.isError).toBe(false)
    expect(readFileSync(path.join(root, "Related work.md"), "utf8")).toBe(doc)
    const comments = await call("comments.all")
    expect(comments["Related work.md"]).toMatchObject([{ quote: "attention\nis all you need", entries: [{ text: "Cite Vaswani 2017 here.", by: expect.stringMatching(/^o_/), chatId: "chat-1" }] }])
    // Windows hear of it, so the comment shows up in an open doc
    expect(told).toMatchObject([{ path: "Related work.md", comment: { entries: [{ text: "Cite Vaswani 2017 here." }] } }])
    expect((await tool("docs_add_comment", { path: "Related work.md", quote: "not in the doc", comment: "x" })).text).toMatch(/isn't in Related work\.md word for word/)
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

  it("gathers papers into a thread, keeps what the user did, and adds to it later", async () => {
    const { root, core, call, tool } = await setup()
    const changed: Notifications["changes.added"][] = []
    core.onNotify((n) => {
      if (n.method === "changes.added") changed.push(n.params as Notifications["changes.added"])
    })
    expect((await tool("thread_list")).text).toBe("There are no threads yet.")
    await call("library.add", { paper: { id: "arxiv-2005.11401", title: "Retrieval-Augmented Generation", authors: ["Patrick Lewis"], ids: { arxiv: "2005.11401" }, year: 2020 } })
    writeFileSync(path.join(root, "library/papers/arxiv-2005.11401/text.md"), "<!-- page 2 -->\n\nIntro.\n\n<!-- page 3 -->\n\nWe can draw a different latent document for each target token.\n")

    const unknown = await tool("thread_write", { asked: "检索粒度有什么研究？", title: "检索粒度", rows: JSON.stringify([{ id: "doi-10.9999-nope", answer: "x" }]) })
    expect(unknown).toEqual({ isError: true, text: "owlit didn't write it:\n- owlit doesn't know the paper doi-10.9999-nope: name papers by the id a search gave you." })

    const rows = JSON.stringify([{ id: "arxiv-2005.11401", answer: "Each token may draw on its own retrieved document.", depth: "full", quote: "a different latent document for each target token" }])
    const memo = JSON.stringify([{ text: "One paper so far: [Lewis et al. 2020](owlit://library/arxiv-2005.11401) retrieves per token." }])
    const wrote = await tool("thread_write", { asked: "检索粒度有什么研究？", title: "检索粒度", rows, memo, note: "Semantic Scholar was not reachable." })
    const id = /owlit:\/\/threads\/([\w-]+)/.exec(wrote.text)![1]!
    expect(wrote.text).toMatch(/^Wrote “检索粒度” \(owlit:\/\/threads\/t-[0-9a-f]{6}\): added 1\./)
    expect(changed).toMatchObject([{ change: { action: "create", target: { kind: "thread" } }, label: "检索粒度", thread: { rows: ["arxiv-2005.11401"] } }])
    const c = await call("threads.get", { id })
    expect(c.rows[0].cells.q).toMatchObject({ depth: "full", passage: { page: 3 } })

    await call("threads.edit", { id, edit: { op: "rename", title: "Retrieval granularity" } })
    expect((await tool("thread_list")).text).toBe(`- ${id} · Retrieval granularity · 1 paper · asked: 检索粒度有什么研究？`)
    expect((await tool("thread_read", { id })).text).toMatch(/^Retrieval granularity \(owlit:\/\/threads\/.+\)\nAsked: 检索粒度有什么研究？\nColumns: q = 检索粒度有什么研究？\n\nMemo:\n- \[s1\] One paper so far/)
    expect((await tool("thread_read", { id })).text).toMatch(/q: Each token may draw on its own retrieved document\. \[full, p\. 3\]/)
    expect((await tool("thread_read", { id })).text).toMatch(/The user rewrote \(keep their words\): title$/)

    const wrongQuote = JSON.stringify([{ id: "arxiv-2005.11401", answer: "x", depth: "full", quote: "not in the paper" }])
    expect((await tool("thread_write", { id, rows: wrongQuote })).text).toMatch(/isn't in its text word for word/)
    expect((await tool("thread_write", { id, rows: "[{" })).text).toBe("rows should be a JSON array.")

    // Groups: what the user did to them is in thread_read, and a write that goes against it says so
    const groups = JSON.stringify([{ id: "tok", name: "Per token" }, { id: "doc", name: "Per document" }])
    await tool("thread_write", { id, groups, rows: JSON.stringify([{ id: "arxiv-2005.11401", group: "tok" }]) })
    expect((await tool("thread_read", { id })).text).toMatch(/Grouping topic \(Topic\): tok = Per token; doc = Per document/)
    await call("threads.edit", { id, edit: { op: "move", column: "topic", row: "arxiv-2005.11401", group: "doc" } })
    await call("threads.edit", { id, edit: { op: "ungroup", column: "topic", group: "tok" } })
    const read = (await tool("thread_read", { id })).text
    expect(read).toMatch(/arxiv-2005.11401 · .* · in doc \(Per document\) \(the user put it here, keep it\)/)
    expect(read).toMatch(/The user changed the groups \(keep it so\):\n- ungrouped tok \(Per token\): leave it out\n- took arxiv-2005.11401 out of tok: don't put it back/)
    expect((await tool("thread_write", { id, groups })).text).toMatch(/Kept as the user had it:\n- The user ungrouped tok \(Per token\)/)

    // Another way to group them is a new grouping of the same thread
    await tool("thread_write", { id, new_grouping: "by method", groups: JSON.stringify([{ id: "abl", name: "Ablations" }]), rows: JSON.stringify([{ id: "arxiv-2005.11401", group: "abl" }]) })
    expect((await tool("thread_read", { id })).text).toMatch(/Grouping g\d+ \(by method\): abl = Ablations/)
    expect((await tool("thread_list")).text.split("\n")).toHaveLength(1)
  })

  it("names the tool call Claude Code says a request is for in the change it makes", async () => {
    const { root, call, mcp } = await setup()
    writeFileSync(path.join(root, "Draft.md"), "# Draft\n\nAttention is all you need.\n")
    await mcp.callTool({ name: "docs_add_comment", arguments: { path: "Draft.md", quote: "all you need", comment: "Cite it." }, _meta: { "claudecode/toolUseId": "toolu_1" } })
    const [change] = await call("changes.list", { target: { kind: "comment" } })
    expect(change).toMatchObject({ actor: expect.stringMatching(/^o_/), origin: { via: "tool", chatId: "chat-1", toolCallId: "toolu_1", writeId: "toolu_1" } })
  })

  it("lets the user undo an agent's comment and paper, and undo the undo", async () => {
    const openalex = readFileSync(path.join(fixtures, "openalex-doi.json"), "utf8")
    const { root, core, call, tool } = await setup({ routes: { "api.openalex.org/works/doi:10.1145": openalex } })
    const changed: Notifications["changes.added"][] = []
    const removed: unknown[] = []
    core.onNotify((n) => {
      if (n.method === "changes.added") changed.push(n.params as Notifications["changes.added"])
      if (n.method === "comments.removed") removed.push(n.params)
    })
    writeFileSync(path.join(root, "Draft.md"), "# Draft\n\nAttention is all you need.\n")
    await tool("docs_add_comment", { path: "Draft.md", quote: "all you need", comment: "Cite it." })
    await tool("library_add", { refs: ["10.1145/3626772.3657891"] })
    // Owlit's, by the chat the tools were started for
    expect(changed).toMatchObject([
      { change: { actor: expect.stringMatching(/^o_/), action: "create", target: { kind: "comment", path: "Draft.md" }, origin: { via: "tool", chatId: "chat-1" } }, label: "Draft" },
      { change: { actor: expect.stringMatching(/^o_/), action: "create", target: { kind: "paper" }, origin: { chatId: "chat-1" } }, label: expect.stringMatching(/^ChroniclingAmericaQA/) },
    ])

    const note = await call("changes.undo", { id: changed[0].change.id })
    expect((await call("comments.all"))["Draft.md"]).toBeUndefined()
    expect(removed).toMatchObject([{ path: "Draft.md" }])
    await call("changes.undo", { id: note.change.id })
    expect((await call("comments.all"))["Draft.md"]).toMatchObject([{ entries: [{ text: "Cite it." }] }])

    const paper = await call("changes.undo", { id: changed[1].change.id })
    expect((await call("library.list")).papers).toEqual([])
    await call("changes.undo", { id: paper.change.id })
    expect((await call("library.list")).papers).toMatchObject([{ id: "doi-10.1145-3626772.3657891", addedBy: expect.stringMatching(/^o_/) }])
  })

  it("keeps a line in Owlit's memory for the chat, which Undo takes back", async () => {
    const { root, core, call, tool } = await setup()
    const changed: Notifications["changes.added"][] = []
    core.onNotify((n) => {
      if (n.method === "changes.added") changed.push(n.params as Notifications["changes.added"])
    })
    expect((await tool("memory_write", { op: "add", kind: "work", text: "Cite as (Author, Year)." })).text).toMatch(/^Kept as m1: "Cite as \(Author, Year\)\."/)
    expect((await tool("memory_write", { op: "replace", id: "m1", text: "Cite in APA 7." })).text).toMatch(/^Replaced m1: "Cite in APA 7\.".*replaces "Cite as/)
    expect((await tool("memory_write", { op: "remove", id: "m7" })).text).toMatch(/no line m7/)
    expect((await tool("memory_write", { op: "add", text: "No kind" })).text).toMatch(/needs kind/)
    expect(changed).toMatchObject([
      { change: { action: "create", target: { kind: "memory", part: "m1" }, after: { kind: "work" }, origin: { chatId: "chat-1" } }, label: "Cite as (Author, Year)." },
      { change: { action: "update", target: { kind: "memory", part: "m1" }, origin: { chatId: "chat-1" } }, label: "Cite in APA 7." },
    ])
    expect(readFileSync(path.join(root, ".owlit/memory.md"), "utf8")).toContain("- Cite in APA 7. <!-- m1 ·")
    await call("changes.undo", { id: changed[1].change.id })
    expect((await call("memory.list")).lines).toMatchObject([{ id: "m1", text: "Cite as (Author, Year)." }])
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

  it("starts a Go through of the material the agent names", async () => {
    const { root, core, call, tool } = await setup()
    // The work owlit starts runs on the fake agent, never on an agent this Mac happens to have
    const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${FAKE_AGENT}"` })
    await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
    mkdirSync(path.join(root, "Meetings"))
    writeFileSync(path.join(root, "Meetings/Weekly.md"), "# Weekly\n\nAna: start the story from the task.\n")
    expect((await tool("docs_go_through", { path: "Meetings/Weekly.md" })).text).toMatch(/^Owlit is going through Meetings\/Weekly\.md in a chat of its own\./)
    expect(await call("chats.startedFor", { kind: "doc" })).toMatchObject([{ about: { kind: "doc", id: "Meetings/Weekly.md" } }])
    expect((await tool("docs_go_through", { path: "Meetings/slides.pdf" })).isError).toBe(true)
  })

  it("names the tool and the parameter core couldn't use", async () => {
    const { tool } = await setup()
    expect(await tool("library_search", { query: "replay", limit: 100 })).toEqual({ isError: true, text: expect.stringMatching(/^library_search got parameters it can't use: limit: .*50\.$/) })
  })

  it("ends each tool's description with what the roles get", async () => {
    const { mcp } = await setup()
    const { tools } = await mcp.listTools()
    const described = Object.fromEntries(tools.map((t) => [t.name, t.description ?? ""]))
    expect(described.library_update).toMatch(/ Reviewer: refused\. Assistant: allowed, the user can undo it\. Co-author: allowed, the user can undo it\.$/)
    expect(described.docs_delete).toMatch(/ Reviewer: refused\. Assistant: lands as a proposal the user sees marked and may undo in part\. Co-author: allowed, the user can undo it\.$/)
    expect(described.comments_remove).toMatch(/ Allowed in every role; the user can undo it\.$/)
    expect(described.library_list).not.toMatch(/Reviewer/)
  })

  it("replies to the user's comments in every role, and resolves them as Assistant, not as Reviewer", async () => {
    const { root, call, tool } = await setup()
    writeFileSync(path.join(root, "Draft.md"), "# Draft\n\nAttention is all you need.\n")
    const comment = { id: "c1", quote: "all you need", prefix: "Attention is ", suffix: ".", entries: [{ id: "e1", text: "Add the citation here?", at: 1 }], createdAt: 1 }
    await call("comments.add", { path: "Draft.md", comment })
    expect((await tool("docs_comments", { path: "Draft.md" })).text).toBe('- c1 on "all you need"\n  the user: Add the citation here?')

    // The chat is a Reviewer's: the user's comment stays theirs, Owlit's own is Owlit's
    await call("chats.update", { id: "chat-1", patch: { role: "reviewer" } })
    expect(await tool("comments_resolve", { path: "Draft.md", id: "c1", reply: "Added it." })).toEqual({ isError: true, text: expect.stringMatching(/^Not done: Owlit works as Reviewer in this chat and changes nothing of the user's\./) })
    // A reply adds an entry of Owlit's own and changes nothing of the user's: a Reviewer's to make
    expect((await tool("comments_reply", { path: "Draft.md", id: "c1", text: "Vaswani 2017." })).text).toMatch(/^Replied under the comment on "all you need"/)
    await tool("docs_add_comment", { path: "Draft.md", quote: "Attention", comment: "Spell it out?" })
    const own = (await call("comments.all"))["Draft.md"].find((c: { id: string }) => c.id !== "c1")
    expect((await tool("comments_reply", { path: "Draft.md", id: own.id, text: "Or keep it." })).text).toMatch(/^Replied under the comment/)
    expect((await tool("comments_remove", { path: "Draft.md", id: own.id })).text).toMatch(/^Removed your comment/)
    expect((await tool("comments_remove", { path: "Draft.md", id: "c1" })).text).toMatch(/^Not done: That comment is the user's/)

    await call("chats.update", { id: "chat-1", patch: { role: "assistant" } })
    expect((await tool("comments_reply", { path: "Draft.md", id: "c1", text: "Vaswani 2017, p. 2." })).text).toMatch(/^Replied under the comment on "all you need"/)
    expect((await tool("comments_resolve", { path: "Draft.md", id: "c1", reply: "Added the citation." })).text).toMatch(/^Resolved the comment on "all you need" with your reply/)
    const [resolved] = (await call("comments.all"))["Draft.md"]
    expect(resolved).toMatchObject({ id: "c1", resolvedAt: expect.any(Number) })
    expect(resolved.entries.map((e: { by: string; text: string }) => [e.by.slice(0, 2), e.text])).toEqual([
      ["p_", "Add the citation here?"],
      ["o_", "Vaswani 2017."],
      ["o_", "Vaswani 2017, p. 2."],
      ["o_", "Added the citation."],
    ])
    expect((await tool("comments_resolve", { path: "Draft.md", id: "c1", reply: "Again." })).text).toBe("That comment is already resolved.")
    expect((await tool("comments_resolve", { path: "Draft.md", id: "nope", reply: "x" })).text).toMatch(/^There is no comment nope/)
    // Each as Owlit's, with Undo for the user
    const changes = await call("changes.list", { target: { kind: "comment", path: "Draft.md" } })
    expect(changes.filter((c: any) => c.target.part.startsWith("c1")).map((c: any) => [c.action, c.target.part, c.actor.slice(0, 2)])).toEqual([
      ["create", `c1/${resolved.entries[3].id}`, "o_"],
      ["update", "c1", "o_"],
      ["create", `c1/${resolved.entries[2].id}`, "o_"],
      ["create", `c1/${resolved.entries[1].id}`, "o_"],
      ["create", "c1", "p_"],
    ])
  })

  it("stars, tags and marks papers, renames a thread, and takes back its own highlight", async () => {
    const { call, tool } = await setup()
    await call("library.add", { paper: { id: "arxiv-1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    expect((await tool("library_update", { ids: ["arxiv-1706.03762"], starred: true, tags: ["baseline", "transformer"], status: "read" })).text).toBe("arxiv-1706.03762: starred, read, tags baseline, transformer.")
    expect((await tool("library_update", { ids: ["arxiv-1706.03762"] })).text).toBe("library_update needs starred, status or tags.")
    expect((await tool("library_update", { ids: ["arxiv-nope"], starred: true })).text).toMatch(/^Couldn't change arxiv-nope/)
    expect((await call("library.list")).papers[0]).toMatchObject({ starred: true, status: "read", tags: ["baseline", "transformer"], addedBy: expect.stringMatching(/^p_/) })
    expect((await call("changes.list", { path: "arxiv-1706.03762" })).map((c: any) => [c.target.part, c.actor.slice(0, 2)])).toEqual([["tags", "o_"], ["status", "o_"], ["starred", "o_"], [undefined, "p_"]])

    const written = await tool("thread_write", { asked: "What do transformers replace?", title: "Transformers", rows: JSON.stringify([{ id: "arxiv-1706.03762", answer: "Recurrence.", depth: "abstract" }]) })
    const id = written.text.match(/owlit:\/\/threads\/([\w-]+)/)![1]!
    expect((await tool("thread_edit", { id, title: "Attention replaces recurrence" })).text).toBe(`“Attention replaces recurrence” (owlit://threads/${id}).`)
    expect(await call("threads.get", { id })).toMatchObject({ title: "Attention replaces recurrence" })
    expect((await tool("thread_edit", { id })).text).toBe("thread_edit needs title.")

    // A highlight the chat's Owlit made (as ui_mark has the window make it), and one of the user's
    await call("library.putHighlight", { highlight: { id: "h1", paperId: "arxiv-1706.03762", page: 1, rects: [], text: "Scaled dot-product\nattention.", color: "yellow", createdAt: 1 }, chatId: "chat-1" })
    await call("library.putHighlight", { highlight: { id: "h2", paperId: "arxiv-1706.03762", page: 0, rects: [], text: "Recurrent models.", color: "green", createdAt: 2 } })
    expect((await tool("library_unmark", { id: "arxiv-1706.03762", quote: "Scaled dot-product attention." })).text).toBe("Removed the highlight on p. 2 of arxiv-1706.03762.")
    expect((await tool("library_unmark", { id: "arxiv-1706.03762", quote: "Recurrent models." })).text).toMatch(/^Not done: That highlight is the user's/)
    expect((await tool("library_unmark", { id: "arxiv-1706.03762", quote: "nowhere" })).text).toMatch(/^No highlight in arxiv-1706.03762 reads that way/)
    expect((await call("library.highlights", { id: "arxiv-1706.03762" })).map((h: { id: string }) => h.id)).toEqual(["h2"])
  })
})
