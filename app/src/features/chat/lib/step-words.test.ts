import { describe, expect, it, vi } from "vitest"
import type { ToolCall } from "../types"

// tool-title reads the Library's store for paper labels; nothing here names a paper
vi.mock("@/features/library/store", () => ({ useLibraryStore: { getState: () => ({ papers: {} }) } }))
vi.mock("@/features/library/lib/format", () => ({ citationLabel: () => "" }))

const { askSentence, blockSentence, stepWords, unansweredSentence, agentDone } = await import("./step-words")

const call = (partial: Partial<ToolCall>): ToolCall => ({ toolCallId: Math.random().toString(36), title: "", status: "completed", ...partial }) as ToolCall
const block = (...calls: ToolCall[]) => blockSentence(calls.map((c) => ({ call: c, words: stepWords(c) })))

describe("step words", () => {
  it("says what a step does while it runs and once done", () => {
    expect(stepWords(call({ tool: { name: "Edit", path: "/a/story.md" } }))).toMatchObject({ now: "Edit story.md", done: "Edited story.md", file: "story.md" })
    expect(stepWords(call({ tool: { name: "WebSearch", query: "owls" } }))).toMatchObject({ now: "Search the web for “owls”", done: "Searched the web for “owls”" })
    expect(stepWords(call({ tool: { name: "mcp__owlit__library_list" } }))).toMatchObject({ now: "List your Library", done: "Listed your Library" })
    expect(stepWords(call({ tool: { name: "Bash", description: "Run the tests" } }))).toMatchObject({ now: "Run the tests", done: "Ran the tests" })
  })

  it("folds a block into one sentence", () => {
    const web = call({ tool: { name: "WebSearch", query: "x" } })
    const page = (url: string) => call({ tool: { name: "WebFetch", url } })
    expect(block(call({ tool: { name: "mcp__owlit__library_list" } }), web, { ...web, toolCallId: "w2" }, page("https://a.org/1"), page("https://a.org/2"), page("https://a.org/3"))).toBe(
      "Listed your Library, searched the web twice and opened 3 pages",
    )
    expect(block(call({ tool: { name: "Read", path: "story.md" } }), call({ tool: { name: "Edit", path: "story.md" } }))).toBe("Read and edited story.md")
    expect(block(call({ tool: { name: "Read", path: "a.md" } }), call({ tool: { name: "Read", path: "b.md" } }))).toBe("Read 2 files")
  })

  it("puts what Owlit asks in its words", () => {
    expect(askSentence("Edit", call({ tool: { name: "Edit", path: "研究故事.md" }, status: "pending" }))).toBe("Owlit wants to edit 研究故事.md")
    expect(askSentence("x", call({ tool: { name: "Bash", command: "ls" }, status: "pending" }))).toBe("Owlit wants to run a command")
    const parts = [
      { ...call({ toolCallId: "e", tool: { name: "Edit", path: "a.md" }, status: "pending" }), type: "tool_call" },
      { type: "permission", toolCallId: "e", title: "Edit a.md" },
    ] as never
    expect(unansweredSentence(parts)).toBe("It was asking to edit a.md when it stopped, so that wasn't done.")
  })

  it("counts what a helper agent did", () => {
    expect(agentDone([call({ kind: "edit", tool: { name: "Edit", path: "a.md" } }), call({ kind: "edit", tool: { name: "Edit", path: "b.md" } })])).toBe("Edited 2 files")
    expect(agentDone([call({ tool: { name: "Read", path: "a.md" } })])).toBe("1 step")
  })
})
