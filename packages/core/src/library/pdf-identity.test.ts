import { describe, expect, it } from "vitest"
import { isThisPaper, sameTitle, surelyOf } from "./pdf-identity.ts"

describe("telling a PDF by its title", () => {
  it("reads a Chinese title by its characters, and a short one as long enough", () => {
    const title = "基于大语言模型的文献综述生成"
    expect(sameTitle(title, "基于大语言模型的文献综述生成。")).toBe(true)
    expect(isThisPaper({ text: "摘要 基于大语言模型的 文献综述生成 张三" }, { title })).toBe("yes")
    expect(isThisPaper({ text: "摘要 一种图神经网络的推荐方法 李四" }, { title })).toBe("no")
    expect(surelyOf({ text: "基于大语言模型的文献综述生成" }, [{ title: "另一篇论文的题目很长很长" }, { title }])?.title).toBe(title)
  })

  it("still wants a Latin title of some length before it judges", () => {
    expect(isThisPaper({ text: "Editorial notes" }, { title: "Editorial" })).toBe("unknown")
    expect(sameTitle("Attention Is All You Need", "attention is all you need!")).toBe(true)
  })
})
