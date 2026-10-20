import { describe, expect, it } from "vitest"
import type { ThreadRead } from "@owlit/protocol"
import { threadCsv, threadMarkdown } from "./export"
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

  // The table thread with a second way of grouping its papers, by study kind
  const twoWays = (): ThreadRead => {
    const c = all.find((c) => c.id === "uist-2026-papers")!
    return {
      ...c,
      columns: [...c.columns, { id: "kind", question: "Study kind", kind: "grouping", groups: [{ id: "lab", name: "Lab studies" }, { id: "field", name: "Studies in the field" }] }],
      rows: c.rows.map((r, i) => ({ ...r, in: { ...r.in, kind: [i % 2 ? "field" : "lab"] } })),
    }
  }

  it("groups by the grouping the table shows, not the first one", () => {
    const c = twoWays()
    const md = threadMarkdown({ ...c, view: { groupBy: "grouping:kind" } })
    expect(md).toMatch(/^## Lab studies$/m)
    expect(md).toMatch(/^## Studies in the field$/m)
    expect(md).not.toMatch(/^## Reading and writing aids$/m)
    expect(md.split("\n").filter((l) => l.startsWith("| ["))).toHaveLength(c.rows.length)
    // With no view, the first grouping, a subgroup a level under its parent
    const first = threadMarkdown(c)
    expect(first).toMatch(/^## Reading and writing aids$/m)
    expect(first).toMatch(/^### Inside one paper$/m)
    expect(first).not.toMatch(/^## Lab studies$/m)
  })

  it("has no group headings when the table is grouped by nothing", () => {
    const c = { ...twoWays(), view: { groupBy: "none" } }
    const md = threadMarkdown(c)
    expect(md).not.toMatch(/^##/m)
    expect(md.split("\n").filter((l) => l.startsWith("| ["))).toHaveLength(c.rows.length)
  })

  it("says what each paper is, in the doc and the CSV", () => {
    const c = all.find((c) => c.id === "uist-2026-papers")!
    const row = c.rows.find((r) => r.is)!
    expect(threadMarkdown(c)).toMatch(new RegExp(`\\(owlit://library/${row.id}\\) \\([^)]*\\) \\| ${row.is} \\|`))
    const [head, first] = threadCsv(c).split("\n")
    expect(head).toContain("What it is")
    expect(head).toContain(",Answer,Depth,")
    expect(first).toContain(c.rows[0]!.is!)
  })
})

describe("a thread exported as a CSV", () => {
  it("starts with a byte-order mark, so a spreadsheet reads it as UTF-8", () => {
    const c = Object.values(seedThreads())[0]!
    const csv = threadCsv(c)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).startsWith("Paper,")).toBe(true)
  })
})
