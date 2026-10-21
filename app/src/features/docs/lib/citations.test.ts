import "@/test/fake-bridge"
import type { CitationCounts } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { citationsLine, citationsSentence } from "./citations"

const counts = (c: Partial<CitationCounts>): CitationCounts => {
  const all = { read: 0, inPaper: 0, abstract: 0, notFound: 0, noText: 0, whole: 0, notRead: 0, bare: 0, person: 0, ...c }
  const notReadInPaper = all.abstract + all.notFound + all.noText + all.notRead + all.bare
  return { ...all, total: Object.values(all).reduce((a, b) => a + b, 0), notReadInPaper }
}

describe("the doc's citations line", () => {
  it("names only what wasn't read in the paper, and each kind of it", () => {
    expect(citationsSentence(counts({ read: 18, abstract: 6, notRead: 2 }))).toBe("8 of 26 citations not read in the paper · 6 from the abstract · 2 not read")
    expect(citationsLine(counts({ abstract: 1 }))[0]!.states).toEqual(["abstract", "not-found", "no-text", "not-read", "bare"])
  })

  it("says nothing when everything was read in the paper or is the person's own", () => {
    expect(citationsLine(counts({ read: 3, inPaper: 2, whole: 1, person: 4 }))).toEqual([])
  })
})
