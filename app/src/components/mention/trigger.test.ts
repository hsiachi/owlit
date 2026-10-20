import { describe, expect, it } from "vitest"
import { mentionAtEnd } from "./trigger"

describe("the @ trigger", () => {
  it("opens after a space, a bracket or at the start", () => {
    expect(mentionAtEnd("@lew")).toEqual({ query: "lew", length: 4 })
    expect(mentionAtEnd("as shown (@lew")).toEqual({ query: "lew", length: 4 })
  })

  it("opens right after Chinese, and on a full-width ＠", () => {
    expect(mentionAtEnd("如@Lewis")).toEqual({ query: "Lewis", length: 6 })
    expect(mentionAtEnd("检索，@")).toEqual({ query: "", length: 1 })
    expect(mentionAtEnd("如＠检索")).toEqual({ query: "检索", length: 3 })
  })

  it("stays shut in an email address", () => {
    expect(mentionAtEnd("me@example")).toBeNull()
  })

  it("takes one word, or in a doc several, until a punctuation mark or two spaces", () => {
    const words = { words: true }
    expect(mentionAtEnd("@lewis 2020")).toBeNull()
    expect(mentionAtEnd("as in @vaswani attention", words)).toEqual({ query: "vaswani attention", length: 18 })
    expect(mentionAtEnd("@lewis ", words)).toEqual({ query: "lewis ", length: 7 })
    expect(mentionAtEnd("@ruiz-garcía o'neil", words)).toEqual({ query: "ruiz-garcía o'neil", length: 19 })
    expect(mentionAtEnd("@lewis, then more", words)).toBeNull()
    expect(mentionAtEnd("@lewis  then", words)).toBeNull()
    expect(mentionAtEnd("@ lewis", words)).toBeNull()
    expect(mentionAtEnd(`@${"word ".repeat(9)}`, words)).toBeNull()
  })
})
