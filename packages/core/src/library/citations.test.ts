import type { PaperRecord } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { Http } from "../net/http.ts"
import { CITATIONS_TTL_MS, citationsDue, countCitations } from "./citations.ts"

// Answers by URL, and records each request with its body
function httpServing(answer: (url: string, body?: string) => unknown) {
  const asked: { url: string; body?: string }[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : undefined
    asked.push({ url, body })
    return new Response(JSON.stringify(answer(url, body)))
  }) as unknown as typeof globalThis.fetch
  return { http: new Http({ fetch, userAgent: "owlit-test", retryBaseMs: 1 }), asked }
}

const record = (over: Partial<PaperRecord>): PaperRecord => ({ version: 1, id: "doi-10.1-a", ids: { doi: "10.1/a" }, title: "A", authors: [], fields: {}, ...over })

describe("citationsDue", () => {
  const now = Date.UTC(2026, 9, 14)
  it("counts a service's record never counted since counts were kept current, or counted over a month ago", () => {
    expect(citationsDue(record({ fetchedAt: now }), now)).toBe(true)
    expect(citationsDue(record({ fetchedAt: now, citationsAt: now - 2 * 24 * 3600 * 1000 }), now)).toBe(false)
    expect(citationsDue(record({ fetchedAt: now, citationsAt: now - CITATIONS_TTL_MS - 1 }), now)).toBe(true)
  })

  it("leaves a record written by hand, or one with nothing to look it up by", () => {
    expect(citationsDue(record({}), now)).toBe(false)
    expect(citationsDue(record({ fetchedAt: now, ids: { url: "https://example.org/a" } }), now)).toBe(false)
  })
})

describe("countCitations", () => {
  it("asks OpenAlex by id and by DOI in one request each, and Semantic Scholar only for the rest", async () => {
    const { http, asked } = httpServing((url, body) => {
      if (url.includes("filter=openalex")) return { results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.1/a", cited_by_count: 120 }] }
      if (url.includes("filter=doi")) return { results: [{ id: "https://openalex.org/W2", doi: "https://doi.org/10.1/b", cited_by_count: 0 }] }
      if (url.includes("paper/batch")) return (JSON.parse(body!) as { ids: string[] }).ids.map((id) => (id === "ARXIV:2401.00001" ? { citationCount: 9 } : null))
      throw new Error(`unexpected ${url}`)
    })
    const counted = await countCitations(
      http,
      [
        { id: "a", ids: { openalex: "W1", doi: "10.1/a" } },
        { id: "b", ids: { doi: "10.1/B" } },
        { id: "c", ids: { doi: "10.1/c" } },
        { id: "d", ids: { arxiv: "2401.00001" } },
        { id: "e", ids: { arxiv: "2401.00002" } },
      ],
      {},
    )
    expect(Object.fromEntries(counted)).toEqual({
      a: { count: 120, source: "openalex" },
      b: { count: 0, source: "openalex" },
      d: { count: 9, source: "s2" },
    })
    expect(asked.filter((a) => a.url.includes("api.openalex.org"))).toHaveLength(2)
    // OpenAlex didn't know c; e is a preprint OpenAlex isn't asked about
    expect(JSON.parse(asked.find((a) => a.url.includes("paper/batch"))!.body!)).toEqual({ ids: ["DOI:10.1/c", "ARXIV:2401.00001", "ARXIV:2401.00002"] })
  })
})
