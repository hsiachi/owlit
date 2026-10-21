import { describe, expect, it } from "vitest"
import { commandOf, commandRole } from "./commands.ts"

describe("a message's command", () => {
  it("is a known name at the very start, followed by a space, a line's end or nothing", () => {
    expect(commandOf("/review the opening example")).toEqual({ name: "review", rest: "the opening example" })
    expect(commandOf("/revise\nparagraph 2 first")).toEqual({ name: "revise", rest: "paragraph 2 first" })
    expect(commandOf("/go-through")).toEqual({ name: "go-through", rest: "" })
    expect(commandOf("/reviewer please")).toBeNull()
    expect(commandOf("/Users/me/notes.md")).toBeNull()
    expect(commandOf("please /review")).toBeNull()
    expect(commandOf("/threads")).toBeNull()
  })

  it("puts a review in Reviewer, takes a revision out of it, and leaves going through as it is", () => {
    expect(commandRole("review", "coauthor")).toBe("reviewer")
    expect(commandRole("revise", "reviewer")).toBe("assistant")
    expect(commandRole("revise", "coauthor")).toBe("coauthor")
    expect(commandRole("go-through", "reviewer")).toBe("reviewer")
  })
})
