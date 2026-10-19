import { roleSentences } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { systemPrompt } from "./prompt.ts"

const prompt = (role: "reviewer" | "assistant" | "coauthor") => systemPrompt({ role, background: false, workspace: "/ws", today: "2026-10-20" })

describe("systemPrompt", () => {
  it("says the role in the sentences the person reads, without commands the engine can't run", () => {
    for (const role of ["reviewer", "assistant", "coauthor"] as const) {
      for (const sentence of roleSentences(role, { commands: false })) expect(prompt(role)).toContain(sentence)
    }
    expect(prompt("coauthor")).not.toMatch(/Runs commands/)
  })
})
