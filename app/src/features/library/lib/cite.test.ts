import { describe, expect, it } from "vitest"
import type { Paper, Thread } from "@owlit/protocol"
import { bibtex, bibtexAll, citedPapers } from "./cite"

const paper = (over: Partial<Paper> & Pick<Paper, "id" | "title" | "authors">): Paper => ({
  ids: {},
  addedAt: 0,
  addedBy: "p_1",
  starred: false,
  status: "unread",
  tags: [],
  year: 2023,
  ...over,
})

const keyOf = (entry: string) => /^@\w+\{([^,]+),/.exec(entry)?.[1]
const keysOf = (bib: string) => [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1])

describe("bibtex keys", () => {
  it("are family name, year and the first real word of the title", () => {
    expect(keyOf(bibtex(paper({ id: "a", title: "The Large Language Model Survey", authors: ["Xin Wang"] })))).toBe("wang2023large")
  })

  it("take the DOI's suffix when the first author's name has no Latin letters", () => {
    const p = paper({ id: "cn1", title: "检索增强生成综述", authors: ["王小明", "李华"], ids: { doi: "10.13328/j.cnki.jos.006543" } })
    expect(keyOf(bibtex(p))).toBe("j.cnki.jos.006543")
  })

  it("take the paper's id when there is no DOI either, never anon", () => {
    const p = paper({ id: "s2-8f3a91", title: "大语言模型的检索增强", authors: ["张三"] })
    expect(keyOf(bibtex(p))).toBe("s2-8f3a91")
  })

  it("are made unique across one copy with letters after the first", () => {
    const a = paper({ id: "a", title: "Large models read papers", authors: ["Xin Wang"] })
    const b = paper({ id: "b", title: "Large models write papers", authors: ["Yu Wang"] })
    const c = paper({ id: "c", title: "Large models review papers", authors: ["Li Wang"] })
    const d = paper({ id: "d", title: "Attention", authors: ["Ashish Vaswani"], year: 2017 })
    expect(keysOf(bibtexAll([a, d, b, c]))).toEqual(["wang2023large", "vaswani2017attention", "wang2023largea", "wang2023largeb"])
  })
})

describe("bibtex fields", () => {
  it("escape TeX's special characters, the backslash and braces included", () => {
    const entry = bibtex(paper({ id: "a", title: "Costs {and} 50% of C:\\ ~ x^2 & y_1", authors: ["Ann Lee"] }))
    expect(entry).toContain("title = {{Costs \\{and\\} 50\\% of C:\\textbackslash{} \\textasciitilde{} x\\textasciicircum{}2 \\& y\\_1}}")
  })

  it("leave a DOI as written", () => {
    expect(bibtex(paper({ id: "a", title: "T", authors: ["Ann Lee"], ids: { doi: "10.1000/a_b" } }))).toContain("doi = {10.1000/a_b}")
  })
})

describe("citedPapers", () => {
  const lewis = paper({ id: "lewis", title: "Retrieval-augmented generation", authors: ["Patrick Lewis"], year: 2020 })
  const asai = paper({ id: "asai", title: "Self-RAG", authors: ["Akari Asai"] })
  const library: Record<string, Paper> = { lewis, asai }
  // A paper known under an older id, as the Library's aliases map it
  const aliases: Record<string, string> = { "arxiv-2005.11401": "lewis" }
  const resolve = (id: string) => library[id] ?? (aliases[id] ? library[aliases[id]] : undefined)
  const threads = {
    t1: { rows: [{ id: "found", paper: { title: "A paper a thread found", authors: ["Mei Chen"], ids: { doi: "10.1/x" }, year: 2024 } }] },
  } as unknown as Record<string, Thread>

  it("lists the doc's papers in order of first use, each once", () => {
    const md = [
      "Retrieval helps [Asai et al. 2023](owlit://library/asai#p3 \"it reflects\").",
      "It began with [Lewis et al. 2020](owlit://library/lewis) and [Asai et al.](owlit://library/asai).",
      "The same paper by its old id: [RAG](owlit://library/arxiv-2005.11401#p2).",
    ].join("\n\n")
    expect(citedPapers(md, resolve, {}).map((p) => p.id)).toEqual(["asai", "lewis"])
  })

  it("takes a paper not in the Library from the thread that found it, and leaves out one nobody knows", () => {
    const md = "[Chen 2024](owlit://library/found), [Lewis](owlit://library/lewis), [Gone](owlit://library/nobody), [a doc](owlit://docs/notes.md)"
    const cited = citedPapers(md, resolve, threads)
    expect(cited.map((p) => p.id)).toEqual(["found", "lewis"])
    expect(cited[0]).toMatchObject({ title: "A paper a thread found", ids: { doi: "10.1/x" } })
  })
})
