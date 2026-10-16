import type { EvaluationRecord, InitiativeSettings, Task } from "@owlit/protocol"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { Workspace } from "../workspace/workspace.ts"
import { Initiative } from "./initiative.ts"
import { ManualClock } from "./manual-clock.ts"
import { defineRule, RULES, type Rule } from "./rules.ts"

// Just what the engine and these rules touch of a workspace
function fakeWorkspace(settings: Partial<InitiativeSettings> = {}) {
  const queued: { kind: string; subject: string; priority: string }[] = []
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-initiative-"))
  const ws = {
    root: dir,
    owlitPath: (...s: string[]) => path.join(dir, ".owlit", ...s),
    initiative: async () => ({ mode: "off", dailyCap: 20, ...settings }),
    tasks: {
      enqueue: (kind: string, subject: string, priority: string) => {
        queued.push({ kind, subject, priority })
        return { id: `t${queued.length}` } as Task
      },
    },
  }
  return { ws: ws as unknown as Workspace, queued, settings }
}

function engine(rules: readonly Rule[], ws: Workspace) {
  const clock = new ManualClock()
  const records: EvaluationRecord[] = []
  const initiative = new Initiative({ workspace: () => ws, record: (r) => records.push(r), rules, clock })
  return { clock, records, initiative }
}

const docOpened = (path: string, at = 0) => ({ kind: "doc.opened" as const, at, path })

// A rule that looks at each doc opened, once things settle, if it isn't about a draft
const review = defineRule({
  id: "test.review",
  on: ["doc.opened", "doc.edited"],
  needs: "onOpen",
  key: (e) => e.path,
  settleMs: 1000,
  when: async (e) => [e.path.startsWith("draft") ? { subject: e.path, none: "a draft" } : { subject: e.path, job: { kind: "docs.review", subject: e.path, priority: "background" } }],
})

const upkeep = defineRule({
  id: "test.upkeep",
  on: ["doc.opened"],
  needs: "off",
  when: async (e) => [{ subject: e.path, defer: "the user is on that page" }],
})

describe("Initiative", () => {
  it("settles events by key: several in a row make one evaluation, after the last", async () => {
    const { ws, queued } = fakeWorkspace({ mode: "onOpen" })
    const { clock, records, initiative } = engine([review], ws)
    initiative.observe(docOpened("a.md"))
    clock.advance(600)
    initiative.observe({ kind: "doc.edited", at: 0, path: "a.md" })
    initiative.observe(docOpened("b.md"))
    clock.advance(600)
    await initiative.idle()
    expect(records).toHaveLength(0)
    clock.advance(500)
    await initiative.idle()
    // Due together, they are taken in the order they were last heard
    expect(records.map((r) => [r.subject, r.decision, r.cause])).toEqual([
      ["a.md", "job", "doc.edited"],
      ["b.md", "job", "doc.opened"],
    ])
    expect(queued).toEqual([
      { kind: "docs.review", subject: "a.md", priority: "background" },
      { kind: "docs.review", subject: "b.md", priority: "background" },
    ])
  })

  it("forgets what was settling when the workspace closes", async () => {
    const { ws, queued } = fakeWorkspace({ mode: "onOpen" })
    const { clock, records, initiative } = engine([review], ws)
    initiative.observe(docOpened("a.md"))
    initiative.reset()
    clock.advance(1000)
    await initiative.idle()
    expect(records).toEqual([])
    expect(queued).toEqual([])
    // Heard afterwards: taken as before
    initiative.observe(docOpened("b.md"))
    clock.advance(1000)
    await initiative.idle()
    expect(queued.map((q) => q.subject)).toEqual(["b.md"])
  })

  it("leaves initiative rules out while the dial is Off; upkeep still runs", async () => {
    const { ws, queued } = fakeWorkspace({ mode: "off" })
    const { clock, records, initiative } = engine([review, upkeep], ws)
    initiative.observe(docOpened("a.md"))
    clock.advance(2000)
    await initiative.idle()
    expect(queued).toEqual([])
    expect(records.map((r) => [r.rule, r.decision, r.reason])).toEqual([["test.upkeep", "defer", "the user is on that page"]])
  })

  it("logs every evaluation, with or without an action", async () => {
    const { ws } = fakeWorkspace({ mode: "away" })
    const { clock, records, initiative } = engine([review], ws)
    initiative.observe(docOpened("draft.md"))
    initiative.observe(docOpened("a.md"))
    clock.advance(1000)
    await initiative.idle()
    expect(records).toEqual([
      expect.objectContaining({ kind: "evaluation", rule: "test.review", subject: "draft.md", decision: "none", reason: "a draft", cause: "doc.opened", at: clock.at }),
      expect.objectContaining({ subject: "a.md", decision: "job", taskId: "t1" }),
    ])
  })

  it("stops starting runs on its own past the daily cap; upkeep isn't counted", async () => {
    const { ws, queued } = fakeWorkspace({ mode: "onOpen", dailyCap: 2 })
    const { clock, records, initiative } = engine([review], ws)
    for (const p of ["a.md", "b.md", "c.md"]) initiative.observe(docOpened(p))
    clock.advance(1000)
    await initiative.idle()
    expect(queued.map((q) => q.subject)).toEqual(["a.md", "b.md"])
    expect(records.at(-1)).toMatchObject({ subject: "c.md", decision: "none", reason: "cap" })
    // A new day starts the count again
    clock.advance(24 * 3_600_000)
    initiative.observe(docOpened("c.md"))
    clock.advance(1000)
    await initiative.idle()
    expect(queued.map((q) => q.subject)).toEqual(["a.md", "b.md", "c.md"])
  })

  it("keeps today's upkeep rules (digests, watched threads) at Off, review behind When I open things, the night shift behind Also while I'm away", () => {
    expect(RULES.map((r) => [r.id, r.needs])).toEqual([
      ["digest.onOpen", "off"],
      ["digest.onStar", "off"],
      ["threads.checkWatched", "off"],
      ["docs.reviewOnOpen", "onOpen"],
      ["docs.reviewSettled", "away"],
      ["paper.landed", "away"],
      ["paper.readInFull", "away"],
      ["docs.dailyScan", "away"],
      ["meetings.goThrough", "away"],
    ])
  })

  it("puts a decision off while the user writes there, and takes it again once they leave", async () => {
    const { ws, queued } = fakeWorkspace({ mode: "onOpen" })
    let writing = true
    const careful = defineRule({
      id: "test.careful",
      on: ["doc.opened"],
      needs: "onOpen",
      when: async (e) => [writing ? { subject: e.path, defer: "the user is writing in it" } : { subject: e.path, job: { kind: "docs.review", subject: e.path, priority: "background" } }],
    })
    const { records, initiative } = engine([careful], ws)
    initiative.observe(docOpened("a.md"))
    await initiative.idle()
    expect(queued).toEqual([])
    writing = false
    initiative.observe({ kind: "doc.closed", at: 0, path: "a.md" })
    await initiative.idle()
    expect(records.map((r) => r.decision)).toEqual(["defer", "job"])
    expect(queued.map((q) => q.subject)).toEqual(["a.md"])
  })
})
