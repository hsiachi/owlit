import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Http } from "../net/http.ts"
import { NotAPaper, resolve } from "./resolve.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")

// Serves recorded responses by URL; anything else is a 404
function httpServing(routes: Record<string, string | number>) {
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(url)
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    const [, body] = match
    return typeof body === "number" ? new Response("", { status: body }) : new Response(body)
  }) as unknown as typeof globalThis.fetch
  return { http: new Http({ fetch, userAgent: "owlit-test", retryBaseMs: 1 }), asked }
}

describe("resolve", () => {
  it("trusts arXiv for a preprint and keeps its PDF link", async () => {
    const { http, asked } = httpServing({ "export.arxiv.org/api/query?id_list=1706.03762": fixture("arxiv-1706.03762.xml") })
    const paper = await resolve(http, "https://arxiv.org/abs/1706.03762v7")
    expect(paper).toMatchObject({
      id: "arxiv-1706.03762",
      ids: { arxiv: "1706.03762" },
      title: "Attention Is All You Need",
      year: 2017,
      date: "2017-06-12",
      kind: "preprint",
      pdfUrls: ["https://arxiv.org/pdf/1706.03762"],
      fields: { title: "arxiv", year: "arxiv", abstract: "arxiv" },
    })
    expect(paper.authors).toHaveLength(8)
    expect(paper.authors[0]).toBe("Ashish Vaswani")
    expect(paper.abstract).toMatch(/^The dominant sequence transduction models/)
    // Semantic Scholar was asked for a published DOI, and said nothing; OpenAlex was never asked
    expect(asked.some((u) => u.includes("api.semanticscholar.org/graph/v1/paper/ARXIV:1706.03762"))).toBe(true)
    expect(asked.some((u) => u.includes("openalex"))).toBe(false)
  })

  it("merges OpenAlex and Semantic Scholar for published work", async () => {
    const { http } = httpServing({
      "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
      "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
    })
    const paper = await resolve(http, "https://dl.acm.org/doi/10.1145/3626772.3657891")
    expect(paper).toMatchObject({
      id: "doi-10.1145-3626772.3657891",
      ids: { doi: "10.1145/3626772.3657891", arxiv: "2403.17859", s2: "ea9e44616e1efb23f808960cf452bea164fe2a7c", openalex: "W4393248081" },
      year: 2024,
      kind: "conference",
      venue: "International ACM SIGIR Conference on Research and Development in Information Retrieval (SIGIR)",
      citationCount: 22,
      fields: { title: "openalex", venue: "openalex", tldr: "s2", abstract: "s2" },
    })
    expect(paper.title).toMatch(/^ChroniclingAmericaQA/)
    expect(paper.tldr).toMatch(/^ChroniclingAmericaQA, a large-scale temporal QA dataset/)
    expect(paper.pdfUrls[0]).toBe("https://arxiv.org/pdf/2403.17859")
    expect(paper.records.map((r) => r.source).sort()).toEqual(["openalex", "s2"])
  })

  it("goes on without a service that keeps failing", async () => {
    const { http } = httpServing({
      "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
      "api.semanticscholar.org": 429,
    })
    const paper = await resolve(http, "10.1145/3626772.3657891")
    expect(paper.fields.title).toBe("openalex")
    expect(paper.tldr).toBeUndefined()
  })

  it("says plainly when no service knows the paper", async () => {
    const { http } = httpServing({})
    await expect(resolve(http, "10.9999/nothing")).rejects.toBeInstanceOf(NotAPaper)
    await expect(resolve(http, "just some words")).rejects.toThrow("doesn't look like a DOI")
  })

  it("passes on the network error when nothing could be asked", async () => {
    const { http } = httpServing({ "api.openalex.org": 503, "api.semanticscholar.org": 503 })
    await expect(resolve(http, "10.1145/3626772.3657891")).rejects.toMatchObject({ status: 503 })
  })

  it("reads the DOI from a publisher page's meta tags", async () => {
    const page = `<html><head><meta name="citation_doi" content="10.1145/3626772.3657891"></head></html>`
    const { http } = httpServing({
      "www.sciencedirect.com/science/article/pii/S0306457323000000": page,
      "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
    })
    const paper = await resolve(http, "https://www.sciencedirect.com/science/article/pii/S0306457323000000")
    expect(paper.id).toBe("doi-10.1145-3626772.3657891")
  })
})
