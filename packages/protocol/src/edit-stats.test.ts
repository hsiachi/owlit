import { describe, expect, it } from "vitest"
import { diffParts, editStats, HUNK_GAP, words } from "./edit-stats.ts"

describe("edit stats", () => {
  it("reads each CJK character and each run of letters or digits as a word", () => {
    expect(words("主动提醒 with Always-on 2 devices")).toEqual(["主", "动", "提", "醒", "with", "Always", "on", "2", "devices"])
  })

  it("counts prose in words, so a rewritten paragraph isn't one line", () => {
    // A paragraph touched up counts the words that changed in it, not every character it has
    expect(editStats("story.md", "主动提醒是一句简短的提示。\n\n下一段。", "主动提醒是一句简短而及时的提示。\n\n下一段。")).toEqual({ unit: "words", added: 3, removed: 0, rewritten: false })
    // Two touches in one paragraph count what they changed, not the words between them
    expect(editStats("story.md", "请佩戴者回看多天的生活。", "请佩戴者回看自己连续多天的生活，并逐条判断。")).toMatchObject({ added: 9, removed: 0 })
    // A paragraph said anew counts whole, though the two share characters here and there
    expect(editStats("story.md", "提醒的时机由设备判断。", "用户并不总是欢迎这样的打断。")).toEqual({ unit: "words", added: 13, removed: 10, rewritten: false })
  })

  it("counts a LaTeX paper as prose", () => {
    expect(editStats("paper/intro.tex", "We study reminders.", "We study proactive reminders on wearables.")).toEqual({ unit: "words", added: 3, removed: 0, rewritten: false })
  })

  it("counts other files in lines, and the gap between parts of an edit as nothing", () => {
    expect(editStats("a.ts", `a\nb\n${HUNK_GAP}\nc`, `a\nB\n${HUNK_GAP}\nc\nd`)).toEqual({ unit: "lines", added: 2, removed: 1, rewritten: false })
  })

  it("splits a diff of several parts back into them", () => {
    expect(diffParts(`a\n${HUNK_GAP}\nc`, `A\n${HUNK_GAP}\nC`)).toEqual([
      { oldText: "a", newText: "A" },
      { oldText: "c", newText: "C" },
    ])
    expect(diffParts("a", "A")).toEqual([{ oldText: "a", newText: "A" }])
    // Sides that don't split alike stay one diff
    expect(diffParts(`a\n${HUNK_GAP}\nc`, "A")).toEqual([{ oldText: `a\n${HUNK_GAP}\nc`, newText: "A" }])
  })

  it("calls a doc rewritten once more than half its words went", () => {
    const old = "一".repeat(30) + "二".repeat(30)
    expect(editStats("a.md", old, "一".repeat(30) + "三".repeat(40)).rewritten).toBe(false)
    expect(editStats("a.md", old, "一".repeat(20) + "三".repeat(40)).rewritten).toBe(true)
    // Too short to say so of
    expect(editStats("a.md", "a b c", "x y z").rewritten).toBe(false)
  })
})
