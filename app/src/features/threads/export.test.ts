import { describe, expect, it } from "vitest"
import type { ThreadRead } from "@owlit/protocol"
import { exampleThreads } from "@/test/example-workspace"
import { exportPath, threadCsv, threadMarkdown } from "./export"

describe("a thread exported as a doc", () => {
  const all = Object.values(exampleThreads())

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
    const grouping = c.columns.find((col) => col.kind === "grouping")!
    for (const g of grouping.groups!.filter((g) => c.rows.some((r) => r.in?.[grouping.id]?.includes(g.id)))) expect(md).toMatch(new RegExp(`^#{2,} ${g.name}$`, "m"))
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

  // The table thread with a second way of grouping its papers, by where they appeared
  const twoWays = (): ThreadRead => {
    const c = all.find((c) => c.id === "test-data-behind-the-papers")!
    return {
      ...c,
      columns: [...c.columns, { id: "where", question: "Where it appeared", kind: "grouping", groups: [{ id: "arxiv", name: "arXiv only" }, { id: "venue", name: "At a venue" }] }],
      rows: c.rows.map((r, i) => ({ ...r, in: { ...r.in, where: [i % 2 ? "venue" : "arxiv"] } })),
    }
  }

  // The doc after Owlit's report, which has headings of its own
  const tables = (c: ThreadRead, md: string) => md.slice(md.indexOf(c.report) + c.report.length)

  it("groups by the grouping the table shows, not the first one", () => {
    const c = twoWays()
    const md = tables(c, threadMarkdown({ ...c, view: { groupBy: "grouping:where" } }))
    expect(md).toMatch(/^## arXiv only$/m)
    expect(md).toMatch(/^## At a venue$/m)
    expect(md).not.toMatch(/^## Shared benchmarks$/m)
    expect(md.split("\n").filter((l) => l.startsWith("| ["))).toHaveLength(c.rows.length)
    // With no view, the first grouping, a subgroup a level under its parent
    const first = tables(c, threadMarkdown(c))
    expect(first).toMatch(/^## Shared benchmarks$/m)
    expect(first).toMatch(/^### RAGTruth$/m)
    expect(first).not.toMatch(/^## arXiv only$/m)
  })

  it("has no group headings when the table is grouped by nothing", () => {
    const c = { ...twoWays(), view: { groupBy: "none" } }
    const md = tables(c, threadMarkdown(c))
    expect(md).not.toMatch(/^##/m)
    expect(md.split("\n").filter((l) => l.startsWith("| ["))).toHaveLength(c.rows.length)
  })

  it("says what each paper is, in the doc and the CSV", () => {
    const c = all.find((c) => c.id === "test-data-behind-the-papers")!
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
    const c = Object.values(exampleThreads())[0]!
    const csv = threadCsv(c)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).startsWith("Paper,")).toBe(true)
  })
})

describe("where a thread's doc goes", () => {
  const project = { path: "Thesis/Ch2", mark: "Thesis/Ch2/project.md", name: "Chapter 2", parents: [] }
  const none = () => false

  it("lands in the thread's project folder while it is marked", () => {
    expect(exportPath({ project: "Thesis/Ch2", title: "Replay annotation" }, [project], none)).toBe("Thesis/Ch2/Replay annotation.md")
    expect(exportPath({ project: "Thesis/Ch2", title: "Replay annotation" }, [project], (p) => p === "Thesis/Ch2/Replay annotation.md")).toBe("Thesis/Ch2/Replay annotation 2.md")
  })

  it("lands at the root for a thread in no project, or one whose folder is no project any more", () => {
    expect(exportPath({ project: "", title: "Replay annotation" }, [project], none)).toBe("Replay annotation.md")
    expect(exportPath({ project: "Old", title: "Replay annotation" }, [project], none)).toBe("Replay annotation.md")
  })
})
