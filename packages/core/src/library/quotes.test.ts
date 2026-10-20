import { describe, expect, it } from "vitest"
import { findQuote } from "./quotes.ts"

const QUOTE = "In the RAG-Token model we can draw a different latent document for each target token and marginalize accordingly."

describe("findQuote", () => {
  it("finds a quote in a paper's text across line breaks and hyphenation", () => {
    const text = "<!-- page 1 -->\n\nIntro.\n\n<!-- page 3 -->\n\nRAG-Token Model In the RAG-Token model we can draw a differ-\nent latent document for each target token and marginalize accordingly. This allows"
    expect(findQuote(text, QUOTE)).toBe(3)
    expect(findQuote(text, "Not in the paper at all")).toBeNull()
  })

  it("gives the page a quote starts on when it runs over a page break", () => {
    const text = "<!-- page 4 -->\n\nThe retrieved document is held fixed\n\n<!-- page 5 -->\n\nfor the whole sequence.\n\n<!-- page 6 -->\n\nResults."
    expect(findQuote(text, "is held fixed for the whole sequence")).toBe(4)
  })

  it("finds a Chinese quote written as it reads, though the text has a space where a line broke", () => {
    const text = "<!-- page 2 -->\n\n检索增强生成方法在长文 本问答中表现良好。"
    expect(findQuote(text, "检索增强生成方法在长文本问答中表现良好")).toBe(2)
    expect(findQuote(text, "长文本问答")).toBe(2)
  })
})
