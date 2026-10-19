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

  it("stays shut in an email address or after a space in the query", () => {
    expect(mentionAtEnd("me@example")).toBeNull()
    expect(mentionAtEnd("@lewis 2020")).toBeNull()
  })
})
