import { describe, expect, it } from "vitest"
import { shortVenue, venueOf } from "./format"

describe("shortVenue", () => {
  it("knows common venues by their own acronyms, whatever edition or prefix the service gives", () => {
    expect(shortVenue("Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies")).toBe("IMWUT")
    expect(shortVenue("Proceedings of the ACM on Interactive Mobile Wearable and Ubiquitous Technologies")).toBe("IMWUT")
    expect(shortVenue("Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems")).toBe("CHI")
    expect(shortVenue("Advances in Neural Information Processing Systems 36")).toBe("Advances in Neural Information Processing Systems 36")
    expect(shortVenue("Advances in Neural Information Processing Systems")).toBe("NeurIPS")
    expect(shortVenue("Proceedings of the 29th ACM SIGKDD Conference on Knowledge Discovery and Data Mining")).toBe("KDD")
    expect(shortVenue("International Journal of Human–Computer Studies")).toBe("IJHCS")
  })

  it("makes nothing up: a series name and an unknown journal stay whole", () => {
    expect(shortVenue("Lecture notes in computer science")).toBe("Lecture notes in computer science")
    expect(shortVenue("Applied Cognitive Psychology")).toBe("Applied Cognitive Psychology")
  })
})

describe("venueOf", () => {
  it("names arXiv for a preprint with no venue, and nothing for a paper that only lacks one", () => {
    expect(venueOf({ ids: { arxiv: "2401.00001" } })).toBe("arXiv")
    expect(venueOf({ ids: { arxiv: "2401.00001" }, venue: "ICLR" })).toBe("ICLR")
    expect(venueOf({ ids: { doi: "10.1/x" } })).toBeUndefined()
  })
})
