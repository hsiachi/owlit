import { describe, expect, it } from "vitest"
import type { Agents } from "./agents.ts"
import { failureOf } from "./failure.ts"

const agents = { nameOf: async (id: string) => (id === "codex" ? "Codex" : "Claude Code") } as unknown as Agents
// As the client hears claude-agent-acp's error at the limit
const internal = (message: string) => ({ code: -32603, message: `Internal error: ${message}` })

describe("an agent's usage limit", () => {
  it("is one sentence with the reset time, on a 24-hour clock", async () => {
    expect(await failureOf(agents, "claude-code", internal("You've hit your session limit · resets 2:20am (Asia/Shanghai)"), "")).toEqual({
      text: "Claude Code's usage limit is reached; it resets at 2:20.",
      detail: "You've hit your session limit · resets 2:20am (Asia/Shanghai)",
    })
    expect((await failureOf(agents, "claude-code", internal("You've hit your weekly limit · resets Oct 21, 5pm (Europe/Berlin)"), "")).text).toBe(
      "Claude Code's usage limit is reached; it resets at Oct 21 17:00.",
    )
    // Codex's, as its answer text when the error itself says nothing
    expect((await failureOf(agents, "codex", new Error("Internal error"), "You've hit your usage limit. Upgrade to Plus to continue using Codex, or try again at 8:15 PM.")).text).toBe(
      "Codex's usage limit is reached; it resets at 20:15.",
    )
  })

  it("without a reset time, says only that it is reached", async () => {
    expect(await failureOf(agents, "claude-code", internal("You're out of usage credits"), "")).toEqual({
      text: "Claude Code's usage limit is reached.",
      detail: "You're out of usage credits",
    })
  })

  it("leaves other errors as they were", async () => {
    expect(await failureOf(agents, "claude-code", new Error("Something else broke."), "")).toEqual({ text: "Something else broke." })
  })
})
