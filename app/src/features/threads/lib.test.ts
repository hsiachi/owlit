import { describe, expect, it } from "vitest"
import { summarize, type ThreadRead, type ThreadColumn, type ThreadRowRead } from "@owlit/protocol"
import { exampleThreads } from "@/test/example-workspace"
import { byProject, groupSections, isTable, noteSections, paperCounts, sectionsOf, shown } from "./lib"

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
  const cell = { text: "", depth: "abstract" as const, at: 0 }
  const column: ThreadColumn = { id: "cmp", question: "Against my draft", kind: "compare", sentences: [{ id: "s1", text: "Readers skim." }] }
  const thread = { columns: [column], rows: [paper("p1", { ...cell, rel: "supports", sentence: "s1" }), paper("p2", { ...cell, rel: "challenges", sentence: "gone" }), paper("p3")] } as unknown as ThreadRead

  it("puts a paper whose sentence the column no longer has with those that bear on none", () => {
    expect(sectionsOf(thread, "column:cmp").map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ["s1", ["p1"]],
      ["", ["p2", "p3"]],
    ])
  })
})

describe("a thread's page, on the example workspace", () => {
  const example = exampleThreads()
  const testData = shown(example["test-data-behind-the-papers"]!)
  const question = shown(example["context-versus-own-knowledge"]!)

  it("reads as a note until a column is asked, then as a table", () => {
    expect(isTable(question)).toBe(false)
    expect(isTable(testData)).toBe(true)
  })

  it("sections the papers by the grouping, two levels, a paper in two groups counted in both", () => {
    expect(noteSections(testData).map((s) => [s.group?.name, s.depth, s.total])).toEqual([
      ["Shared benchmarks", 0, 4],
      ["RAGTruth", 1, 2],
      ["Open QA sets", 1, 2],
      ["Data the paper made for itself", 0, 5],
    ])
    expect(paperCounts(testData)).toEqual({ papers: 8, groups: 2, depths: expect.arrayContaining(["full"]) })
  })

  it("has a report in sections whose paper links are its rows, and what each paper is", () => {
    const thread = example["test-data-behind-the-papers"]!
    expect(thread.report).toMatch(/^## /m)
    const linked = [...thread.report.matchAll(/\(owlit:\/\/library\/([^)]+)\)/g)].map((m) => m[1])
    expect(linked.every((id) => thread.rows.some((r) => r.id === id))).toBe(true)
    expect(thread.rows.every((r) => r.is)).toBe(true)
  })

  it("without a grouping, is one section of every paper", () => {
    expect(noteSections(question)).toEqual([{ key: "", rows: question.rows, total: question.rows.length, depth: 0 }])
    expect(noteSections({ ...testData, view: { groupBy: "none" } }).length).toBe(1)
  })
})

describe("the list of threads", () => {
  const summaries = Object.values(exampleThreads()).map((c) => summarize(c))

  it("carries Owlit's one line for each thread", () => {
    expect(summaries.every((c) => c.one)).toBe(true)
  })

  it("groups by a marked folder's path, labelled with the project's name", () => {
    const groups = byProject(summaries, [{ path: "Hallucination in RAG", name: "RAG survey" }])
    expect(groups.map((g) => [g.key, g.label])).toEqual([["Hallucination in RAG", "RAG survey"]])
  })

  it("orders the projects by their most recently changed thread, those in none last", () => {
    const at = (id: string, project: string, updatedAt: number) => ({ ...summaries[0]!, id, project, updatedAt })
    const list = [at("a", "Thesis/Ch2", 3), at("b", "", 2), at("c", "Grant", 1), at("d", "Thesis/Ch2", 0)]
    const projects = [
      { path: "Grant", name: "Grant" },
      { path: "Thesis/Ch2", name: "Chapter 2" },
    ]
    expect(byProject(list, projects).map((g) => [g.label, g.threads.map((c) => c.id)])).toEqual([
      ["Chapter 2", ["a", "d"]],
      ["Grant", ["c"]],
      ["Not in a project", ["b"]],
    ])
  })

  it("puts a thread whose project is no marked folder any more with those in none, naming the path it was in", () => {
    const gone = byProject(summaries, [{ path: "writing", name: "writing" }])
    expect(gone.map((g) => g.key)).toEqual([""])
    expect(gone[0]!.threads.every((c) => c.was === "Hallucination in RAG")).toBe(true)
    expect(byProject(summaries, []).map((g) => g.key)).toEqual([""])
    // Until the projects are known, every project counts, labelled by its path
    expect(byProject(summaries).map((g) => [g.key, g.label])).toEqual([["Hallucination in RAG", "Hallucination in RAG"]])
  })
})
