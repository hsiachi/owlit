import { describe, expect, it } from "vitest"
import { cleanPdfText } from "./highlights"

describe("cleanPdfText", () => {
  it("joins Chinese lines without a space", () => {
    expect(cleanPdfText(["检索增强", "生成方法在问答中", "表现更好。"])).toBe("检索增强生成方法在问答中表现更好。")
  })

  it("keeps a space where a line of Chinese meets a Latin word", () => {
    expect(cleanPdfText(["我们使用", "Transformer 模型"])).toBe("我们使用 Transformer 模型")
  })

  it("joins English lines with a space and mends a hyphenated word", () => {
    expect(cleanPdfText(["a retrieval-aug-", "mented model that", "answers"])).toBe("a retrieval-augmented model that answers")
  })
})
