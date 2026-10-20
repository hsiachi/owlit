import { describe, expect, it } from "vitest"
import { clickPlan } from "./click.ts"
import type { Connection, PageState } from "./messages.ts"

const connected: Connection = { state: "connected", workspace: "Thesis" }
const article: PageState = {
  url: "https://dl.acm.org/doi/10.1145/3626772.3657891",
  host: "dl.acm.org",
  pdfTab: false,
  paper: { doi: "10.1145/3626772.3657891", title: "ChroniclingAmericaQA", authors: [], pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/3626772.3657891" },
  inLibrary: null,
}
const pdfTab: PageState = { url: "https://example.org/files/paper.pdf", host: "example.org", pdfTab: true, inLibrary: null }
const inLibrary = (hasPdf: boolean) => ({ id: "p1", title: "ChroniclingAmericaQA", hasPdf })

describe("clickPlan", () => {
  it("adds a paper the Library hasn't got", () => {
    expect(clickPlan({ connection: connected, page: article })).toEqual({ do: "add" })
  })

  it("saves the PDF the page names for a Library paper without one", () => {
    expect(clickPlan({ connection: connected, page: { ...article, inLibrary: inLibrary(false) } })).toEqual({ do: "save", paperId: "p1" })
    expect(clickPlan({ connection: connected, page: { ...pdfTab, inLibrary: inLibrary(false) } })).toEqual({ do: "save", paperId: "p1" })
  })

  it("hands owlit a PDF tab that names no paper, for owlit to place", () => {
    expect(clickPlan({ connection: connected, page: pdfTab })).toEqual({ do: "take" })
  })

  it("says there is nothing to do for a paper with its PDF, or a page without a paper", () => {
    expect(clickPlan({ connection: connected, page: { ...article, inLibrary: inLibrary(true) } })).toEqual({ do: "say", outcome: { kind: "has-pdf", paperId: "p1" } })
    const noPdfNamed = { ...article, paper: { ...article.paper!, pdfUrl: undefined }, inLibrary: inLibrary(false) }
    expect(clickPlan({ connection: connected, page: noPdfNamed })).toEqual({ do: "say", outcome: { kind: "none-named", paperId: "p1" } })
    expect(clickPlan({ connection: connected, page: { ...article, paper: undefined } })).toEqual({ do: "say", outcome: { kind: "no-paper" } })
    expect(clickPlan({ connection: connected, page: null })).toEqual({ do: "say", outcome: { kind: "no-paper" } })
  })

  it("says plainly that a page of search results lists papers", () => {
    const scholar = { url: "https://scholar.google.com/scholar?q=attention", host: "scholar.google.com", pdfTab: false, inLibrary: null }
    expect(clickPlan({ connection: connected, page: scholar })).toEqual({ do: "say", outcome: { kind: "no-paper", listing: "Google Scholar" } })
  })

  it("says why it can't act before looking at the page", () => {
    const plan = (connection: Connection) => clickPlan({ connection, page: article })
    expect(plan({ state: "offline", paired: true })).toEqual({ do: "say", outcome: { kind: "offline" } })
    expect(plan({ state: "unpaired" })).toEqual({ do: "say", outcome: { kind: "unpaired" } })
    expect(plan({ state: "pairing" })).toEqual({ do: "say", outcome: { kind: "pairing" } })
    expect(plan({ state: "elsewhere", name: "Owlit Dev" })).toEqual({ do: "say", outcome: { kind: "elsewhere", name: "Owlit Dev" } })
    expect(plan({ state: "connected", workspace: null })).toEqual({ do: "say", outcome: { kind: "no-workspace" } })
  })
})
