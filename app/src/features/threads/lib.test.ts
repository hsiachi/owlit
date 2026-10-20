import { describe, expect, it } from "vitest"
import type { ThreadRead, ThreadColumn, ThreadRowRead } from "@owlit/protocol"
import { groupSections, memoOf, memoParts, sentencesOf, shortTitle } from "./lib"

describe("a paper's short title", () => {
  it("is the name before a colon or dash", () => {
    expect(shortTitle("CiteSee: Augmenting Citations in Scientific Papers")).toBe("CiteSee")
    expect(shortTitle("Why Faster Isn't Better: Reading Speed in Scholarly Tools")).toBe("Why Faster Isn't Better")
    expect(shortTitle("Threadline — Following an Argument Across Papers")).toBe("Threadline")
  })

  it("is the whole title when there is no such name", () => {
    expect(shortTitle("Language Models are Few-Shot Learners")).toBe("Language Models are Few-Shot Learners")
    expect(shortTitle("A very long first clause that runs on well past any sensible name: and more")).toBe("A very long first clause that runs on well past any sensible name: and more")
  })
})

describe("memo sentences", () => {
  const text = "Two systems: [Synergi](owlit://library/p10) builds threads, [Relatedly](owlit://library/p11) maps a topic."

  it("splits a sentence into words and the papers it names", () => {
    expect(memoParts(text)).toEqual(["Two systems: ", { label: "Synergi", uri: "owlit://library/p10" }, " builds threads, ", { label: "Relatedly", uri: "owlit://library/p11" }, " maps a topic."])
  })

  it("are the report's first paragraph, after any heading", () => {
    const c = { report: `## Two lines\n\n${text} [Kelly et al. 2015](owlit://library/p12) differs. 第二句。第三句！\n\n## More\n\nLater.` } as ThreadRead
    expect(memoOf(c).map((s) => s.text)).toEqual([text, "[Kelly et al. 2015](owlit://library/p12) differs.", "第二句。", "第三句！"])
    expect(memoOf({ report: "" } as ThreadRead)).toEqual([])
  })
})

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

describe("a doc's sentences for Compare", () => {
  it("doesn't split at et al., an initial or a link's label", () => {
    const doc = "Retrieval reduces hallucination in long answers, as [Lewis et al. 2020](owlit://paper/a) showed. But Shi et al. found the opposite in J. Smith's data!"
    expect(sentencesOf(doc)).toEqual([
      "Retrieval reduces hallucination in long answers, as Lewis et al. 2020 showed.",
      "But Shi et al. found the opposite in J. Smith's data!",
    ])
  })

  it("splits Chinese at its full stops and keeps short Chinese sentences", () => {
    expect(sentencesOf("检索能减少幻觉。但长答案仍会出错！好的")).toEqual(["检索能减少幻觉。", "但长答案仍会出错！"])
  })

  it("takes off headings and list marks and leaves out very short pieces", () => {
    expect(sentencesOf("# Related work\n- Short one.\n- A list item that says enough.")).toEqual(["Related work", "A list item that says enough."])
  })
})
