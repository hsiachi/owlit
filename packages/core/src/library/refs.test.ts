import { describe, expect, it } from "vitest"
import { paperIdOf, parseRef } from "./refs.ts"

describe("parseRef", () => {
  it.each([
    ["2408.00447", { kind: "arxiv", value: "2408.00447" }],
    ["2408.00447v3", { kind: "arxiv", value: "2408.00447" }],
    ["arXiv:1706.03762v7", { kind: "arxiv", value: "1706.03762" }],
    ["0704.0001", { kind: "arxiv", value: "0704.0001" }],
    ["hep-th/9901001", { kind: "arxiv", value: "hep-th/9901001" }],
    ["math.GT/0309136v2", { kind: "arxiv", value: "math.GT/0309136" }],
    ["https://arxiv.org/abs/2408.00447v2", { kind: "arxiv", value: "2408.00447" }],
    ["https://arxiv.org/pdf/2408.00447.pdf", { kind: "arxiv", value: "2408.00447" }],
    ["arxiv.org/abs/hep-th/9901001", { kind: "arxiv", value: "hep-th/9901001" }],
    ["https://doi.org/10.48550/arXiv.2408.00447", { kind: "arxiv", value: "2408.00447" }],
    ["10.1145/3626772.3657891", { kind: "doi", value: "10.1145/3626772.3657891" }],
    ["doi:10.1145/3626772.3657891.", { kind: "doi", value: "10.1145/3626772.3657891" }],
    ["https://doi.org/10.1038/S41586-021-03819-2", { kind: "doi", value: "10.1038/s41586-021-03819-2" }],
    ["https://dl.acm.org/doi/pdf/10.1145/3626772.3657891", { kind: "doi", value: "10.1145/3626772.3657891" }],
    ["https://onlinelibrary.wiley.com/doi/full/10.1002/asi.24750", { kind: "doi", value: "10.1002/asi.24750" }],
    ["https://link.springer.com/content/pdf/10.1007/s11192-023-04640-1.pdf", { kind: "doi", value: "10.1007/s11192-023-04640-1" }],
    ["https://www.semanticscholar.org/paper/Attention-is-All-you-Need-Vaswani/204e3073870fae3d05bcbc2f6a8e263d9b72e776", { kind: "s2", value: "204e3073870fae3d05bcbc2f6a8e263d9b72e776" }],
    ["204E3073870FAE3D05BCBC2F6A8E263D9B72E776", { kind: "s2", value: "204e3073870fae3d05bcbc2f6a8e263d9b72e776" }],
    ["https://openalex.org/W2741809807", { kind: "openalex", value: "W2741809807" }],
    ["w2741809807", { kind: "openalex", value: "W2741809807" }],
    ["https://example.org/papers/42", { kind: "url", value: "https://example.org/papers/42" }],
    ["doi-10.1145-3626772.3657891", { kind: "doi", value: "10.1145/3626772.3657891" }],
    ["doi-10.1177-00380385241263810", { kind: "doi", value: "10.1177/00380385241263810" }],
    ["arxiv-2507.12143", { kind: "arxiv", value: "2507.12143" }],
    ["arxiv-math.GT-0309136", { kind: "arxiv", value: "math.GT/0309136" }],
  ])("%s", (input, expected) => {
    expect(parseRef(input)).toEqual(expected)
  })

  it.each(["", "attention is all you need", "2408", "transformer 2408.00447 survey", "1.5 million"])("is not a reference: %s", (input) => {
    expect(parseRef(input)).toBeUndefined()
  })
})

describe("paperIdOf", () => {
  it("prefers DOI, then arXiv, then Semantic Scholar", () => {
    expect(paperIdOf({ doi: "10.1145/3626772.3657891", arxiv: "2403.17859" })).toBe("doi-10.1145-3626772.3657891")
    expect(paperIdOf({ arxiv: "2408.00447v2", s2: "abc" })).toBe("arxiv-2408.00447")
    expect(paperIdOf({ arxiv: "hep-th/9901001" })).toBe("arxiv-hep-th-9901001")
    expect(paperIdOf({ s2: "204E3073870FAE3D05BCBC2F6A8E263D9B72E776" })).toBe("s2-204e3073870fae3d05bcbc2f6a8e263d9b72e776")
    expect(paperIdOf({ url: "https://example.org" })).toBeUndefined()
  })

  it("keeps the id a safe folder name", () => {
    expect(paperIdOf({ doi: "10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-o" })).toBe(
      "doi-10.1002-_sici_1097-4571_199806_49_8_693__aid-asi4_3.0.co_2-o",
    )
  })
})
