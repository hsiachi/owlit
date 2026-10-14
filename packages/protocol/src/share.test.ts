import { describe, expect, it } from "vitest"
import { anchorAt, citedPaperIds, findAnchor, locateInMarkdown, readableText, shareableMarkdown } from "./share.ts"

describe("citedPaperIds", () => {
  it("lists cited papers once, in order, outside code", () => {
    const doc = "As [Zheng 2023](owlit://library/zheng23#p5) and [Wang](owlit://library/wang23), again [Z](owlit://library/zheng23).\n\n`[x](owlit://library/code)` ```\n[y](owlit://library/fence)\n```"
    expect(citedPaperIds(doc)).toEqual(["zheng23", "wang23"])
  })

  it("leaves out pictures, docs and collections", () => {
    expect(citedPaperIds("![a](owlit://library/p1) [b](owlit://docs/x.md) [c](owlit://collections/t)")).toEqual([])
  })
})

describe("shareableMarkdown", () => {
  const shared = (id: string) => id !== "secret"

  it("keeps web links and citations of shared papers", () => {
    const doc = "See [Zheng 2023](owlit://library/zheng23#p5), [the site](https://example.org) and ![fig](https://example.org/f.png)."
    expect(shareableMarkdown(doc, shared)).toBe(doc)
  })

  it("turns links into the workspace into their words", () => {
    const doc = "[draft](owlit://docs/a%20b.md), [topic](owlit://collections/t), [chat](owlit://chat/c1), [file](notes/x.md), [[Ideas]], [[folder/Plan|the plan]], [kept back](owlit://library/secret), ![local](figs/a.png)"
    expect(shareableMarkdown(doc, shared)).toBe("draft, topic, chat, file, Ideas, the plan, kept back, local")
  })

  it("drops source comments and front matter, and unmarks highlights", () => {
    expect(shareableMarkdown("---\ntags: x\n---\n# Title <!-- private -->\n==key== point", shared)).toBe("# Title \nkey point")
  })

  it("leaves code alone", () => {
    const doc = "```\n[[not a link]] <!-- kept -->\n```\n`[a](owlit://docs/x.md)`"
    expect(shareableMarkdown(doc, shared)).toBe(doc)
  })
})

describe("readableText", () => {
  it("reads as drawn, each character traced to the source", () => {
    const source = "## Bias\n- **Position.** See [Zheng 2023](owlit://library/z) and [[Plan|the plan]]."
    const { text, at } = readableText(source)
    expect(text).toBe("Bias\nPosition. See Zheng 2023 and the plan.")
    const z = text.indexOf("Zheng")
    expect(source.slice(at[z], at[z] + 5)).toBe("Zheng")
    const p = text.indexOf("the plan")
    expect(source.slice(at[p], at[p + 7] + 1)).toBe("the plan")
  })
})

describe("anchors", () => {
  it("finds the occurrence whose surroundings match", () => {
    const text = "one cat here. two cat there."
    const second = text.lastIndexOf("cat")
    expect(findAnchor(text, anchorAt(text, second, second + 3))).toBe(second)
    expect(findAnchor(text, { quote: "dog", prefix: "", suffix: "" })).toBeNull()
  })

  it("finds words a reader saw in the source that has marks around them", () => {
    const source = "**Verbosity.** Longer answers win ([Dubois 2024](owlit://library/d)); people too."
    const seen = readableText(source).text
    const from = seen.indexOf("answers win (Dubois")
    const spot = locateInMarkdown(source, anchorAt(seen, from, from + "answers win (Dubois".length))
    expect(spot && source.slice(spot.from, spot.to)).toBe("answers win ([Dubois")
    expect(locateInMarkdown(source, { quote: "gone words", prefix: "", suffix: "" })).toBeNull()
  })
})
