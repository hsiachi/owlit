import { describe, expect, it } from "vitest"
import { Http } from "../net/http.ts"
import { parseYears, relatedOf, searchSource } from "./discover.ts"
import { searchText } from "./sources/openalex.ts"

describe("parseYears", () => {
  it("reads a year, a range and open ends", () => {
    expect(parseYears("2023")).toEqual({ from: 2023, to: 2023 })
    expect(parseYears("2019-2023")).toEqual({ from: 2019, to: 2023 })
    expect(parseYears("2023-")).toEqual({ from: 2023, to: undefined })
    expect(parseYears("-2023")).toEqual({ from: undefined, to: 2023 })
    expect(parseYears(" ")).toBeUndefined()
  })

  it("refuses what isn't a year", () => {
    expect(() => parseYears("last year")).toThrow(/year should look like/)
    expect(() => parseYears("2024-2020")).toThrow(/ends before it starts/)
  })
})

// OpenAlex's answer once the day's allowance is gone; Semantic Scholar answers as asked
function quotaGone(s2: unknown = { data: [] }) {
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(url)
    if (url.includes("api.openalex.org"))
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "18000" } })
    return new Response(JSON.stringify(s2))
  }) as unknown as typeof globalThis.fetch
  return { http: new Http({ fetch, userAgent: "t", retryBaseMs: 1 }), asked }
}

describe("OpenAlex's daily allowance", () => {
  it("tells the agent when it comes back and what to use meanwhile, without trying again", async () => {
    const { http, asked } = quotaGone()
    const error = await searchSource(http, "proactive reminders", 10, "openalex", {}, {}).catch((e) => e)
    expect(error.message).toMatch(/^OpenAlex's daily allowance is used up; it comes back in about 5 hours \(\d\d:\d\d UTC\)\. Trying again before then fails the same way\. Until then use library_search with source s2 or arxiv\. A free OpenAlex API key gives ten times as much/)
    expect(asked).toHaveLength(1)
    // With a key, there's no key to suggest
    const keyed = await searchSource(quotaGone().http, "x", 10, "openalex", {}, { openalexApiKey: "k" }).catch((e) => e)
    expect(keyed.message).not.toMatch(/API key/)
  })

  it("follows a published paper's citations through Semantic Scholar instead", async () => {
    const { http, asked } = quotaGone({ data: [] })
    const found = await relatedOf(http, { doi: "10.1145/3626772.3657891", openalex: "W1" }, "references", 10, {}, {})
    expect(found.source).toBe("s2")
    expect(asked.at(-1)).toContain("api.semanticscholar.org/graph/v1/paper/DOI:10.1145%2F3626772.3657891/references")
  })
})

describe("searchText", () => {
  it("drops the wildcards OpenAlex refuses and keeps the rest", () => {
    expect(searchText("What brings intentions to mind? An in situ study")).toBe("What brings intentions to mind An in situ study")
    expect(searchText("proactiv* agents: a survey")).toBe("proactiv agents: a survey")
  })
})
