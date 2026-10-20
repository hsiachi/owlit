import { describe, expect, it } from "vitest"
import type { Paper } from "@owlit/protocol"
import { bibtex, bibtexAll } from "./cite"

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
