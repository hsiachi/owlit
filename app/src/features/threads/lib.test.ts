import { describe, expect, it } from "vitest"
import { summarize, type ThreadRead, type ThreadColumn, type ThreadRowRead } from "@owlit/protocol"
import { byProject, groupSections, isTable, noteSections, paperCounts, sectionsOf, shown } from "./lib"
import { seedThreads } from "./mocks/seed"

describe("a grouping's groups in the table", () => {
  const paper = (id: string): ThreadRowRead => ({ id, paper: { title: id, authors: [], ids: {} }, cells: {}, addedAt: 0 })
  const grouping: ThreadColumn = {
    id: "topic",
    question: "Topic",
    kind: "grouping",
    groups: [
      { id: "a", name: "A" },
      { id: "a1", name: "A1", parent: "a" },
      { id: "a2", name: "A2", parent: "a" },
      { id: "b", name: "B" },
      { id: "empty", name: "Empty" },
    ],
  }
  const rows = [
    { ...paper("p1"), in: { topic: ["a1", "a2"] } },
    { ...paper("p2"), in: { topic: ["a1", "b"] } },
    { ...paper("p3"), in: { topic: ["a"] } },
    paper("p4"),
  ]
  const { groups, loose } = groupSections({ rows } as ThreadRead, grouping)
  const count = (id: string) => groups.find((g) => g.group.id === id)?.total.map((r) => r.id)

  it("counts a group's papers once each, its subgroups' with them", () => {
    expect(count("a")).toEqual(["p3", "p1", "p2"])
    expect(count("a1")).toEqual(["p1", "p2"])
    expect(count("a2")).toEqual(["p1"])
  })

  it("counts a paper in two groups in both, leaves out a group with none, and puts the rest in none", () => {
    expect(count("b")).toEqual(["p2"])
    expect(groups.map((g) => [g.group.id, g.depth])).toEqual([["a", 0], ["a1", 1], ["a2", 1], ["b", 0]])
    expect(loose.map((r) => r.id)).toEqual(["p4"])
  })
})

describe("a table grouped by a comparison", () => {
  const paper = (id: string, cell?: ThreadRowRead["cells"][string]): ThreadRowRead => ({ id, paper: { title: id, authors: [], ids: {} }, cells: cell ? { cmp: cell } : {}, addedAt: 0 })
  const column: ThreadColumn = { id: "cmp", question: "Against my draft", kind: "compare", sentences: [{ id: "s1", text: "Readers skim." }] }
  const thread = { columns: [column], rows: [paper("p1", { rel: "supports", sentence: "s1" }), paper("p2", { rel: "challenges", sentence: "gone" }), paper("p3")] } as unknown as ThreadRead

  it("puts a paper whose sentence the column no longer has with those that bear on none", () => {
    expect(sectionsOf(thread, "column:cmp").map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ["s1", ["p1"]],
      ["", ["p2", "p3"]],
    ])
  })
})

describe("a thread's page, on the preview's seed", () => {
  const seed = seedThreads()
  const reading = shown(seed["reading-support-tools"]!)

  it("reads as a note with its groups as headings, two levels, until a column is asked", () => {
    expect(isTable(reading)).toBe(false)
    expect(isTable(shown(seed["uist-2026-papers"]!))).toBe(true)
    expect(noteSections(reading).map((s) => [s.group?.name, s.depth, s.total])).toEqual([
      ["Inside the paper", 0, 4],
      ["Citations", 1, 1],
      ["Skimming and summaries", 1, 3],
      ["Across papers", 0, 3],
      ["Overviews", 0, 1],
    ])
    expect(paperCounts(reading)).toEqual({ papers: 8, groups: 3, full: 3 })
  })

  it("has a report in sections whose paper links are its rows, and what each paper is", () => {
    const thread = seed["reading-support-tools"]!
    expect(thread.report).toMatch(/^## /m)
    const linked = [...thread.report.matchAll(/\(owlit:\/\/library\/([^)]+)\)/g)].map((m) => m[1])
    expect(linked.every((id) => thread.rows.some((r) => r.id === id))).toBe(true)
    expect(thread.rows.filter((r) => r.is).length).toBeGreaterThan(0)
  })

  it("without a grouping, is one section of every paper", () => {
    const tools = shown(seed["llm-tool-use"]!)
    expect(noteSections(tools)).toEqual([{ key: "", rows: tools.rows, total: tools.rows.length, depth: 0 }])
    expect(noteSections({ ...reading, view: { groupBy: "none" } }).length).toBe(1)
  })
})

describe("the list of threads", () => {
  const summaries = Object.values(seedThreads()).map((c) => summarize(c))

  it("carries Owlit's one line for each thread", () => {
    expect(summaries.every((c) => c.one)).toBe(true)
  })

  it("puts a thread whose project folder is gone with those in none, naming the folder it was in", () => {
    const groups = byProject(summaries, ["writing"])
    expect(groups.map((g) => g.key)).toEqual(["writing", ""])
    const gone = groups[1]!.threads.find((c) => c.id === "replay-vs-live-ratings")
    expect(gone?.was).toBe("Reading tools study")
    expect(groups[1]!.threads.find((c) => c.id === "llm-tool-use")?.was).toBeUndefined()
    // Until the folders are known, every project counts
    expect(byProject(summaries).map((g) => g.key)).toEqual(["writing", "Reading tools study", ""])
  })
})
