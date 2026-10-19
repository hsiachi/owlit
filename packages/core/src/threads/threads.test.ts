import { itemId, placedKey, shownThread, type Change, type Notifications, type Thread, type ThreadPaper } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ChangeLog } from "../changes/log.ts"
import { Recorder } from "../changes/record.ts"
import { Seen } from "../changes/seen.ts"
import { Scheduler, TaskStore } from "../tasks/index.ts"
import { Threads, uniqueId, type ThreadsServices } from "./threads.ts"

const papers: Record<string, ThreadPaper> = {
  "doi-10.1145-1": { title: "Replay or Live? Validity of Retrospective Ratings", authors: ["Fernández", "Oh"], ids: { doi: "10.1145/1" }, year: 2026 },
  "doi-10.1145-2": { title: "Retrospective think-aloud with lifelog video", authors: ["Kelly"], ids: { doi: "10.1145/2" }, year: 2015, abstract: "Wearers explained their own footage." },
  "doi-10.1145-3": { title: "Experience sampling versus retrospective recall", authors: ["van Berkel"], ids: { doi: "10.1145/3" }, year: 2017, abstract: "Recall ran lower than sampling." },
}

function setup(services: ThreadsServices = {}) {
  const owlit = mkdtempSync(path.join(tmpdir(), "owlit-threads-"))
  const changes = new ChangeLog(owlit)
  const events: { id: string; gone: boolean }[] = []
  const wrote: Notifications["changes.added"][] = []
  // One clock for the log and the marks, a tick per reading, so a write after a mark is always later
  let tick = 1_000
  const now = () => ++tick
  const recorder = new Recorder(changes, { profile: async () => ({ id: "1234abcd" }), added: (n) => wrote.push(n), now })
  const seen = new Seen(owlit, now)
  const threads = new Threads(
    owlit,
    { recorder },
    {
      paper: async (id) => papers[id],
      changed: (id, c) => events.push({ id, gone: !c }),
      ...services,
    },
  )
  // The thread's items that carry a dot for the person: unseen entries by anyone else
  const dots = async (id: string) =>
    (await seen.unseen(ME, { changes: await changes.list(), chats: [], papers: [] })).changes.filter((c) => c.target.path === id).map((c) => c.target.part)
  return { owlit, changes, threads, events, wrote, seen, dots }
}

const ME = "p_1234abcd" as const

// An agent on owlit's socket, working for a run (or the chat its write names)
const agent = { kind: "socket" as const, run: "threads.more:t1" }
const window = { kind: "window" as const }

const start = (threads: Threads, extra: object = {}) =>
  threads.write({
    asked: "我的研究方法该怎么设计？",
    title: "回放式标注作为研究方法",
    project: "主动提醒研究",
    sources: ["Semantic Scholar"],
    memo: [{ text: "Two precedents had wearers replay their own footage." }, { text: "Replay ratings run lower than live ones." }],
    rows: [
      { id: "doi-10.1145-1", cells: { q: { text: "Replay ratings 0.6 lower, same direction.", depth: "full", passage: { quote: "0.6 points lower", page: 7 } } } },
      { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "abstract" } } },
    ],
    chatId: "chat-1",
    ...extra,
  }, agent)

describe("Threads.write", () => {
  it("starts a thread with the question as its first column and the papers as the search found them", async () => {
    const { threads, wrote } = setup()
    const out = await start(threads)
    expect(out).toMatchObject({ title: "回放式标注作为研究方法", added: 2, updated: 0, left: [] })
    const c = await threads.get(out.id)
    expect(c.columns).toEqual([{ id: "q", question: "我的研究方法该怎么设计？", kind: "ask" }])
    expect(c.rows.map((r) => r.paper.title)).toEqual([papers["doi-10.1145-1"]!.title, papers["doi-10.1145-2"]!.title])
    expect(c.asked).toMatchObject({ text: "我的研究方法该怎么设计？", chatId: "chat-1" })
    expect(c.memo.map((s) => s.id)).toEqual(["s1", "s2"])
    expect(wrote).toMatchObject([
      { change: { action: "create", target: { kind: "thread", path: out.id }, origin: { chatId: "chat-1" } }, label: "回放式标注作为研究方法", thread: { rows: ["doi-10.1145-1", "doi-10.1145-2"] } },
    ])
  })

  it("keeps an answer from the abstract of a paper with none as from its title", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Ratings ran lower.", depth: "abstract" } } }] }, agent)
    const c = await threads.get(id)
    expect(c.rows.find((r) => r.id === "doi-10.1145-1")!.cells.q).toMatchObject({ depth: "title" })
    expect(c.rows.find((r) => r.id === "doi-10.1145-2")!.cells.q).toMatchObject({ depth: "abstract" })
  })

  it("refuses a paper it can't look up, and a new thread without its question or title", async () => {
    const { threads } = setup()
    await expect(threads.write({ title: "x" }, agent)).rejects.toThrow(/asked/)
    await expect(start(threads, { rows: [{ id: "doi-10.9999-x" }] })).rejects.toThrow(/doesn't know the paper doi-10.9999-x/)
  })

  it("adds to a thread, with a dot only on what changed after the user's look", async () => {
    const { threads, seen, dots } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3" }] }, agent)
    // Never looked at, the whole thread is new: nothing in it has a dot of its own
    expect(await dots(id)).toEqual([])
    await seen.mark(ME, { kind: "thread", id, items: [] })
    const out = await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Retrospective answers run lower.", depth: "abstract" } } }, { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "abstract" } } }] }, agent)
    expect(out).toMatchObject({ added: 0, updated: 1 })
    expect(await dots(id)).toEqual([itemId.cell("doi-10.1145-3", "q")])
    // On screen, the row's items are seen; the thread's other rows keep theirs
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Replay ratings run lower.", depth: "abstract" } } }] }, agent)
    await seen.mark(ME, { kind: "thread", id, items: [itemId.row("doi-10.1145-3"), itemId.cell("doi-10.1145-3", "q")] })
    expect(await dots(id)).toEqual([itemId.cell("doi-10.1145-1", "q")])
  })

  it("keeps the user's rewrite of a cell through Owlit's later answers, without a dot", async () => {
    const { threads, seen, dots } = setup()
    const { id } = await start(threads)
    await seen.mark(ME, { kind: "thread", id, items: [] })
    await threads.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-2", "q"), text: "Lifelog replay beats diaries." }, window)
    await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "Explanations from replay are more complete.", depth: "full", passage: { quote: "more complete", page: 12 } } } }] }, agent)
    const c = await threads.get(id)
    const shown = shownThread(c)
    expect(shown.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Lifelog replay beats diaries.")
    expect(c.overrides.edits[itemId.cell("doi-10.1145-2", "q")]?.was).toBe("Own explanations recover more.")
    expect(await dots(id)).toEqual([])
    // Owlit's own answer is still there underneath
    expect(c.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Explanations from replay are more complete.")
  })

  it("never brings back a row the user removed", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "remove", item: itemId.row("doi-10.1145-2") }, window)
    const out = await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "again", depth: "abstract" } } }] }, agent)
    expect(out.left).toEqual(["doi-10.1145-2"])
    expect(shownThread(await threads.get(id)).rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
  })

  it("keeps a memo sentence the user rewrote even when Owlit drops it, and keeps removed words out", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rewrite", item: itemId.memo("s1"), text: "ProAgent and Kelly 2015 are the closest precedents." }, window)
    await threads.edit(id, { op: "remove", item: itemId.memo("s2") }, window)
    await threads.write({ id, memo: [{ text: "Replay ratings run lower than live ones." }, { text: "Nothing compares replay with live reminders." }] }, agent)
    const shown = shownThread(await threads.get(id))
    expect(shown.memo.map((s) => s.text)).toEqual(["ProAgent and Kelly 2015 are the closest precedents.", "Nothing compares replay with live reminders."])
  })

  it("groups rows in a hidden Topic grouping, and refuses a group that isn't there", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await expect(threads.write({ id, rows: [{ id: "doi-10.1145-1", group: "eval" }] }, agent)).rejects.toThrow(/group eval/)
    await threads.write({ id, groups: [{ id: "eval", name: "Evaluating proactive systems" }], rows: [{ id: "doi-10.1145-1", group: "eval" }] }, agent)
    const c = await threads.get(id)
    expect(c.columns.at(-1)).toEqual({ id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: [{ id: "eval", name: "Evaluating proactive systems" }] })
    expect(c.rows[0]?.in).toEqual({ topic: ["eval"] })
    await threads.edit(id, { op: "ungroup", column: "topic", group: "eval" }, window)
    const shown = shownThread(await threads.get(id))
    expect(shown.columns.at(-1)?.groups).toEqual([])
    expect(shown.rows[0]?.in).toBeUndefined()
  })

  it("adds a column once, however often it is asked", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, columns: [{ question: "Method and sample" }] }, agent)
    await threads.write({ id, columns: [{ question: "Method  and sample" }] }, agent)
    expect((await threads.get(id)).columns.map((c) => c.question)).toEqual(["我的研究方法该怎么设计？", "Method and sample"])
    await expect(threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { nope: { text: "x", depth: "abstract" } } }] }, agent)).rejects.toThrow(/no column nope/)
  })
})

const GROUPS = [
  { id: "a", name: "Replay" },
  { id: "b", name: "Live" },
  { id: "c", name: "Recall" },
]
const inGroups = (c: Thread) => Object.fromEntries(shownThread(c).rows.map((r) => [r.id, r.in?.topic ?? []]))

describe("Threads, the user's groups", () => {
  it("keeps a paper the user moved where they put it, whatever Owlit writes after", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "b" }] })
    await threads.edit(id, { op: "move", column: "topic", row: "doi-10.1145-1", group: "b" }, window)
    expect((await threads.get(id)).overrides.placed).toMatchObject({ [placedKey("topic", "doi-10.1145-1", "a")]: { in: false }, [placedKey("topic", "doi-10.1145-1", "b")]: { in: true } })
    // Owlit writes the whole grouping again, with the paper back in its old group
    await threads.write({ id, groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] }, agent)
    // The paper the user didn't touch is Owlit's to move
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["c"] })
    // A group the user put a paper in stays when Owlit leaves it out
    await threads.write({ id, groups: [GROUPS[0]!, GROUPS[2]!] }, agent)
    const c = await threads.get(id)
    expect(shownThread(c).columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["a", "b", "c"])
    expect(inGroups(c)).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["c"] })
  })

  it("keeps merged and ungrouped groups so, and says so to the agent", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "a", into: "b" }, window)
    await threads.edit(id, { op: "ungroup", column: "topic", group: "c" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [] })
    const out = await threads.write({ id, groups: GROUPS, rows: [{ id: "doi-10.1145-3", group: "a" }, { id: "doi-10.1145-2", group: "c" }] }, agent)
    expect(out.userKept).toEqual([expect.stringMatching(/merged group a .* into b/), expect.stringMatching(/ungrouped c/), expect.stringMatching(/doi-10.1145-2 isn't in c/)])
    const c = await threads.get(id)
    expect(shownThread(c).columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["b"])
    expect(inGroups(c)).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [], "doi-10.1145-3": ["b"] })
    // Undoing the ungroup brings the group and Owlit's papers in it back
    await threads.edit(id, { op: "unremove", item: itemId.group("topic", "c") }, window)
    expect(inGroups(await threads.get(id))["doi-10.1145-2"]).toEqual(["c"])
  })

  it("keeps the user's name for a group through Owlit's rewrites", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS })
    await threads.edit(id, { op: "rewrite", item: itemId.group("topic", "a"), text: "Watching it again" }, window)
    await threads.write({ id, groups: [{ id: "a", name: "Replay studies" }] }, agent)
    expect(shownThread(await threads.get(id)).columns.at(-1)?.groups).toEqual([{ id: "a", name: "Watching it again" }])
  })

  it("refuses a third level and a loop, and leaves the thread as it was", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS })
    const before = await threads.get(id)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "b" }] }, agent)).rejects.toThrow(/two levels/)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }] }, agent)).rejects.toThrow(/two levels/)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A", parent: "a" }] }, agent)).rejects.toThrow(/two levels/)
    expect(await threads.get(id)).toEqual(before)
  })

  it("counts a paper in a subgroup as in its parent: never both", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: [{ id: "a", name: "A" }, { id: "a1", name: "A1", parent: "a" }], rows: [{ id: "doi-10.1145-1", groups: ["a", "a1"] }] })
    expect((await threads.get(id)).rows[0]?.in).toEqual({ topic: ["a1"] })
  })

  it("keeps two levels when the user merges a parent into a subgroup", async () => {
    const { threads } = setup()
    const groups = [{ id: "a", name: "A" }, { id: "a1", name: "A1", parent: "a" }, { id: "b", name: "B" }, { id: "b1", name: "B1", parent: "b" }]
    const { id } = await start(threads, { groups, rows: [{ id: "doi-10.1145-1", group: "b1" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "b", into: "a1" }, window)
    const shown = shownThread(await threads.get(id))
    expect(shown.columns.at(-1)?.groups).toEqual([{ id: "a", name: "A" }, { id: "a1", name: "A1", parent: "a" }, { id: "b1", name: "B1", parent: "a" }])
  })
})

describe("Threads, a paper in several groups", () => {
  it("adds a paper to one more group, takes it out of one, and moves it out of the one it was opened in", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }] })
    await threads.edit(id, { op: "place", column: "topic", row: "doi-10.1145-1", group: "b", in: true }, window)
    expect(inGroups(await threads.get(id))["doi-10.1145-1"]).toEqual(["a", "b"])
    // From its row under b, to c: it stays in a
    await threads.edit(id, { op: "move", column: "topic", row: "doi-10.1145-1", group: "c", from: "b" }, window)
    expect(inGroups(await threads.get(id))["doi-10.1145-1"]).toEqual(["a", "c"])
    await threads.edit(id, { op: "place", column: "topic", row: "doi-10.1145-1", group: "a", in: false }, window)
    expect(inGroups(await threads.get(id))["doi-10.1145-1"]).toEqual(["c"])
    // Owlit writing it into a and b again doesn't bring it back to either: the user took it out of both
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }] }, agent)
    expect(inGroups(await threads.get(id))["doi-10.1145-1"]).toEqual(["c"])
    // Undo of a change puts the user's earlier placements of the paper back
    await threads.edit(id, { op: "unplace", column: "topic", row: "doi-10.1145-1", placed: { a: null, b: null, c: null } }, window)
    expect(inGroups(await threads.get(id))["doi-10.1145-1"]).toEqual(["a", "b"])
  })

  it("merges a group into one the paper is in already: then it is in that one only; Undo splits them again", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }, { id: "doi-10.1145-2", group: "a" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "a", into: "b" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["b"] })
    await threads.edit(id, { op: "unmerge", column: "topic", group: "a" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["a", "b"], "doi-10.1145-2": ["a"] })
  })

  it("ungroups: each paper leaves the group, and one in no other group is in none", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }, { id: "doi-10.1145-2", group: "a" }] })
    await threads.edit(id, { op: "ungroup", column: "topic", group: "a" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [] })
  })

  it("makes a group a thread of its own: papers only there move, papers also in another group are copied", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }, { id: "doi-10.1145-2", group: "a" }] })
    const split = await threads.split(id, ["doi-10.1145-1", "doi-10.1145-2"], "Replay", { column: "topic", id: "a" }, window)
    expect(split.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(split.splitFrom).toMatchObject({ group: { column: "topic", id: "a" }, copied: ["doi-10.1145-1"] })
    const from = await threads.get(id)
    expect(inGroups(from)).toEqual({ "doi-10.1145-1": ["b"] })
    expect(shownThread(from).columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["b", "c"])
    // Undo: the moved paper and the group come back, the copied one is there once
    const back = await threads.unsplit(split.id, window)
    expect(inGroups(back)).toEqual({ "doi-10.1145-1": ["a", "b"], "doi-10.1145-2": ["a"] })
  })
})

describe("Threads, several groupings", () => {
  it("starts a new grouping from a chat's write, and finds it again by the same words", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, newGrouping: "按方法", groups: [{ id: "m1", name: "回放" }], rows: [{ id: "doi-10.1145-1", group: "m1" }] }, agent)
    await threads.write({ id, newGrouping: "按方法", rows: [{ id: "doi-10.1145-2", group: "m1" }] }, agent)
    const c = await threads.get(id)
    const groupings = c.columns.filter((col) => col.kind === "grouping")
    expect(groupings).toEqual([{ id: expect.any(String), question: "按方法", kind: "grouping", hidden: true, groups: [{ id: "m1", name: "回放" }] }])
    expect(c.rows.map((r) => r.in)).toEqual([{ [groupings[0]!.id]: ["m1"] }, { [groupings[0]!.id]: ["m1"] }])
  })

  it("remembers what the table is grouped by without a dot, a line in the history or a new date", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    const before = await threads.get(id)
    await threads.edit(id, { op: "view", groupBy: "grouping:topic" }, window)
    const c = await threads.get(id)
    expect(c.overrides.view).toEqual({ groupBy: "grouping:topic" })
    expect(c.updatedAt).toBe(before.updatedAt)
    expect((await threads.history(id)).some((l) => l.items.includes("view"))).toBe(false)
  })
})

describe("Threads kept before groupings", () => {
  it("upgrades a version 1 thread once: its groups become a hidden Topic grouping", async () => {
    const { owlit, threads } = setup()
    const v1 = {
      version: 1,
      id: "old",
      title: "Old",
      asked: { text: "Old?", at: 1 },
      project: "",
      sources: [],
      memo: [{ id: "s1", text: "See [Evaluation](owlit://threads/old#group=eval)." }],
      columns: [{ id: "q", question: "Old?", kind: "ask" }],
      rows: [
        { id: "doi-10.1145-1", paper: papers["doi-10.1145-1"], cells: {}, group: "eval", addedAt: 1 },
        { id: "doi-10.1145-2", paper: papers["doi-10.1145-2"], cells: {}, addedAt: 1 },
      ],
      groups: [{ id: "eval", name: "Evaluation" }, { id: "rep", name: "Replay", parent: "eval" }],
      createdAt: 1,
      updatedAt: 1,
      overrides: { edits: { "group:eval": { text: "Evaluating", at: 2, was: "Evaluation" } }, removed: {} },
    }
    mkdirSync(path.join(owlit, "threads", "old"), { recursive: true })
    writeFileSync(path.join(owlit, "threads", "old", "thread.json"), JSON.stringify(v1))
    const c = await threads.get("old")
    expect(c.version).toBe(2)
    expect(c.columns.at(-1)).toEqual({ id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: v1.groups })
    expect(c.rows.map((r) => r.in)).toEqual([{ topic: ["eval"] }, undefined])
    expect(c.overrides.edits).toEqual({ "group:topic:eval": { text: "Evaluating", at: 2, was: "Evaluation" } })
    // A short list stays one: only the question's own column is shown
    expect((await threads.list())[0]?.columns).toBe(0)
    // And on disk, once nothing else is writing
    await threads.edit("old", { op: "view", groupBy: "none" }, window)
    expect(JSON.parse(readFileSync(path.join(owlit, "threads", "old", "thread.json"), "utf8")).version).toBe(2)
  })
})

describe("Threads, a close question", () => {
  it("keeps a later question with the thread and says which rows were added for it", async () => {
    const { threads, wrote } = setup()
    const { id } = await start(threads)
    await threads.write({ id, asked: "回放评价和当场评价，偏差方向有没有研究？", rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower in retrospect.", depth: "abstract" } } }], chatId: "chat-2" }, agent)
    expect((await threads.get(id)).alsoAsked).toMatchObject([{ text: "回放评价和当场评价，偏差方向有没有研究？", chatId: "chat-2" }])
    expect(wrote.at(-1)).toMatchObject({ change: { action: "create", target: { kind: "thread", path: id, part: "alsoAsked" } }, thread: { rows: ["doi-10.1145-3"], asked: "回放评价和当场评价，偏差方向有没有研究？" } })
  })

  it("keeps it separate: the added rows become a thread of their own", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, asked: "偏差方向？", groups: [{ id: "g", name: "G" }], columns: [{ id: "m", question: "Method" }], rows: [{ id: "doi-10.1145-3", group: "g", cells: { q: { text: "Lower.", depth: "abstract" }, m: { text: "Survey", depth: "abstract" } } }] }, agent)
    const split = await threads.split(id, ["doi-10.1145-3"], "偏差方向？", undefined, window)
    expect(split).toMatchObject({ title: "偏差方向？", asked: { text: "偏差方向？" }, project: "主动提醒研究" })
    expect(split.rows).toEqual([expect.objectContaining({ id: "doi-10.1145-3", cells: { q: expect.objectContaining({ text: "Lower." }) } })])
    expect(split.rows[0]?.in).toBeUndefined()
    const from = await threads.get(id)
    expect(from.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(from.alsoAsked).toEqual([])
  })

  it("puts kept-apart rows back as they were, with the user's rewrite, and the new thread in the trash", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, asked: "偏差方向？", groups: [{ id: "g", name: "G" }], columns: [{ id: "m", question: "Method" }], rows: [{ id: "doi-10.1145-3", group: "g", cells: { q: { text: "Lower.", depth: "abstract" }, m: { text: "Survey", depth: "abstract" } } }] }, agent)
    const split = await threads.split(id, ["doi-10.1145-3"], "偏差方向？", undefined, window)
    await threads.edit(split.id, { op: "rewrite", item: itemId.cell("doi-10.1145-3", "q"), text: "Lower, by a third." }, window)
    const back = await threads.unsplit(split.id, window)
    expect(back.id).toBe(id)
    const row = back.rows.find((r) => r.id === "doi-10.1145-3")!
    expect(row).toMatchObject({ in: { topic: ["g"] }, cells: { m: expect.objectContaining({ text: "Survey" }) } })
    expect(shownThread(back).rows.find((r) => r.id === "doi-10.1145-3")?.cells.q?.text).toBe("Lower, by a third.")
    expect(back.alsoAsked?.map((a) => a.text)).toEqual(["偏差方向？"])
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
    await expect(threads.unsplit(id, window)).rejects.toThrow(/wasn't kept separate/)
  })
})

describe("Threads, the user's side", () => {
  it("renames, and a rename back to Owlit's words drops the edit", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rename", title: "Replay as a method" }, window)
    expect((await threads.list())[0]?.title).toBe("Replay as a method")
    await threads.edit(id, { op: "rename", title: "回放式标注作为研究方法" }, window)
    expect((await threads.get(id)).overrides.edits).toEqual({})
  })

  it("gives a row Owlit added a dot, and none to the user's own changes", async () => {
    const { threads, seen, dots } = setup()
    const { id } = await start(threads)
    await seen.mark(ME, { kind: "thread", id, items: [] })
    await threads.edit(id, { op: "rename", title: "Replay as a method" }, window)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3" }] }, agent)
    expect(await dots(id)).toEqual([itemId.row("doi-10.1145-3")])
    // A later look at the thread as a whole doesn't cover a row that was never on screen
    await seen.mark(ME, { kind: "thread", id, items: [itemId.title()] })
    expect(await dots(id)).toEqual([itemId.row("doi-10.1145-3")])
  })

  it("deletes to the trash and puts it back", async () => {
    const { threads, owlit, events } = setup()
    const { id } = await start(threads)
    await threads.delete(id, window)
    expect(await threads.list()).toEqual([])
    expect(readdirSync(path.join(owlit, "trash"))[0]).toMatch(new RegExp(`-thread-${id}$`))
    await threads.undelete(id, window)
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
    expect(events.slice(-2)).toEqual([
      { id, gone: true },
      { id, gone: false },
    ])
  })
})

// What changes/undo.ts does with a thread's entry
const undo = (threads: Threads, e: Change) => {
  const extra = { undoes: e.id }
  return e.target.part ? threads.setItem(e.target.path, e.target.part, e.before, e.after, window, extra) : threads.undoWhole(e, window, extra)
}
// One write's entries, newest first, as the result card undoes them
const writeOf = async (changes: ChangeLog, id: string, chatId: string) => {
  const mine = (await changes.list({ path: id, chatId })).filter((c) => !c.undoes)
  return mine.filter((c) => c.origin.writeId === mine[0]!.origin.writeId)
}

describe("Threads, undo", () => {
  it("takes back an agent's write item by item, keeping what the user and a later write did since", async () => {
    const { threads, changes, wrote } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower.", depth: "abstract" } } }], chatId: "chat-2" }, agent)
    await threads.edit(id, { op: "rename", title: "Replay as a method" }, window)
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower by 0.6, from the abstract.", depth: "abstract" } } }], chatId: "chat-3" }, agent)
    const second = await writeOf(changes, id, "chat-2")
    // One entry per item the write changed, both sides inline, one writeId, said once
    expect(second.map((c) => [c.actor, c.action, c.target.part])).toEqual([
      ["o_1234abcd", "create", "cell:doi-10.1145-3:q"],
      ["o_1234abcd", "create", "row:doi-10.1145-3"],
    ])
    expect(second[1]!.after).toMatchObject({ value: { id: "doi-10.1145-3", paper: papers["doi-10.1145-3"] } })
    expect(wrote.filter((n) => n.change.origin.chatId === "chat-2")).toHaveLength(1)
    const undos = []
    for (const e of second) undos.push(await undo(threads, e))
    let c = await threads.get(id)
    expect(c.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(c.rows[0]!.cells.q?.text).toBe("Lower by 0.6, from the abstract.")
    expect(shownThread(c).title).toBe("Replay as a method")
    // Redo: the undos undone, newest first, bring the row back with its answer
    for (const u of undos.reverse()) await undo(threads, u)
    c = await threads.get(id)
    expect(c.rows.map((r) => [r.id, r.cells.q?.text])).toEqual([
      ["doi-10.1145-1", "Lower by 0.6, from the abstract."],
      ["doi-10.1145-2", "Own explanations recover more."],
      ["doi-10.1145-3", "Lower."],
    ])
  })

  it("leaves an item the user changed since", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower.", depth: "abstract" } } }], chatId: "chat-2" }, agent)
    await threads.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-3", "q"), text: "Lower, I think." }, window)
    const [cell] = await writeOf(changes, id, "chat-2")
    await expect(undo(threads, cell!)).rejects.toThrow("That changed in the thread since, so owlit left it as it is.")
    expect((await threads.get(id)).rows.map((r) => r.id)).toContain("doi-10.1145-3")
  })

  it("puts a thread an agent started into the trash, and back", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    const [first, ...rest] = (await changes.list({ path: id })).reverse()
    expect(first).toMatchObject({ action: "create", target: { kind: "thread", path: id } })
    expect(rest).toEqual([])
    const undone = await undo(threads, first!)
    expect(undone).toMatchObject({ actor: "p_1234abcd", action: "delete", undoes: first!.id })
    expect(await threads.list()).toEqual([])
    await undo(threads, undone)
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
  })
})

describe("Threads.paperOf", () => {
  it("knows a row by the paper it is, whatever id named it", async () => {
    // The search named the paper by its arXiv id; the library keeps it under its DOI
    const library: Record<string, string> = { "arxiv-2310.00001": "doi-10.1145-9", "doi-10.1145-9": "doi-10.1145-9" }
    const { threads } = setup({
      paper: async (id) => (id === "arxiv-2310.00001" ? { title: "Replay ratings", authors: ["Oh"], ids: { arxiv: "2310.00001" } } : papers[id]),
      canonical: async (id) => library[id],
    })
    const { id } = await threads.write({ asked: "Do replay ratings hold?", title: "Replay", rows: [{ id: "arxiv-2310.00001", cells: { q: { text: "Lower.", depth: "abstract" } } }] }, agent)
    expect((await threads.paperOf("doi-10.1145-9"))?.title).toBe("Replay ratings")
    // Named by its library id, the answer goes to the row there
    await threads.write({ id, rows: [{ id: "doi-10.1145-9", cells: { q: { text: "Lower, by 0.6.", depth: "abstract" } } }] }, agent)
    const c = await threads.get(id)
    expect(c.rows.map((r) => [r.id, r.cells.q?.text])).toEqual([["arxiv-2310.00001", "Lower, by 0.6."]])
  })

  it("finds a paper a thread keeps, whatever thread it is in", async () => {
    const { threads } = setup()
    await start(threads)
    expect((await threads.paperOf("doi-10.1145-2"))?.title).toBe(papers["doi-10.1145-2"]!.title)
    expect(await threads.paperOf("doi-10.1145-9")).toBeUndefined()
  })
})

describe("uniqueId", () => {
  it("names a thread from its Latin words, or at random when there are too few", () => {
    expect(uniqueId("UIST 2026 papers", [])).toBe("uist-2026-papers")
    expect(uniqueId("UIST 2026 papers", ["uist-2026-papers"])).toBe("uist-2026-papers-2")
    expect(uniqueId("回放式标注作为研究方法", [])).toMatch(/^t-[0-9a-f]{6}$/)
    expect(uniqueId("成人 ADHD 在任务被打断后怎么重新进入？", [])).toMatch(/^t-[0-9a-f]{6}$/)
    expect(uniqueId("Café ratings", [])).toBe("cafe-ratings")
  })
})

describe("Threads, Owlit's work in the background", () => {
  function withRuns(services: ThreadsServices = {}) {
    const prompts: { prompt: string; allow: string }[] = []
    // What the run and a chat searched, as the Library logs it
    const searched: { by: string; at: number; query: string; source: string; results: string[] }[] = []
    const ctx = setup({
      searches: async (by, since) => searched.filter((s) => s.by === by && s.at > since),
      // The agent writes the way it would through owlit-mcp: a row and a title on the first write
      agent: async (prompt, _signal, allow, run) => {
        prompts.push({ prompt, allow: allow.source })
        const id = /thread_write,? id ([\w-]+)/.exec(prompt)?.[1]
        searched.push(
          { by: `run:${run}`, at: Date.now(), query: "replay ratings validity", source: "openalex", results: ["doi-10.1145-1", "doi-10.1145-9"] },
          { by: `run:${run}`, at: Date.now(), query: "cited_by of doi-10.1145-1", source: "openalex", results: ["doi-10.1145-8"] },
        )
        // Grouping: the groups first, then every paper in one, as the prompt says
        const grouping = /The grouping: ([\w-]+)/.exec(prompt)?.[1]
        if (id && grouping) {
          await ctx.threads.write({ id, grouping, groups: [{ id: "ch1", name: "Chapter 1" }, { id: "ch2", name: "Chapter 2" }], run }, agent)
          await ctx.threads.write({ id, grouping, rows: [{ id: "doi-10.1145-1", group: "ch1" }, { id: "doi-10.1145-2", group: "ch2" }], run }, agent)
        }
        if (id && prompt.includes("gathering"))
          await ctx.threads.write({ id, title: "Replay ratings", rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }], note: "Semantic Scholar wasn't reachable.", run }, agent)
        return { text: "Gathered one paper." }
      },
      ...services,
    })
    const scheduler = new Scheduler({ store: new TaskStore(mkdtempSync(path.join(tmpdir(), "owlit-tasks-"))), definitions: ctx.threads.tasks(), retryDelay: () => 5 })
    ctx.threads.attach(scheduler)
    void scheduler.start()
    return { ...ctx, scheduler, prompts, searched }
  }

  it("tells its batches apart for About: the run's searches and note, then a chat's later question", async () => {
    const { threads, scheduler, searched } = withRuns()
    const c = await threads.gather({ question: "回放评价可靠吗？", size: "few" }, window)
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === c.id)!.id)
    searched.push({ by: "chat:c9", at: Date.now(), query: "lifelog video recall", source: "arxiv", results: ["doi-10.1145-2"] })
    await threads.write({ id: c.id, asked: "Does lifelog video help recall?", rows: [{ id: "doi-10.1145-2", cells: { q: { text: "It helps.", depth: "abstract" } } }], chatId: "c9" }, agent)

    const [gathered, chat, ...rest] = await threads.about(c.id)
    expect(rest).toEqual([])
    expect(gathered).toMatchObject({ trigger: "gather", added: 1, answered: 0, notes: ["Semantic Scholar wasn't reachable."] })
    expect(gathered!.searches).toEqual([
      { kind: "search", query: "replay ratings validity", source: "openalex", found: 2, kept: 1 },
      { kind: "cited_by", query: "doi-10.1145-1", of: "Replay or Live? Validity of Retrospective Ratings", source: "openalex", found: 1, kept: 0 },
    ])
    expect(chat).toMatchObject({ trigger: "chat", chatId: "c9", asked: "Does lifelog video help recall?", added: 1, searches: [{ query: "lifelog video recall", kept: 1 }] })
  })

  it("starts a thread at once and fills it in the background", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const c = await threads.gather({ question: "回放评价可靠吗？", project: "主动提醒研究", size: "few" }, window)
    expect(c).toMatchObject({ title: "回放评价可靠吗？", project: "主动提醒研究", size: "few", rows: [] })
    const task = Object.values(await scheduler.list()).find((t) => t.subject === c.id)!
    expect(task.kind).toBe("threads.gather")
    expect((await scheduler.wait(task.id)).state).toBe("done")
    const now = await threads.get(c.id)
    expect(now.title).toBe("Replay ratings")
    expect(now.rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
    expect(prompts[0]?.prompt).toMatch(/about ten papers/)
    expect(prompts[0]?.allow).toMatch(/library_\(search\|related\|journal\)/)
  })

  it("asks for answers from the full text from the start for the rows whose text owlit has", async () => {
    const { threads, scheduler, prompts } = withRuns({ hasText: async (id) => id === "doi-10.1145-2" })
    const { id } = await start(threads)
    const column = (await threads.ask(id, "Method and sample", window)).columns.at(-1)!
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!.id)
    expect(prompts[0]?.prompt).toMatch(/full text in the user's library: doi-10\.1145-2\. Answer them from it/)
    expect(prompts[0]?.prompt).not.toMatch(/doi-10\.1145-1/)
  })

  it("adds a column and asks the agent to fill it, with only thread_write besides reading", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const { id } = await start(threads)
    const c = await threads.ask(id, "Method and sample", window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ question: "Method and sample", kind: "ask" })
    const task = (await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!
    expect(task.kind).toBe("threads.fill")
    await scheduler.wait(task.id)
    expect(prompts[0]?.prompt).toMatch(new RegExp(`The column to fill: ${column.id} — «Method and sample»`))
    expect(prompts[0]?.allow).not.toMatch(/library_add/)
    // Asking the same again fills the same column
    expect((await threads.ask(id, "Method  and sample", window)).columns).toHaveLength(2)
  })

  it("sets every paper against the user's sentences, in a column the agent fills", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const { id } = await start(threads)
    const c = await threads.compare(id, "System Design.md", ["Replay ratings run lower.", "Timing is one stage of four."], window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "compare", doc: "System Design.md", sentences: [{ id: "l1" }, { id: "l2" }] })
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!.id)
    expect(prompts[0]?.prompt).toMatch(/- l2: «Timing is one stage of four\.»/)
    await threads.edit(id, { op: "hide", column: column.id, hidden: true }, window)
    expect((await threads.get(id)).columns.find((col) => col.id === column.id)?.hidden).toBe(true)
  })

  it("groups the papers another way: a hidden grouping the agent fills, groups first; asked again, the user's moves stay", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const { id } = await start(threads, { groups: [{ id: "a", name: "A" }], rows: [{ id: "doi-10.1145-1", group: "a" }] })
    const c = await threads.group(id, "the chapters of my story", window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "grouping", question: "the chapters of my story", hidden: true, groups: [] })
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!.id)
    expect(prompts[0]?.prompt).toMatch(/by «the chapters of my story»/)
    expect(prompts[0]?.prompt).not.toMatch(/afresh/)
    let now = shownThread(await threads.get(id))
    expect(now.columns.find((col) => col.id === column.id)?.groups?.map((g) => g.id)).toEqual(["ch1", "ch2"])
    expect(now.rows.map((r) => r.in)).toEqual([
      { topic: ["a"], [column.id]: ["ch1"] },
      { [column.id]: ["ch2"] },
    ])
    // The user moves a paper in the new grouping, then asks for it again: the move stays
    await threads.edit(id, { op: "move", column: column.id, row: "doi-10.1145-1", group: "ch2", from: "ch1" }, window)
    await scheduler.wait((await threads.fill(id, column.id)).id)
    expect(prompts.at(-1)?.prompt).toMatch(/afresh/)
    now = shownThread(await threads.get(id))
    expect(now.rows.map((r) => r.in?.[column.id])).toEqual([["ch2"], ["ch2"]])
    // The same words again are the same grouping
    expect((await threads.group(id, "the chapters  of my story", window)).columns.filter((col) => col.kind === "grouping")).toHaveLength(2)
  })
})

describe("Threads, the user's changes in the log", () => {
  it("records each item the user changed, with both sides, and no line in the history", async () => {
    const { threads, changes, owlit } = setup()
    const { id } = await start(threads)
    const lines = (await threads.history(id)).length
    await threads.edit(id, { op: "remove", item: itemId.row("doi-10.1145-2") }, window)
    await threads.edit(id, { op: "rewrite", item: itemId.memo("s1"), text: "Kelly 2015 is the closest." }, window)
    await threads.edit(id, { op: "project", project: "Thesis" }, window)
    // How the user looks changes nothing worth an entry
    await threads.edit(id, { op: "view", groupBy: "none" }, window)
    const mine = (await changes.list({ path: id, actor: "p_1234abcd" })).reverse()
    expect(mine.map((c) => [c.action, c.target.part, c.origin.via])).toEqual([
      ["update", "row:doi-10.1145-2", "editor"],
      ["update", "memo:s1", "editor"],
      ["update", "project", "editor"],
    ])
    expect(mine[0]!.before).toEqual({ value: expect.objectContaining({ id: "doi-10.1145-2" }) })
    expect(mine[0]!.after).toMatchObject({ value: { id: "doi-10.1145-2" }, removed: { text: papers["doi-10.1145-2"]!.title } })
    expect(mine[1]!.after).toMatchObject({ edit: { text: "Kelly 2015 is the closest." } })
    expect(mine[2]).toMatchObject({ before: { value: "主动提醒研究" }, after: { value: "Thesis" } })
    expect(await threads.history(id)).toHaveLength(lines)
    // What the user did is kept as the thread's overrides
    const kept = JSON.parse(readFileSync(path.join(owlit, "threads", id, "thread.json"), "utf8"))
    expect(Object.keys(kept.overrides.removed)).toEqual([itemId.row("doi-10.1145-2")])
    expect(kept.yours).toBeUndefined()
  })

  it("gives the entries of one change a shared writeId: a split's new thread and the rows it took", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    const split = await threads.split(id, ["doi-10.1145-2"], "Lifelogs", undefined, window)
    const made = (await changes.list({ path: split.id }))[0]!
    const left = (await changes.list({ path: id, actor: "p_1234abcd" }))[0]!
    expect(made).toMatchObject({ action: "create", target: { kind: "thread", path: split.id } })
    expect(left).toMatchObject({ action: "delete", target: { part: "row:doi-10.1145-2" }, before: { value: { id: "doi-10.1145-2" } } })
    expect(left.origin.writeId).toBe(made.origin.writeId)
  })
})
