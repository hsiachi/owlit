import type { Change } from "@owlit/protocol"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { sha1 } from "../fs-util.ts"
import { ME, MY_OWLIT } from "../test-util.ts"
import { changeId, ChangeLog } from "./log.ts"
import { docProposals, proposalHunks } from "./proposals.ts"

const DOC = "a.md"
let n = 0
const entry = (at: number, actor: Change["actor"], before: string | null, after: string, extra: Partial<Change> = {}): [Change, string | undefined] => [
  { id: `${changeId(at, DOC)}-${n++}`, at, actor, action: before === null ? "create" : "update", target: { kind: "doc", path: DOC }, origin: { via: "tool" }, afterHash: sha1(after), ...extra },
  before ?? undefined,
]

describe("proposalHunks", () => {
  it("gives each passage with the words either side of it, stopping at the neighbouring passage", () => {
    const before = "One two three four five six seven eight nine ten."
    const after = "One 2 three four five six seven 8 nine ten, done."
    expect(proposalHunks(before, after)).toEqual([
      { insert: "2", removed: "two", before: "One ", after: " three four five six sev" },
      { insert: "8", removed: "eight", before: "ree four five six seven ", after: " nine ten" },
      { insert: ", done", removed: "", before: " nine ten", after: "." },
    ])
    expect(proposalHunks("same", "same")).toEqual([])
  })

  it("joins changes a few characters apart into one passage", () => {
    expect(proposalHunks("The method works well.", "The method works, mostly.")).toEqual([{ insert: ", mostly", removed: " well", before: "The method works", after: "." }])
  })
})

describe("docProposals", () => {
  async function logWith(entries: [Change, string | undefined][]) {
    const log = new ChangeLog(mkdtempSync(path.join(tmpdir(), "owlit-proposals-")))
    for (const [c, content] of entries) await log.append(c, content)
    return log
  }

  it("lists Owlit's standing changes since the text the person saw, as passages, and not the person's own", async () => {
    const seen = "The method works well.\n"
    const owlit = "The method works, mostly.\n"
    const mine = "The method works, mostly.\n\nMy own line.\n"
    const owlit2 = "The method works, mostly.\n\nMy own line, which Owlit touched.\n"
    const log = await logWith([entry(10, MY_OWLIT, "First draft.\n", seen), entry(20, MY_OWLIT, seen, owlit), entry(30, ME, owlit, mine), entry(40, MY_OWLIT, mine, owlit2)])
    const got = await docProposals(log, DOC, owlit2, { hash: sha1(seen) })
    expect(got.map((p) => [p.at, p.hunks])).toEqual([
      [20, [{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }]],
      [40, [{ insert: ", which Owlit touched", removed: "", before: expect.stringMatching(/My own line$/), after: ".\n" }]],
    ])
    // Nothing once the doc reads as the person saw it, or when the log doesn't reach the text they saw
    expect(await docProposals(log, DOC, seen, { hash: sha1(seen) })).toEqual([])
    expect(await docProposals(log, DOC, owlit2, { hash: sha1("never seen") })).toEqual([])
  })

  it("leaves out a change that was undone, and starts from a time when the person has no mark", async () => {
    const a = "One.\n"
    const b = "One. Two.\n"
    const c = "One. Two. Three.\n"
    const [made, madeContent] = entry(20, MY_OWLIT, a, b)
    const undo = entry(30, ME, b, a, { undoes: made.id })
    const later = entry(40, MY_OWLIT, a, c)
    const log = await logWith([entry(10, MY_OWLIT, null, a, { origin: { via: "tool", chatId: "c1" } }), [made, madeContent], undo, later])
    const got = await docProposals(log, DOC, c, { hash: sha1(a) })
    expect(got.map((p) => p.at)).toEqual([40])
    // From a time: the doc Owlit made is one whole proposal with no passages, taking in its later changes
    expect(await docProposals(log, DOC, c, { since: 5 })).toEqual([{ id: expect.any(String), at: 10, actor: MY_OWLIT, chatId: "c1", hunks: [], whole: { also: [later[0].id] } }])
    expect((await docProposals(log, DOC, c, { since: 35 })).map((p) => p.at)).toEqual([40])
  })
})
