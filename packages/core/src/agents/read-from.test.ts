import { describe, expect, it } from "vitest"
import { ReadLog, readFromOf } from "./read-from.ts"

describe("what an answer was built from", () => {
  it("counts each paper once, by how far the turn read it, and cited papers by whether owlit has their text", async () => {
    const log = new ReadLog()
    log.record({ asker: "chat:c1", paperId: "old-id", part: "text", pages: "3-5", at: 100 })
    log.record({ asker: "chat:c1", paperId: "b", part: "digest", at: 101 })
    log.record({ asker: "chat:c1", paperId: "e", part: "note", at: 102 })
    log.record({ asker: "chat:c2", paperId: "x", part: "text", at: 103 })
    log.record({ asker: "chat:c1", paperId: "earlier", part: "text", at: 10 })
    const answer = "[A 2020](owlit://library/a#p4 \"words\") and [C](owlit://library/c), [D](owlit://library/d), [B](owlit://library/b)."
    const canonical = async (id: string) => (id === "old-id" ? "a" : id)
    const hasText = async (id: string) => id !== "d"
    expect(await readFromOf(log.since("chat:c1", 50), answer, canonical, hasText)).toEqual([
      { paperId: "a", depth: "full" },
      { paperId: "b", depth: "digest" },
      { paperId: "c", depth: "abstract" },
      { paperId: "d", depth: "none" },
    ])
  })
})
