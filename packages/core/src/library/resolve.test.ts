import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Http } from "../net/http.ts"
import { NotAPaper, resolve, withSubtitle } from "./resolve.ts"

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
  it("files a preprint added by its OpenAlex id under its arXiv id, found among OpenAlex's locations", async () => {
    const work = {
      id: "https://openalex.org/W4384648639",
      ids: { openalex: "https://openalex.org/W4384648639" },
      title: "FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning",
      publication_year: 2023,
      type: "preprint",
      authorships: [{ author: { display_name: "Tri Dao" } }],
      locations: [{ landing_page_url: "https://arxiv.org/abs/2307.08691", pdf_url: "https://arxiv.org/pdf/2307.08691v1" }],
    }
    const { http, asked } = httpServing({ W4384648639: JSON.stringify(work) })
    const paper = await resolve(http, "W4384648639")
    expect(paper).toMatchObject({ id: "arxiv-2307.08691", ids: { openalex: "W4384648639", arxiv: "2307.08691" } })
    // arXiv, the authority for a preprint, was asked too
    expect(asked.some((u) => u.includes("id_list=2307.08691"))).toBe(true)
  })

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

describe("checking what the services say", () => {
  const work = (title: string, extra: object = {}) =>
    JSON.stringify({ id: "https://openalex.org/W1", ids: { doi: "https://doi.org/10.1145/2971648.2971747" }, title, publication_year: 2016, type: "article", ...extra })
  const crossref = (title: string, subtitle?: string) => JSON.stringify({ message: { DOI: "10.1145/2971648.2971747", title: [title], ...(subtitle ? { subtitle: [subtitle] } : {}) } })

  it("gives a title back the subtitle OpenAlex left off, from Crossref", async () => {
    const { http } = httpServing({
      "api.openalex.org/works/doi:10.1145%2F2971648.2971747": work("PrefMiner"),
      "api.crossref.org/works/10.1145%2F2971648.2971747": crossref("PrefMiner", "mining user's preferences for intelligent mobile notification management"),
    })
    const paper = await resolve(http, "10.1145/2971648.2971747")
    expect(paper.title).toBe("PrefMiner: mining user's preferences for intelligent mobile notification management")
    expect(paper.fields.title).toBe("crossref")
    expect(paper.crossrefAnswered).toBe(true)
  })

  it("keeps OpenAlex's title when no one has more, and counts a DOI Crossref doesn't hold as checked", async () => {
    const { http } = httpServing({ "api.openalex.org/works/doi:10.1145%2F2971648.2971747": work("Outcome bias in decision evaluation.") })
    const paper = await resolve(http, "10.1145/2971648.2971747")
    expect(paper).toMatchObject({ title: "Outcome bias in decision evaluation.", fields: { title: "openalex" }, crossrefAnswered: true })
  })

  it("drops an abstract that belongs to another paper", async () => {
    // It shares "effect" with the title, as the real one does: a word any abstract may use
    const braf = { BRAF: [0], "mutated at V600E is a potent oncogenic driver in melanoma, and its effect on lung and colorectal cancer": [1] }
    const { http } = httpServing({
      "api.openalex.org/works/doi:10.1145%2F2971648.2971747": work("Hindsight != foresight: the effect of outcome knowledge on judgment under uncertainty", { abstract_inverted_index: braf }),
    })
    const paper = await resolve(http, "10.1145/2971648.2971747")
    expect(paper.abstract).toBeUndefined()
    expect(paper.dropped?.abstract).toMatch(/^openalex's abstract shares no word with the title/)
  })

  it("keeps an abstract that shares a word with the title, and doesn't judge short titles", async () => {
    const own = { "We study when people forecast how they will feel": [0] }
    const { http } = httpServing({ "api.openalex.org/works/doi:10.1145%2F2971648.2971747": work("Affective Forecasting", { abstract_inverted_index: own }) })
    expect((await resolve(http, "10.1145/2971648.2971747")).abstract).toMatch(/^We study/)
  })

  it("finds the DOI of a Semantic Scholar record that has none, by its title", async () => {
    const stray = { paperId: "d9b08e17477d834243b420118b5d16137e635395", externalIds: {}, title: "Proactive behavior in voice assistants: A systematic review and conceptual model", authors: [{ name: "C. E." }] }
    const title = "Proactive behavior in voice assistants: A systematic review and conceptual model"
    const { http } = httpServing({
      "graph/v1/paper/d9b08e17477d834243b420118b5d16137e635395": JSON.stringify(stray),
      "api.crossref.org/works?query.bibliographic": JSON.stringify({ message: { items: [{ DOI: "10.1016/j.chbr.2024.100411", title: [title], issued: { "date-parts": [[2024, 5]] } }] } }),
      "api.openalex.org/works/doi:10.1016%2Fj.chbr.2024.100411": JSON.stringify({
        id: "https://openalex.org/W4393205062",
        ids: { doi: "https://doi.org/10.1016/j.chbr.2024.100411" },
        title,
        publication_year: 2024,
        type: "article",
        authorships: [{ author: { display_name: "Caterina Bérubé" } }],
      }),
    })
    const paper = await resolve(http, "s2-d9b08e17477d834243b420118b5d16137e635395")
    expect(paper).toMatchObject({ id: "doi-10.1016-j.chbr.2024.100411", year: 2024, authors: ["Caterina Bérubé"] })
  })
})

describe("withSubtitle", () => {
  it("adds the subtitle in the short title's own words", () => {
    expect(withSubtitle("My Phone and Me", "My phone and me: understanding people's receptivity to mobile notifications")).toBe(
      "My Phone and Me: understanding people's receptivity to mobile notifications",
    )
    expect(withSubtitle("Hello There! Is Now a Good Time to Talk?", "Hello There! Is Now a Good Time to Talk? Opportune Moments for Proactive Interactions with Smart Speakers")).toBe(
      "Hello There! Is Now a Good Time to Talk? Opportune Moments for Proactive Interactions with Smart Speakers",
    )
    expect(withSubtitle("Outcome bias in decision evaluation.", "Outcome bias in decision evaluation")).toBeUndefined()
    expect(withSubtitle("Attention", "Attentional blink")).toBeUndefined()
  })
})
