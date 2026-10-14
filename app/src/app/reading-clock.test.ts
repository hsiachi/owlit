import { describe, expect, it } from "vitest"
import { ReadingClock, type ReadingEvent } from "./reading-clock"

function clock(view: "pdf" | "digest" | null = "pdf", page = 1) {
  const events: ReadingEvent[] = []
  const c = new ReadingClock("arxiv-1", view, page, (e) => events.push(e))
  const read = (seconds: number) => {
    for (let i = 0; i < seconds; i++) c.tick(1000)
  }
  return { c, events, read }
}

describe("ReadingClock", () => {
  it("sends reading time every 30 seconds, and the rest when settled, whatever the page turns", () => {
    const { c, events, read } = clock()
    read(20)
    c.setPage(2)
    read(50)
    c.settle()
    const focus = events.filter((e) => e.kind === "paper.focus")
    expect(focus.map((e) => e.seconds)).toEqual([30, 30, 10])
    expect(focus.every((e) => e.view === "pdf")).toBe(true)
  })

  it("counts a page only once it stayed at the top 5 seconds, and the whole stay after that", () => {
    const { c, events, read } = clock("pdf", 3)
    read(4)
    c.setPage(4)
    read(12)
    c.setPage(5)
    c.settle()
    expect(events.filter((e) => e.kind === "paper.dwell")).toEqual([{ kind: "paper.dwell", paperId: "arxiv-1", page: 4, seconds: 12 }])
  })

  it("sends a long stay on one page in parts that add up", () => {
    const { c, events, read } = clock("pdf", 2)
    read(75)
    c.settle()
    const dwell = events.filter((e) => e.kind === "paper.dwell")
    expect(dwell.every((e) => e.page === 2)).toBe(true)
    expect(dwell.reduce((sum, e) => sum + e.seconds, 0)).toBe(75)
  })

  it("keeps a short stay going across a settle, so leaving the window for a moment doesn't lose it", () => {
    const { c, events, read } = clock()
    read(3)
    c.settle()
    read(3)
    c.settle()
    expect(events.filter((e) => e.kind === "paper.dwell")).toEqual([{ kind: "paper.dwell", paperId: "arxiv-1", page: 1, seconds: 6 }])
  })

  it("counts the digest as digest time with no pages, and nothing while there is nothing to read", () => {
    const { c, events, read } = clock(null)
    read(40)
    c.setView("digest")
    read(20)
    c.setView("pdf")
    read(8)
    c.settle()
    expect(events).toEqual([
      { kind: "paper.focus", paperId: "arxiv-1", view: "digest", seconds: 20 },
      { kind: "paper.focus", paperId: "arxiv-1", view: "pdf", seconds: 8 },
      { kind: "paper.dwell", paperId: "arxiv-1", page: 1, seconds: 8 },
    ])
  })

  it("sends nothing for a paper only glanced at", () => {
    const { c, events } = clock()
    c.tick(400)
    c.settle()
    expect(events).toEqual([])
  })
})
