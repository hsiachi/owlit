import { describe, expect, it } from "vitest"
import { mentionInsertion } from "./mention-insert"

const link = "[Niu et al. 2023](owlit://library/p1)"

describe("mentionInsertion", () => {
  it("adds a space when the mention ends a line or runs into a word", () => {
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "")).toBe(`${link} `)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "\n")).toBe(`${link} `)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "g")).toBe(`${link} `)
  })

  it("adds none before a space or punctuation, so the sentence keeps one space and no gap before a stop", () => {
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", " ")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ".")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ",")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ")")).toBe(link)
  })
})
