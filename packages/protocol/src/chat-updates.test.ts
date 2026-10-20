import { describe, expect, it } from "vitest"
import type { ChatMessage } from "./chat.ts"
import { applyUpdate, withoutAgentError } from "./chat-updates.ts"

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

describe("withoutAgentError", () => {
  const reply = (status: ChatMessage["status"], ...texts: string[]): ChatMessage => ({ id: "a", role: "assistant", createdAt: 1, status, parts: texts.map((text) => ({ type: "text" as const, text })) })
  const SLEPT = "API Error: Your computer went to sleep mid-response. The response above may be incomplete."

  it("takes Claude Code's error line off a finished answer, and the reply broke", () => {
    expect(withoutAgentError(reply("done", "The first half.\n\n" + SLEPT))).toMatchObject({ status: "error", errorDetail: SLEPT, parts: [{ type: "text", text: "The first half." }] })
    // Run straight on from the answer, as two messages without ids fold into one part
    expect(withoutAgentError(reply("done", "The first half." + SLEPT))).toMatchObject({ status: "error", parts: [{ type: "text", text: "The first half." }] })
    // Its own message, after the answer's
    expect(withoutAgentError(reply("done", "The first half.", SLEPT))).toMatchObject({ status: "error", parts: [{ type: "text", text: "The first half." }] })
  })

  it("leaves a finished answer that only mentions an error, or ends on a paragraph of its own starting Error:", () => {
    for (const text of ["When the API Error: 529 shows, wait a minute.", "The log said:\n\nError: file not found", "Look for API Error: lines in the log, then tell me."]) {
      const message = reply("done", text)
      expect(withoutAgentError(message)).toBe(message)
    }
  })

  it("keeps the usage-limit and sign-in text of a failed reply as its detail", () => {
    expect(withoutAgentError(reply("error", "Partly.", "You've hit your session limit · resets 2:20am"))).toMatchObject({ parts: [{ type: "text", text: "Partly." }], errorDetail: "You've hit your session limit · resets 2:20am" })
  })
})
