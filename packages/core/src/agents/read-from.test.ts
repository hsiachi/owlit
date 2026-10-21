import { describe, expect, it } from "vitest"
import { ReadLog, readFromOf, textDepthOf } from "./read-from.ts"

describe("what an answer was built from", () => {
  it("counts each paper once, by how far the turn read it, and cited papers by whether their record has an abstract", async () => {
    const log = new ReadLog()
    log.record({ asker: "chat:c1", paperId: "old-id", part: "text", pages: "3-5", at: 100 })
    log.record({ asker: "chat:c1", paperId: "b", part: "digest", at: 101 })
    log.record({ asker: "chat:c1", paperId: "e", part: "note", at: 102 })
    log.record({ asker: "chat:c2", paperId: "x", part: "text", at: 103 })
    log.record({ asker: "chat:c1", paperId: "earlier", part: "text", at: 10 })
    const answer = "[A 2020](owlit://library/a#p4 \"words\") and [C](owlit://library/c), [D](owlit://library/d), [B](owlit://library/b)."
    const canonical = async (id: string) => (id === "old-id" ? "a" : id)
    const hasAbstract = async (id: string) => id !== "d"
    expect(await readFromOf(log.since("chat:c1", 50), answer, canonical, hasAbstract)).toEqual([
      { paperId: "a", depth: "part", pages: "3–5" },
      { paperId: "b", depth: "digest" },
      { paperId: "c", depth: "abstract" },
      { paperId: "d", depth: "title" },
    ])
  })

  it("says a paper was read in full only when its whole text was, and which pages otherwise", async () => {
    const log = new ReadLog()
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "4", at: 1 })
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "5,9-10", at: 2 })
    log.record({ asker: "chat:c1", paperId: "b", part: "text", pages: "2", at: 3 })
    log.record({ asker: "chat:c1", paperId: "b", part: "text", at: 4 })
    log.record({ asker: "chat:c1", paperId: "c", part: "text", section: "Method", at: 5 })
    const same = async (id: string) => id
    expect(await readFromOf(log.since("chat:c1", 0), "", same, async () => true)).toEqual([
      { paperId: "a", depth: "part", pages: "4–5, 9–10" },
      { paperId: "b", depth: "full" },
      { paperId: "c", depth: "part" },
    ])
  })

  it("counts page runs that together name every page as the whole text, and fewer as those pages", async () => {
    const log = new ReadLog()
    // A long paper comes in runs, each read knowing how many pages it has
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "1-12", of: 30, at: 1 })
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "13-24", of: 30, at: 2 })
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "25-30", of: 30, at: 3 })
    log.record({ asker: "chat:c1", paperId: "b", part: "text", pages: "1-12", of: 30, at: 4 })
    // Pages that happen to be all of them, read without knowing the count, are only those pages
    log.record({ asker: "chat:c1", paperId: "c", part: "text", pages: "1-2", at: 5 })
    const same = async (id: string) => id
    expect(await readFromOf(log.since("chat:c1", 0), "", same, async () => true)).toEqual([
      { paperId: "a", depth: "full" },
      { paperId: "b", depth: "part", pages: "1–12" },
      { paperId: "c", depth: "part", pages: "1–2" },
    ])
    expect(textDepthOf(log.since("chat:c1", 0).filter((r) => r.paperId === "a"))).toBe("full")
    expect(textDepthOf(log.since("chat:c1", 0).filter((r) => r.paperId === "b"))).toBe("part")
  })

  it("tells a thread's cell whether the chat read the paper's whole text or part of it", () => {
    const log = new ReadLog()
    log.record({ asker: "chat:c1", paperId: "a", part: "text", pages: "4", at: 1 })
    log.record({ asker: "chat:c1", paperId: "b", part: "text", at: 2 })
    log.record({ asker: "chat:c1", paperId: "c", part: "digest", at: 3 })
    const of = (id: string) => textDepthOf(log.since("chat:c1", 0).filter((r) => r.paperId === id))
    expect(of("a")).toBe("part")
    expect(of("b")).toBe("full")
    expect(of("c")).toBeUndefined()
    expect(of("d")).toBeUndefined()
  })
})
