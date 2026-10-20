import { describe, expect, it } from "vitest"
import { quoteTarget, shorter } from "./passages"

describe("quoteTarget", () => {
  it("opens and closes an English quote with words", () => {
    const t = quoteTarget("Retrieval keeps the answer close to its sources, which matters most when the model is unsure of a fact", 3)
    expect(t.start).toBe("Retrieval keeps the answer close to its sources,")
    expect(t.end).toBe("when the model is unsure of a fact")
    expect(t.page).toBe(2)
  })

  it("opens and closes a Chinese quote with characters, so a line break inside it can't hide it", () => {
    const t = quoteTarget("检索增强生成方法通过在回答前检索相关段落，使模型的回答更贴近原始文献的内容。")
    expect(t.start).toBe("检索增强生成方法通过在回")
    expect(t.end).toBe("答更贴近原始文献的内容。")
  })

  it("keeps a short Chinese quote whole", () => {
    expect(quoteTarget("检索增强生成")).toMatchObject({ start: "检索增强生成", end: "检索增强生成" })
  })
})

describe("shorter", () => {
  it("cuts a Chinese phrase by characters, down to four", () => {
    expect(shorter("检索增强生成方法", false)).toEqual(["检索增强生成方法", "检索增强生成方", "检索增强生成", "检索增强生", "检索增强"])
    expect(shorter("检索增强生成方法", true).at(-1)).toBe("生成方法")
  })

  it("cuts an English phrase by words, down to three", () => {
    expect(shorter("one two three four", false)).toEqual(["one two three four", "one two three"])
  })
})
