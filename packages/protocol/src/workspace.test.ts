import { describe, expect, it } from "vitest"
import { isHiddenFromDocs } from "./workspace.ts"

describe("isHiddenFromDocs", () => {
  it.each([
    ["library", true],
    ["library/papers/arxiv-1/paper.json", true],
    // A workspace from before collections keeps its old topics as ordinary docs
    ["knowledge/agents.md", false],
    [".owlit/workspace.json", true],
    ["notes/.obsidian/app.json", true],
    [".DS_Store", true],
    ["notes/library/reading.md", false],
    ["knowledge.md", false],
    ["writing/Related work.md", false],
    ["研究 笔记/第 2 章.md", false],
  ])("%s → %s", (p, hidden) => {
    expect(isHiddenFromDocs(p)).toBe(hidden)
  })
})
