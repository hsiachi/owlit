import type { Change } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { sinceLines } from "./since-lines"

const ME = "p_1234abcd" as const
const OWLIT = "o_1234abcd" as const
let n = 0
const entry = (at: number, target: Change["target"], extra: Partial<Change> = {}): Change => ({ id: `e${n++}`, at, actor: OWLIT, action: "update", target, origin: { via: "tool" }, ...extra })
const row = (id: string, title: string) => ({ value: { id, paper: { title, authors: [], ids: {} }, cells: {}, addedAt: 1 } })

describe("sinceLines", () => {
  it("groups what others changed by place, naming the papers added to a thread, latest place first", () => {
    const changes = [
      entry(90, { kind: "comment", path: "draft.md", part: "c2" }, { action: "create" }),
      entry(80, { kind: "thread", path: "rag", part: "row:p2" }, { action: "create", after: row("p2", "Self-RAG") }),
      entry(80, { kind: "paper", path: "p2" }, { action: "create" }),
      entry(79, { kind: "thread", path: "rag", part: "row:p1" }, { action: "create", after: row("p1", "RARR") }),
      entry(79, { kind: "paper", path: "p1" }, { action: "create" }),
      entry(70, { kind: "doc", path: "related-work.md" }),
      entry(65, { kind: "comment", path: "draft.md", part: "c1" }, { action: "create" }),
      entry(64, { kind: "comment", path: "draft.md", part: "c1/e2" }, { action: "create" }),
      entry(60, { kind: "paper", path: "p9" }, { action: "create" }),
      entry(55, { kind: "doc", path: "new.md" }, { action: "create", actor: "other" }),
      entry(50, { kind: "thread", path: "rag", part: "column:c2" }, { action: "create" }),
    ]
    expect(sinceLines(changes, ME)).toEqual([
      { kind: "comments", key: "comments:draft.md", path: "draft.md", actor: OWLIT, count: 2, at: 90 },
      { kind: "thread", key: "thread:rag", id: "rag", made: false, added: ["Self-RAG", "RARR"], changed: 0, at: 80 },
      { kind: "doc", key: "doc:related-work.md", path: "related-work.md", actor: OWLIT, did: "edited", at: 70 },
      // Papers that came as a thread's rows are said with the thread
      { kind: "papers", key: "papers", ids: ["p9"], at: 60 },
      { kind: "doc", key: "doc:new.md", path: "new.md", actor: "other", did: "made", at: 55 },
    ])
  })

  it("never lists the person's own changes, nor a thread whose only change has no dot", () => {
    const changes = [
      entry(30, { kind: "doc", path: "mine.md" }, { actor: ME }),
      entry(20, { kind: "thread", path: "rag", part: "row:p1" }, { action: "create", actor: ME, after: row("p1", "RARR") }),
      entry(10, { kind: "thread", path: "other", part: "column:c1" }, { action: "create" }),
    ]
    expect(sinceLines(changes, ME)).toEqual([])
  })
})
