import { describe, expect, it } from "vitest"
import { mentionInsertion } from "./mention-insert"

const link = "[Niu et al. 2023](owlit://library/p1)"

describe("mentionInsertion", () => {
  it("adds a space when the mention would run into a word or a number", () => {
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "g")).toBe(`${link} `)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "7")).toBe(`${link} `)
  })

  it("adds none at the end of a line, so a stop typed next sits right after the citation", () => {
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", "\n")).toBe(link)
  })

  it("adds none before a space or punctuation, so the sentence keeps one space and no gap before a stop", () => {
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", " ")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ".")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ",")).toBe(link)
    expect(mentionInsertion("Niu et al. 2023", "owlit://library/p1", ")")).toBe(link)
  })
})
