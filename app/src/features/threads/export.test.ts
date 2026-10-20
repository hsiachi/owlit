import { describe, expect, it } from "vitest"
import { threadMarkdown } from "./export"
import { seedThreads } from "./mocks/seed"

describe("a thread exported as a doc", () => {
  const all = Object.values(seedThreads())

  it("starts with the title and the report, papers and the thread kept as links", () => {
    const c = all.find((c) => c.report)!
    const md = threadMarkdown(c, new Date(2026, 9, 14))
    expect(md.startsWith(`# ${c.title}\n\n${c.report}`)).toBe(true)
    expect(md).toContain(`(owlit://library/${c.rows[0]!.id})`)
    expect(md.trim().split("\n").at(-1)).toMatch(new RegExp(`\\(owlit://threads/${c.id}\\)`))
  })

  it("has one table row per paper, under its group's heading, every line with the same cells", () => {
    const c = all.find((c) => c.columns.some((col) => col.groups?.length))!
    const md = threadMarkdown(c)
    const groups = c.columns.find((col) => col.kind === "grouping")!.groups!
    for (const g of groups.filter((g) => c.rows.some((r) => r.in?.topic?.includes(g.id)))) expect(md).toMatch(new RegExp(`^#{2,} ${g.name}$`, "m"))
    const lines = md.split("\n").filter((l) => l.startsWith("| ["))
    expect(lines).toHaveLength(c.rows.length)
    const cells = (l: string) => l.replace(/\\\|/g, "").split("|").length
    expect(new Set(md.split("\n").filter((l) => l.startsWith("|")).map(cells)).size).toBe(1)
  })

  it("cites an answer read in full with its page and the sentence it rests on", () => {
    const c = all.find((c) => c.rows.some((r) => r.cells.q?.passage))!
    const row = c.rows.find((r) => r.cells.q?.passage)!
    const { quote, page } = row.cells.q!.passage!
    expect(threadMarkdown(c)).toContain(`(owlit://library/${row.id}#p${page} "${quote}")`)
  })
})
