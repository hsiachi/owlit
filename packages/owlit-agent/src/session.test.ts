import { describe, expect, it } from "vitest"
import { contentOf } from "./session.ts"

describe("the user's message", () => {
  const blocks = [
    { type: "text" as const, text: "What does this show?" },
    { type: "resource_link" as const, uri: "file:///ws/.owlit/chats/c1/files/shot.png", name: "shot.png", title: "shot.png" },
    { type: "image" as const, data: "cG5n", mimeType: "image/png", uri: "file:///ws/.owlit/chats/c1/files/shot.png" },
  ]

  it("is plain text when it carries no picture", () => {
    expect(contentOf(blocks.slice(0, 2), true)).toBe("What does this show?\n\n[shot.png](file:///ws/.owlit/chats/c1/files/shot.png)")
  })

  it("passes an attached image to a model that takes images", () => {
    expect(contentOf(blocks, true)).toEqual([
      { type: "text", text: "What does this show?\n\n[shot.png](file:///ws/.owlit/chats/c1/files/shot.png)" },
      { type: "image", data: "cG5n", mimeType: "image/png" },
    ])
  })

  it("tells a text-only model the picture was left out", () => {
    const content = contentOf(blocks, false)
    expect(typeof content).toBe("string")
    expect(content).toContain("[An image (file:///ws/.owlit/chats/c1/files/shot.png) was left out: this model takes text only.")
  })
})
