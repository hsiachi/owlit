import { describe, expect, it } from "vitest"
import { stripLatex } from "./latex"

describe("stripLatex", () => {
  it("unwraps text commands, nested ones too", () => {
    expect(stripLatex("We propose \\textit{RAGTruth}, a \\emph{corpus}.")).toBe("We propose RAGTruth, a corpus.")
    expect(stripLatex("\\textbf{\\textit{bold italic}} words")).toBe("bold italic words")
    expect(stripLatex("see \\url{https://example.org}")).toBe("see https://example.org")
  })

  it("keeps inline math as its content", () => {
    expect(stripLatex("$n$-gram overlap in $O(n^2)$ time")).toBe("n-gram overlap in O(n^2) time")
    expect(stripLatex("an $\\alpha$ of 0.5")).toBe("an \\alpha of 0.5")
  })

  it("turns \\\\ into a line break and unescapes characters", () => {
    expect(stripLatex("First line.\\\\ Second line.")).toBe("First line.\nSecond line.")
    expect(stripLatex("a 5\\% gain for R\\&D, see \\_x")).toBe("a 5% gain for R&D, see _x")
  })

  it("leaves words it doesn't know alone", () => {
    expect(stripLatex("Plain words stay plain.")).toBe("Plain words stay plain.")
    expect(stripLatex("a \\cite{smith} and \\LaTeX{} macro")).toBe("a \\cite{smith} and \\LaTeX macro")
  })
})
