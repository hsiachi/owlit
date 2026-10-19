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

  it("keeps the text a tool call's diff replaces when a later update brings the diff without it", () => {
    let parts = applyUpdate([], { type: "tool_call", toolCallId: "w", title: "Write a.md", kind: "edit", status: "pending", diff: { path: "a.md", oldText: "old", newText: "new" } })
    parts = applyUpdate(parts, { type: "tool_call_update", toolCallId: "w", status: "completed", diff: { path: "a.md", oldText: "", newText: "new" } })
    expect(parts[0]).toMatchObject({ status: "completed", diff: { oldText: "old", newText: "new" } })
  })
})
