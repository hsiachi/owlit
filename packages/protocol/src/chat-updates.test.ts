import { describe, expect, it } from "vitest"
import { applyUpdate } from "./chat-updates.ts"

describe("applyUpdate", () => {
  it("keeps one notice of a silent agent, last, until the agent's next word", () => {
    let parts = applyUpdate([], { type: "agent_message_chunk", text: "Hm." })
    parts = applyUpdate(parts, { type: "notice", notice: "silent", since: 1 })
    parts = applyUpdate(parts, { type: "notice", notice: "silent", since: 2 })
    expect(parts).toEqual([{ type: "text", text: "Hm." }, { type: "notice", notice: "silent", since: 2 }])
    expect(applyUpdate(parts, { type: "agent_message_chunk", text: " Done." })).toEqual([{ type: "text", text: "Hm. Done." }])
  })
})
