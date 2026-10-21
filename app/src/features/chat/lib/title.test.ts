import { describe, expect, it } from "vitest"
import { titleFrom } from "./title"

describe("titleFrom", () => {
  it("keeps a short question whole and names an empty one", () => {
    expect(titleFrom("What does RAGTruth cover?")).toBe("What does RAGTruth cover?")
    expect(titleFrom("   ")).toBe("New chat")
  })

  it("shows a mention by its label and joins lines", () => {
    expect(titleFrom("Summarise @[Niu et al. 2023]\nbriefly")).toBe("Summarise Niu et al. 2023 briefly")
  })

  it("cuts a long question at a word and ends it with an ellipsis, never mid-word or on a comma", () => {
    const title = titleFrom("Which three tasks does RAGTruth cover, and how were hallucination spans annotated across them?")
    expect(title).toBe("Which three tasks does RAGTruth cover, and how were hallucination spans…")
    expect(title.length).toBeLessThanOrEqual(81)
    expect(titleFrom("Draft a related-work paragraph in this doc, right after my sentence, covering the three RAG benchmarks")).toBe(
      "Draft a related-work paragraph in this doc, right after my sentence, covering…",
    )
    expect(titleFrom(`Compare these two papers on retrieval-augmented generation, ${"x".repeat(80)}`)).toBe("Compare these two papers on retrieval-augmented generation…")
  })

  it("cuts one long word as it is", () => {
    expect(titleFrom("a".repeat(100))).toBe(`${"a".repeat(80)}…`)
  })

  it("drops the find stem when the person wrote a whole question of their own after it", () => {
    expect(titleFrom("Find papers on Compare how RAGTruth and HaluEval annotate spans")).toBe("Compare how RAGTruth and HaluEval annotate spans")
    expect(titleFrom("Find papers on hallucination detection in RAG")).toBe("Find papers on hallucination detection in RAG")
    expect(titleFrom("Find papers on Transformers")).toBe("Find papers on Transformers")
    expect(titleFrom("Find papers on RAG hallucination benchmarks")).toBe("Find papers on RAG hallucination benchmarks")
    expect(titleFrom("Compare the methods and findings of @[Niu et al. 2023] and @[Zheng et al. 2023]")).toBe(
      "Compare the methods and findings of Niu et al. 2023 and Zheng et al. 2023",
    )
  })
})
