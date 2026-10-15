import { describe, expect, it } from "vitest"
import { memoParts, plainMemo, relinkMemo, shortTitle } from "./lib"

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

  it("edits as plain words and keeps the links on the names a rewrite keeps", () => {
    const { plain, links } = plainMemo(text)
    expect(plain).toBe("Two systems: Synergi builds threads, Relatedly maps a topic.")
    expect(relinkMemo("Synergi and Relatedly work across papers.", links)).toBe("[Synergi](owlit://library/p10) and [Relatedly](owlit://library/p11) work across papers.")
    expect(relinkMemo("Only Relatedly is left.", links)).toBe("Only [Relatedly](owlit://library/p11) is left.")
  })
})
