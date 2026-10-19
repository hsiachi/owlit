import type { Change, ChatMessage } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { partsUndone, replyEntries, undoneBy } from "./reply-changes"

const reply = (id: string, createdAt: number, finishedAt?: number): ChatMessage => ({ id, role: "assistant", parts: [], createdAt, ...(finishedAt ? { finishedAt } : {}) })
const question = (id: string, createdAt: number): ChatMessage => ({ id, role: "user", parts: [], createdAt })
const entry = (id: string, at: number, extra: Partial<Change> = {}): Change => ({ id, at, actor: "o_1234abcd", action: "update", target: { kind: "doc", path: "a.md" }, origin: { via: "tool", chatId: "c1" }, ...extra })

describe("replyEntries", () => {
  const messages = [question("q1", 0), reply("r1", 10, 20), question("q2", 30), reply("r2", 40, 50)]

  it("gives a reply Owlit's entries from its start until the next reply's, oldest first", () => {
    // 25: seen on disk just after r1 ended; 45: r2's own
    const all = [entry("e3", 45), entry("e2", 25), entry("e1", 12)]
    expect(replyEntries(all, messages, "r1").map((c) => c.id)).toEqual(["e1", "e2"])
    expect(replyEntries(all, messages, "r2").map((c) => c.id)).toEqual(["e3"])
  })

  it("stretches the last reply to whatever came after it", () => {
    expect(replyEntries([entry("after", 90)], messages, "r2").map((c) => c.id)).toEqual(["after"])
  })

  it("keeps a broken reply's edit off the reply before it once that reply is retried", () => {
    // Q2/A2 edited rw.md and broke; Retry took Q2/A2 out and asked again as Q3/A3
    const all = [entry("e1", 12, { origin: { via: "tool", chatId: "c1", replyId: "r1" } }), entry("broken", 45, { origin: { via: "tool", chatId: "c1", replyId: "r2" } })]
    const retried = [question("q1", 0), reply("r1", 10, 20), question("q3", 60), reply("r3", 70, 80)]
    expect(replyEntries(all, retried, "r1").map((c) => c.id)).toEqual(["e1"])
    expect(replyEntries(all, retried, "r3")).toEqual([])
  })

  it("leaves out the person's entries and every undo", () => {
    const all = [entry("undo", 15, { actor: "p_1234abcd", undoes: "e1" }), entry("mine", 14, { actor: "p_1234abcd" }), entry("e1", 12)]
    expect(replyEntries(all, messages, "r1").map((c) => c.id)).toEqual(["e1"])
  })
})

describe("undoneBy", () => {
  it("reads undone and redone off the undo links", () => {
    const e = entry("e", 1)
    const u1 = entry("u1", 2, { actor: "p_1234abcd", undoes: "e" })
    expect(undoneBy("e", [u1, e])?.id).toBe("u1")
    // The undo undone (a redo): e stands again, until undone a second time
    const u2 = entry("u2", 3, { actor: "p_1234abcd", undoes: "u1" })
    expect(undoneBy("e", [u2, u1, e])).toBeUndefined()
    const u3 = entry("u3", 4, { actor: "p_1234abcd", undoes: "e" })
    expect(undoneBy("e", [u3, u2, u1, e])?.id).toBe("u3")
  })
})

describe("partsUndone", () => {
  it("counts the passages of an edit undone in the doc, apart from an undo of the whole", () => {
    const e = entry("e", 1)
    const p1 = entry("p1", 2, { actor: "p_1234abcd", undoes: "e", target: { kind: "doc", path: "a.md", part: "passage:0" } })
    const p2 = entry("p2", 3, { actor: "p_1234abcd", undoes: "e", target: { kind: "doc", path: "a.md", part: "passage:2" } })
    const all = [p2, p1, e]
    expect(partsUndone("e", all).map((c) => c.id)).toEqual(["p2", "p1"])
    // A passage undone is not the edit undone
    expect(undoneBy("e", all)).toBeUndefined()
    // A passage put back again no longer counts
    const back = entry("back", 4, { actor: "p_1234abcd", undoes: "p1", target: { kind: "doc", path: "a.md", part: "passage:0" } })
    expect(partsUndone("e", [back, ...all]).map((c) => c.id)).toEqual(["p2"])
  })

  it("still reads an undo of a comment, which names the comment's own part, as the whole undone", () => {
    const comment = entry("c", 1, { target: { kind: "comment", path: "a.md", part: "k1" } })
    const undo = entry("u", 2, { actor: "p_1234abcd", undoes: "c", target: { kind: "comment", path: "a.md", part: "k1" } })
    expect(undoneBy("c", [undo, comment])?.id).toBe("u")
    expect(partsUndone("c", [undo, comment])).toEqual([])
  })
})
