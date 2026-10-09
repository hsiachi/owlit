import { describe, expect, it } from "vitest"
import { cleanName, followFirstLine, nameFromFirstLine, timeName, uniquePath } from "./naming.ts"

describe("nameFromFirstLine", () => {
  it.each([
    ["# Related work\n\nbody", "Related work"],
    ["---\ntags: log\n---\n## Week 3: notes\n", "Week 3 notes"],
    ["- [ ] call *Ana* about [the draft](owlit://docs/a.md)", "call Ana about the draft"],
    ["> quoted.", "quoted"],
    ["", ""],
    ["\nsecond line", ""],
  ])("%j → %j", (content, name) => {
    expect(nameFromFirstLine(content)).toBe(name)
  })

  it("cuts a long line at a word", () => {
    const name = nameFromFirstLine("word ".repeat(40))
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name.endsWith("word")).toBe(true)
  })
})

describe("uniquePath", () => {
  it("numbers a taken name", () => {
    const taken = new Set(["notes/A.md", "notes/A 2.md"])
    expect(uniquePath("notes", "A", ".md", (p) => taken.has(p))).toBe("notes/A 3.md")
    expect(uniquePath("", "B", ".md", (p) => taken.has(p))).toBe("B.md")
  })
})

describe("followFirstLine", () => {
  const none = () => false
  it("renames to the first line", () => {
    expect(followFirstLine("a/2026-10-09 10.00.md", "# Plan\n", 0, none)).toBe("a/Plan.md")
  })
  it("stays when the name already matches", () => {
    expect(followFirstLine("a/Plan.md", "# Plan\nmore", 0, none)).toBeNull()
  })
  it("keeps a number it got because the name was taken", () => {
    const taken = (p: string) => p === "a/Plan.md"
    expect(followFirstLine("a/Plan 2.md", "# Plan", 0, taken)).toBeNull()
    expect(followFirstLine("a/Draft.md", "# Plan", 0, taken)).toBe("a/Plan 2.md")
  })
  it("falls back to the creation time", () => {
    const t = new Date(2026, 9, 9, 8, 5).getTime()
    expect(timeName(t)).toBe("2026-10-09 08.05")
    expect(followFirstLine("Plan.md", "", t, none)).toBe("2026-10-09 08.05.md")
  })
  it("cleans typed names", () => {
    expect(cleanName(" a/b: c. ")).toBe("a b c")
  })
})
