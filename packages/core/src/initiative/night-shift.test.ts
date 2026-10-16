import type { DocComment, DocOwlit, EvaluationRecord, InitiativeMode, Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { Workspace } from "../workspace/workspace.ts"
import { Initiative } from "./initiative.ts"
import { ManualClock } from "./manual-clock.ts"
import { Presence } from "./presence.ts"
import { dailyScan, paperLanded, paperRead, reviewSettled, type Rule } from "./rules.ts"

// The night shift's rules on a workspace of a doc, a thread and a comment, with the clock moved by hand

const MIN = 60_000
const at = Date.parse("2026-10-16T09:00:00Z")

function fakeWorkspace(mode: InitiativeMode = "away", parts: { comments?: Record<string, DocComment[]>; rows?: { thread: string; fromAbstract: boolean }[] } = {}) {
  const queued: { kind: string; subject: string }[] = []
  const root = mkdtempSync(path.join(tmpdir(), "owlit-night-"))
  mkdirSync(path.join(root, ".owlit"))
  writeFileSync(path.join(root, "story.md"), "# Story\n\nA claim.\n")
  writeFileSync(path.join(root, "other.md"), "# Other\n")
  const owlit: Record<string, DocOwlit> = {}
  const ws = {
    root,
    owlitPath: (...s: string[]) => path.join(root, ".owlit", ...s),
    initiative: async () => ({ mode, dailyCap: 20 }),
    docs: { owlitOf: async (rel: string) => owlit[rel] ?? {}, commentsAll: async () => parts.comments ?? {} },
    library: { digestHeldBack: async () => null },
    threads: { list: async () => [{ id: "t1", papers: 3 }], rowsOf: async () => parts.rows ?? [] },
    tasks: {
      enqueue: (kind: string, subject: string) => {
        queued.push({ kind, subject })
        return { id: `t${queued.length}` } as Task
      },
    },
  }
  return { ws: ws as unknown as Workspace, queued, owlit }
}

function engine(rules: readonly Rule[], ws: Workspace) {
  const clock = new ManualClock()
  clock.at = at
  const records: EvaluationRecord[] = []
  const presence = new Presence()
  const initiative = new Initiative({ workspace: () => ws, record: (r) => records.push(r), rules, clock, presence })
  return { clock, records, initiative, presence }
}

describe("Presence: away", () => {
  it("is away from when the window went to the background until the next activity, coming back included", () => {
    const presence = new Presence()
    presence.hear({ kind: "doc.opened", at, path: "story.md" })
    presence.hear({ kind: "doc.edited", at: at + 1000, path: "story.md" })
    expect(presence.isAway).toBe(false)
    expect(presence.writingIn("story.md", at + 2000)).toBe(true)
    expect(presence.inDoc("story.md")).toBe(true)
    // A short stay in the background doesn't count
    presence.hear({ kind: "idle", at: at + 20_000, seconds: 10 })
    expect(presence.isAway).toBe(false)
    presence.hear({ kind: "idle", at: at + 40_000, seconds: 30 })
    expect(presence.isAway).toBe(true)
    expect(presence.awaySince).toBe(at + 10_000)
    // Away, the user isn't in the doc the window still shows
    expect(presence.writingIn("story.md", at + 40_000)).toBe(false)
    expect(presence.inDoc("story.md")).toBe(false)
    expect(presence.openDoc).toBe("story.md")
    presence.hear({ kind: "back", at: at + 15 * MIN, seconds: 900 })
    expect(presence.isAway).toBe(false)
    expect(presence.inDoc("story.md")).toBe(true)
  })
})

describe("The night shift", () => {
  it("reviews a doc once its edit has settled for ten minutes and the user is away", async () => {
    const { ws, queued } = fakeWorkspace()
    const { clock, records, initiative } = engine([reviewSettled], ws)
    initiative.observe({ kind: "doc.opened", at, path: "story.md" })
    initiative.observe({ kind: "doc.edited", at, path: "story.md" })
    // More typing pushes the settling back
    clock.advance(5 * MIN)
    initiative.observe({ kind: "doc.edited", at: clock.at, path: "story.md" })
    // The user leaves for another app
    initiative.observe({ kind: "idle", at: clock.at + 30_000, seconds: 30 })
    clock.advance(9 * MIN)
    await initiative.idle()
    expect(records).toEqual([])
    clock.advance(MIN)
    await initiative.idle()
    expect(records.map((r) => [r.rule, r.subject, r.decision, r.cause])).toEqual([["docs.reviewSettled", "story.md", "job", "doc.edited"]])
    expect(queued).toEqual([{ kind: "docs.reviewSettled", subject: "story.md" }])
  })

  it("waits while the user is here, saying so once, and acts when they go away", async () => {
    const { ws, queued } = fakeWorkspace()
    const { clock, records, initiative } = engine([reviewSettled, dailyScan], ws)
    initiative.observe({ kind: "doc.opened", at, path: "story.md" })
    initiative.observe({ kind: "doc.edited", at, path: "story.md" })
    clock.advance(10 * MIN)
    await initiative.idle()
    expect(records.map((r) => [r.subject, r.decision, r.reason])).toEqual([["story.md", "defer", "the user is in it"]])
    // Not looked at again every typing pause, and the hourly look while they stay logs nothing new
    initiative.observe({ kind: "clock.hour", at: clock.at })
    initiative.observe({ kind: "clock.hour", at: clock.at })
    clock.advance(60 * MIN)
    await initiative.idle()
    expect(records.map((r) => [r.rule, r.decision])).toEqual([
      ["docs.reviewSettled", "defer"],
      ["docs.dailyScan", "defer"],
    ])
    expect(queued).toEqual([])
    initiative.observe({ kind: "idle", at: clock.at, seconds: 30 })
    await initiative.idle()
    expect(queued).toEqual([
      { kind: "docs.reviewSettled", subject: "story.md" },
      { kind: "docs.scan", subject: "workspace" },
    ])
  })

  it("leaves a doc unchanged since Owlit looked, and one kept out", async () => {
    const { ws, queued, owlit } = fakeWorkspace()
    owlit["story.md"] = { looked: { at, mtime: Date.now() + 60_000, outcome: "nothing", count: 0 } }
    owlit["other.md"] = { out: at }
    const { clock, records, initiative } = engine([reviewSettled], ws)
    initiative.observe({ kind: "idle", at, seconds: 30 })
    initiative.observe({ kind: "doc.edited", at, path: "story.md" })
    initiative.observe({ kind: "doc.edited", at, path: "other.md" })
    clock.advance(10 * MIN)
    await initiative.idle()
    expect(records.map((r) => [r.subject, r.reason])).toEqual([
      ["story.md", "unchanged since Owlit looked"],
      ["other.md", "kept out"],
    ])
    expect(queued).toEqual([])
  })

  it("does nothing on its own below Also while I'm away", async () => {
    const { ws, queued } = fakeWorkspace("onOpen")
    const { clock, records, initiative } = engine([reviewSettled, paperLanded, dailyScan], ws)
    initiative.observe({ kind: "idle", at, seconds: 30 })
    initiative.observe({ kind: "doc.edited", at, path: "story.md" })
    initiative.observe({ kind: "paper.landed", at, paperId: "p1", by: "user" })
    initiative.observe({ kind: "workspace.opened", at })
    clock.advance(10 * MIN)
    await initiative.idle()
    expect(records).toEqual([])
    expect(queued).toEqual([])
  })

  it("writes a landed paper's digest and sees whether it belongs in a thread", async () => {
    const { ws, queued } = fakeWorkspace()
    const { records, initiative } = engine([paperLanded], ws)
    initiative.observe({ kind: "paper.landed", at, paperId: "p1", by: "outside" })
    await initiative.idle()
    expect(records.map((r) => [r.subject, r.decision, r.reason ?? null])).toEqual([["p1", "defer", "waiting for the user to be away"]])
    initiative.observe({ kind: "idle", at, seconds: 30 })
    await initiative.idle()
    expect(queued).toEqual([
      { kind: "paper.digest", subject: "p1" },
      { kind: "paper.relate", subject: "p1" },
    ])
  })

  it("looks again at what leans on a paper read in full: thread rows from its abstract, Owlit's comments citing it", async () => {
    const owlitComment = (id: string, text: string): DocComment => ({ id, quote: "A claim.", prefix: "", suffix: "", createdAt: at, entries: [{ id: `${id}e`, by: "owlit", text, at }] })
    const { ws, queued } = fakeWorkspace("away", {
      rows: [
        { thread: "t1", fromAbstract: true },
        { thread: "t2", fromAbstract: false },
      ],
      comments: {
        "story.md": [owlitComment("c1", "[Lee 2024](owlit://library/p1) says otherwise."), owlitComment("c2", "[Kim 2023](owlit://library/p2) agrees.")],
        "other.md": [{ ...owlitComment("c3", "As [Lee](owlit://library/p1#passage=x) found."), dismissedAt: at }],
      },
    })
    const { records, initiative } = engine([paperRead], ws)
    initiative.observe({ kind: "idle", at, seconds: 30 })
    initiative.observe({ kind: "paper.read", at, paperId: "p1" })
    await initiative.idle()
    expect(queued).toEqual([
      { kind: "threads.reread", subject: "t1:p1" },
      { kind: "docs.recheck", subject: "story.md#c1|p1" },
    ])
    expect(records.find((r) => r.subject === "t2:p1")).toMatchObject({ decision: "none", reason: "answered from the full text already" })
  })

  it("looks over the docs once a day, by the journal's record of its last look", async () => {
    const { ws, queued } = fakeWorkspace()
    const { clock, records, initiative } = engine([dailyScan], ws)
    initiative.observe({ kind: "idle", at, seconds: 30 })
    initiative.observe({ kind: "clock.hour", at })
    await initiative.idle()
    expect(queued).toEqual([{ kind: "docs.scan", subject: "workspace" }])
    clock.advance(60 * MIN)
    initiative.observe({ kind: "clock.hour", at: clock.at })
    await initiative.idle()
    expect(queued).toHaveLength(1)
    expect(records).toHaveLength(1)

    // A new launch reads the last look from the journal
    writeFileSync(ws.owlitPath("journal.jsonl"), records.map((r) => JSON.stringify({ ...r, actor: "owlit" })).join("\n") + "\n")
    const next = engine([dailyScan], ws)
    next.clock.at = clock.at
    next.initiative.observe({ kind: "workspace.opened", at: clock.at })
    await next.initiative.idle()
    expect(next.records.map((r) => [r.decision, r.reason])).toEqual([["none", "looked within a day"]])
    next.clock.at += 24 * 60 * MIN
    next.initiative.observe({ kind: "idle", at: next.clock.at, seconds: 30 })
    next.initiative.observe({ kind: "clock.hour", at: next.clock.at })
    await next.initiative.idle()
    expect(next.records.at(-1)).toMatchObject({ decision: "job" })
  })
})
