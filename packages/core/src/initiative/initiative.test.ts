import type { EvaluationRecord, Task } from "@owlit/protocol"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { Workspace } from "../workspace/workspace.ts"
import { DAILY_CAP, Initiative } from "./initiative.ts"
import { ManualClock } from "./manual-clock.ts"
import { defineRule, RULES, type Rule } from "./rules.ts"

// Just what the engine and these rules touch of a workspace
function fakeWorkspace() {
  const queued: { kind: string; subject: string; priority: string }[] = []
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-initiative-"))
  const ws = {
    root: dir,
    owlitPath: (...s: string[]) => path.join(dir, ".owlit", ...s),
    tasks: {
      enqueue: (kind: string, subject: string, priority: string) => {
        queued.push({ kind, subject, priority })
        return { id: `t${queued.length}` } as Task
      },
    },
  }
  return { ws: ws as unknown as Workspace, queued }
}

function engine(rules: readonly Rule[], ws: Workspace) {
  const clock = new ManualClock()
  const records: EvaluationRecord[] = []
  const initiative = new Initiative({ workspace: () => ws, record: (r) => records.push(r), rules, clock })
  return { clock, records, initiative }
}

const starred = (paperId: string, at = 0) => ({ kind: "paper.starred" as const, at, paperId })

// A rule whose runs fan out from one event, so they are capped; a draft gets none
const fanOut = defineRule({
  id: "test.fanOut",
  on: ["paper.starred"],
  capped: true,
  when: async (e) => [e.paperId.startsWith("draft") ? { subject: e.paperId, none: "a draft" } : { subject: e.paperId, job: { kind: "paper.digest", subject: e.paperId, priority: "background" } }],
})

// One act of the user's, one run: never capped
const upkeep = defineRule({
  id: "test.upkeep",
  on: ["paper.starred"],
  capped: false,
  when: async (e) => [{ subject: e.paperId, job: { kind: "paper.digest", subject: e.paperId, priority: "background" } }],
})

describe("Initiative", () => {
  it("takes evaluations one at a time in the order heard, and logs every one, with or without an action", async () => {
    const { ws, queued } = fakeWorkspace()
    const { clock, records, initiative } = engine([fanOut], ws)
    initiative.observe(starred("draft-1"))
    initiative.observe(starred("p1"))
    await initiative.idle()
    expect(records).toEqual([
      expect.objectContaining({ kind: "evaluation", rule: "test.fanOut", subject: "draft-1", decision: "none", reason: "a draft", cause: "paper.starred", at: clock.at }),
      expect.objectContaining({ subject: "p1", decision: "job", taskId: "t1" }),
    ])
    expect(queued).toEqual([{ kind: "paper.digest", subject: "p1", priority: "background" }])
  })

  it("stops starting capped runs past the daily cap; uncapped ones aren't counted and go on", async () => {
    const { ws, queued } = fakeWorkspace()
    const { clock, records, initiative } = engine([fanOut, upkeep], ws)
    for (let i = 0; i < DAILY_CAP; i++) initiative.observe(starred(`p${i}`))
    await initiative.idle()
    expect(queued.filter((q) => q.subject === "p0")).toHaveLength(2)
    initiative.observe(starred("one-more"))
    await initiative.idle()
    expect(records.filter((r) => r.subject === "one-more").map((r) => [r.rule, r.decision, r.reason])).toEqual([
      ["test.fanOut", "none", "cap"],
      ["test.upkeep", "job", undefined],
    ])
    // A new day starts the count again
    clock.advance(24 * 3_600_000)
    initiative.observe(starred("next-day"))
    await initiative.idle()
    expect(records.filter((r) => r.subject === "next-day").map((r) => r.decision)).toEqual(["job", "job"])
  })

  it("forgets what was heard when the workspace closes", async () => {
    const { ws, queued } = fakeWorkspace()
    const { records, initiative } = engine([fanOut], ws)
    initiative.observe(starred("p1"))
    initiative.reset()
    await initiative.idle()
    expect(records).toEqual([])
    expect(queued).toEqual([])
    // Heard afterwards: taken as before
    initiative.observe(starred("p2"))
    await initiative.idle()
    expect(queued.map((q) => q.subject)).toEqual(["p2"])
  })

  it("keeps up with the user and nothing more: a star, a watched thread, a paper read in full", () => {
    expect(RULES.map((r) => [r.id, r.capped])).toEqual([
      ["digest.onStar", false],
      ["threads.checkWatched", false],
      ["paper.readInFull", true],
    ])
  })
})
