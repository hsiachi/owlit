import { describe, expect, it } from "vitest"
import { relabelReport, reportLabel, shortTitle } from "./threads.ts"
import { upgradeThread, type ThreadV2 } from "./thread-upgrade.ts"

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

describe("how a report's link names a paper", () => {
  const ELLIS = { title: "Prospective memory or the realization of delayed intentions: A conceptual framework", authors: ["Judi A. Ellis"], year: 1996 }
  const CITESEE = { title: "CiteSee: Augmenting Citations in Scientific Papers", authors: ["Joseph Chee Chang", "Amy X. Zhang"], year: 2023 }
  const KLIEGEL = { title: "Plan formation, retention, and execution in prospective memory: A new approach", authors: ["Matthias Kliegel", "Mark A. McDaniel", "Gilles O. Einstein"], year: 2000 }

  it("is the short title when it fits the token, else the authors and year", () => {
    expect(reportLabel(CITESEE)).toBe("CiteSee")
    expect(reportLabel(ELLIS)).toBe("Ellis 1996")
    expect(reportLabel(KLIEGEL)).toBe("Kliegel et al. 2000")
    expect(reportLabel({ ...KLIEGEL, authors: ["Matthias Kliegel", "Mike Martin"] })).toBe("Kliegel & Martin 2000")
    expect(reportLabel({ ...ELLIS, authors: [], year: undefined })).toBe(ELLIS.title)
  })

  it("renames links named by more of the title than the token shows, leaves the others, and changes nothing the second time", () => {
    const papers: Record<string, typeof ELLIS> = { e: ELLIS, c: CITESEE, k: KLIEGEL }
    const report = "[Prospective memory or the realization of delayed intentions](owlit://library/e) frames it; [CiteSee: Augmenting Citations in Scientific Papers](owlit://library/c#p3) shows it; [Kliegel 2000](owlit://library/k) and [Plan formation, retention, and execution in prospective memo](owlit://library/k) agree; [Prospective memory](owlit://library/e) fits; [a paper](owlit://library/x)."
    const once = relabelReport(report, (id) => papers[id])
    expect(once).toBe("[Ellis 1996](owlit://library/e) frames it; [CiteSee](owlit://library/c#p3) shows it; [Kliegel 2000](owlit://library/k) and [Kliegel et al. 2000](owlit://library/k) agree; [Prospective memory](owlit://library/e) fits; [a paper](owlit://library/x).")
    expect(relabelReport(once, (id) => papers[id])).toBe(once)
  })

  it("is how an upgraded thread's report names the papers its memo named by title", () => {
    const v2: ThreadV2 = {
      version: 2,
      id: "t",
      title: "Prospective memory",
      asked: { text: "What is prospective memory?", at: 1 },
      project: "",
      sources: [],
      memo: [{ id: "m1", text: "[Prospective memory or the realization of delayed intentions](owlit://library/e) names the phases." }],
      columns: [],
      rows: [{ id: "e", paper: { ...ELLIS, ids: {} }, cells: {}, addedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
      overrides: { edits: {}, removed: {}, placed: {}, merged: {} },
    }
    const thread = upgradeThread(v2)
    expect(thread.report).toBe("[Ellis 1996](owlit://library/e) names the phases.")
    expect(thread.one).toBe("Ellis 1996 names the phases.")
  })
})
