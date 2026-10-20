import { describe, expect, it } from "vitest"
import { citationLink, threadUri, docUri, linkTitleText, MENTION_LINK, paperUri, parseOwlitUri } from "./uri.ts"

describe("parseOwlitUri", () => {
  it.each([
    [paperUri("p6"), { kind: "paper", id: "p6" }],
    [paperUri("p6", "tf-filter"), { kind: "paper", id: "p6", passage: "tf-filter" }],
    ["owlit://library/p6#abstract", { kind: "paper", id: "p6", abstract: true }],
    ["owlit://library/p6#p12", { kind: "paper", id: "p6", page: 12 }],
    [docUri("writing/Related work.md"), { kind: "doc", path: "writing/Related work.md" }],
    [threadUri("uist-2026-papers"), { kind: "thread", id: "uist-2026-papers" }],
    [threadUri("uist-2026-papers", "eval"), { kind: "thread", id: "uist-2026-papers", group: "eval" }],
    ["owlit://chat/c1", { kind: "chat", id: "c1" }],
    ["owlit://settings/proxy", { kind: "settings", section: "proxy" }],
    ["owlit://settings", { kind: "settings", section: undefined }],
    ["owlit://shortcuts", { kind: "shortcuts" }],
    ["owlit://highlight/h1", null],
    ["https://example.com", null],
  ])("%s", (uri, parsed) => {
    expect(parseOwlitUri(uri)).toEqual(parsed)
  })
})

describe("MENTION_LINK", () => {
  it("finds a mention with escaped brackets and leaves other owlit links alone", () => {
    expect(MENTION_LINK.exec("see [Lam \\[2024\\]](owlit://library/p1).")?.slice(1)).toEqual(["Lam \\[2024\\]", "owlit://library/p1"])
    expect(MENTION_LINK.exec("[p. 3](owlit://highlight/h1)")).toBeNull()
  })
})

describe("a citation's link", () => {
  it("carries its sentence as the title, and gives it back word for word", () => {
    const quote = 'The model said "no" \\ twice.'
    const link = citationLink("p. 4", "doi-10.1-x", { quote, page: 4 })
    expect(link).toBe('[p. 4](owlit://library/doi-10.1-x#p4 "The model said \\"no\\" \\\\ twice.")')
    const title = /\((\S+) (".*")\)$/.exec(link)!
    expect(parseOwlitUri(title[1]!)).toEqual({ kind: "paper", id: "doi-10.1-x", page: 4 })
    expect(linkTitleText(title[2]!)).toBe(quote)
  })

  it("puts a quote that runs over lines on one", () => {
    expect(citationLink("p. 2", "x", { quote: "Readers skim\n\nthe abstract\nfirst. ", page: 2 })).toBe('[p. 2](owlit://library/x#p2 "Readers skim the abstract first.")')
  })
})

