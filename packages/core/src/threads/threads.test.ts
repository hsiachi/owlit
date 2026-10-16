import { itemId, placedKey, shownThread, type Thread, type ThreadPaper } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Versions } from "../docs/versions.ts"
import { Scheduler, TaskStore } from "../tasks/index.ts"
import { Threads, uniqueId, type ThreadsServices } from "./threads.ts"

const papers: Record<string, ThreadPaper> = {
  "doi-10.1145-1": { title: "Replay or Live? Validity of Retrospective Ratings", authors: ["Fernández", "Oh"], ids: { doi: "10.1145/1" }, year: 2026 },
  "doi-10.1145-2": { title: "Retrospective think-aloud with lifelog video", authors: ["Kelly"], ids: { doi: "10.1145/2" }, year: 2015 },
  "doi-10.1145-3": { title: "Experience sampling versus retrospective recall", authors: ["van Berkel"], ids: { doi: "10.1145/3" }, year: 2017 },
}

function setup(services: ThreadsServices = {}) {
  const owlit = mkdtempSync(path.join(tmpdir(), "owlit-threads-"))
  const versions = new Versions(owlit)
  const events: { id: string; gone: boolean }[] = []
  const wrote: unknown[] = []
  const threads = new Threads(
    owlit,
    { versions },
    {
      paper: async (id) => papers[id],
      changed: (id, c) => events.push({ id, gone: !c }),
      wrote: (w) => wrote.push(w),
      ...services,
    },
  )
  return { owlit, versions, threads, events, wrote }
}

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
  })

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
    // Nothing in a new thread is marked as changed: the whole thing is new
    expect(c.changedAt).toEqual({})
    expect(wrote).toMatchObject([{ id: out.id, label: "回放式标注作为研究方法", chatId: "chat-1", created: true, rows: ["doi-10.1145-1", "doi-10.1145-2"] }])
  })

  it("refuses a paper it can't look up, and a new thread without its question or title", async () => {
    const { threads } = setup()
    await expect(threads.write({ title: "x" })).rejects.toThrow(/asked/)
    await expect(start(threads, { rows: [{ id: "doi-10.9999-x" }] })).rejects.toThrow(/doesn't know the paper doi-10.9999-x/)
  })

  it("adds to a thread, marking only what changed once the user has looked", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3" }] })
    expect((await threads.get(id)).changedAt).toEqual({})
    await threads.edit(id, { op: "seen" })
    const out = await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Retrospective answers run lower.", depth: "abstract" } } }, { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "abstract" } } }] })
    expect(out).toMatchObject({ added: 0, updated: 1 })
    const c = await threads.get(id)
    expect(Object.keys(c.changedAt)).toEqual([itemId.cell("doi-10.1145-3", "q")])
  })

  it("keeps the user's rewrite of a cell through Owlit's later answers, without a dot", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "seen" })
    await threads.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-2", "q"), text: "Lifelog replay beats diaries." })
    await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "Explanations from replay are more complete.", depth: "full", passage: { quote: "more complete", page: 12 } } } }] })
    const c = await threads.get(id)
    const shown = shownThread(c)
    expect(shown.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Lifelog replay beats diaries.")
    expect(c.yours.edits[itemId.cell("doi-10.1145-2", "q")]?.was).toBe("Own explanations recover more.")
    expect(c.changedAt[itemId.cell("doi-10.1145-2", "q")]).toBeUndefined()
    // Owlit's own answer is still there underneath
    expect(c.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Explanations from replay are more complete.")
  })

  it("never brings back a row the user removed", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "remove", item: itemId.row("doi-10.1145-2") })
    const out = await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "again", depth: "abstract" } } }] })
    expect(out.left).toEqual(["doi-10.1145-2"])
    expect(shownThread(await threads.get(id)).rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
  })

  it("keeps a memo sentence the user rewrote even when Owlit drops it, and keeps removed words out", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rewrite", item: itemId.memo("s1"), text: "ProAgent and Kelly 2015 are the closest precedents." })
    await threads.edit(id, { op: "remove", item: itemId.memo("s2") })
    await threads.write({ id, memo: [{ text: "Replay ratings run lower than live ones." }, { text: "Nothing compares replay with live reminders." }] })
    const shown = shownThread(await threads.get(id))
    expect(shown.memo.map((s) => s.text)).toEqual(["ProAgent and Kelly 2015 are the closest precedents.", "Nothing compares replay with live reminders."])
  })

  it("groups rows in a hidden Topic grouping, and refuses a group that isn't there", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await expect(threads.write({ id, rows: [{ id: "doi-10.1145-1", group: "eval" }] })).rejects.toThrow(/group eval/)
    await threads.write({ id, groups: [{ id: "eval", name: "Evaluating proactive systems" }], rows: [{ id: "doi-10.1145-1", group: "eval" }] })
    const c = await threads.get(id)
    expect(c.columns.at(-1)).toEqual({ id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: [{ id: "eval", name: "Evaluating proactive systems" }] })
    expect(c.rows[0]?.in).toEqual({ topic: ["eval"] })
    await threads.edit(id, { op: "ungroup", column: "topic", group: "eval" })
    const shown = shownThread(await threads.get(id))
    expect(shown.columns.at(-1)?.groups).toEqual([])
    expect(shown.rows[0]?.in).toBeUndefined()
  })

  it("adds a column once, however often it is asked", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, columns: [{ question: "Method and sample" }] })
    await threads.write({ id, columns: [{ question: "Method  and sample" }] })
    expect((await threads.get(id)).columns.map((c) => c.question)).toEqual(["我的研究方法该怎么设计？", "Method and sample"])
    await expect(threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { nope: { text: "x", depth: "abstract" } } }] })).rejects.toThrow(/no column nope/)
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
    await threads.edit(id, { op: "move", column: "topic", row: "doi-10.1145-1", group: "b" })
    expect((await threads.get(id)).yours.placed).toMatchObject({ [placedKey("topic", "doi-10.1145-1", "a")]: { in: false }, [placedKey("topic", "doi-10.1145-1", "b")]: { in: true } })
    // Owlit writes the whole grouping again, with the paper back in its old group
    await threads.write({ id, groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] })
    // The paper the user didn't touch is Owlit's to move
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["c"] })
    // A group the user put a paper in stays when Owlit leaves it out
    await threads.write({ id, groups: [GROUPS[0]!, GROUPS[2]!] })
    const c = await threads.get(id)
    expect(shownThread(c).columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["a", "b", "c"])
    expect(inGroups(c)).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["c"] })
  })

  it("keeps merged and ungrouped groups so, and says so to the agent", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "a", into: "b" })
    await threads.edit(id, { op: "ungroup", column: "topic", group: "c" })
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [] })
    const out = await threads.write({ id, groups: GROUPS, rows: [{ id: "doi-10.1145-3", group: "a" }, { id: "doi-10.1145-2", group: "c" }] })
    expect(out.userKept).toEqual([expect.stringMatching(/merged group a .* into b/), expect.stringMatching(/ungrouped c/), expect.stringMatching(/doi-10.1145-2 isn't in c/)])
    const c = await threads.get(id)
    expect(shownThread(c).columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["b"])
    expect(inGroups(c)).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [], "doi-10.1145-3": ["b"] })
    // Undoing the ungroup brings the group and Owlit's papers in it back
    await threads.edit(id, { op: "unremove", item: itemId.group("topic", "c") })
    expect(inGroups(await threads.get(id))["doi-10.1145-2"]).toEqual(["c"])
  })

  it("keeps the user's name for a group through Owlit's rewrites", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS })
    await threads.edit(id, { op: "rewrite", item: itemId.group("topic", "a"), text: "Watching it again" })
    await threads.write({ id, groups: [{ id: "a", name: "Replay studies" }] })
    expect(shownThread(await threads.get(id)).columns.at(-1)?.groups).toEqual([{ id: "a", name: "Watching it again" }])
  })

  it("refuses a third level and a loop, and leaves the thread as it was", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS })
    const before = await threads.get(id)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "b" }] })).rejects.toThrow(/two levels/)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }] })).rejects.toThrow(/two levels/)
    await expect(threads.write({ id, groups: [{ id: "a", name: "A", parent: "a" }] })).rejects.toThrow(/two levels/)
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
    await threads.edit(id, { op: "merge", column: "topic", group: "b", into: "a1" })
    const shown = shownThread(await threads.get(id))
    expect(shown.columns.at(-1)?.groups).toEqual([{ id: "a", name: "A" }, { id: "a1", name: "A1", parent: "a" }, { id: "b1", name: "B1", parent: "a" }])
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
      watch: false,
      createdAt: 1,
      updatedAt: 1,
      changedAt: { "group:eval": 5 },
      seenAt: 0,
      yours: { edits: { "group:eval": { text: "Evaluating", at: 2, was: "Evaluation" } }, removed: {} },
    }
    mkdirSync(path.join(owlit, "threads", "old"), { recursive: true })
    writeFileSync(path.join(owlit, "threads", "old", "thread.json"), JSON.stringify(v1))
    const c = await threads.get("old")
    expect(c.version).toBe(2)
    expect(c.columns.at(-1)).toEqual({ id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: v1.groups })
    expect(c.rows.map((r) => r.in)).toEqual([{ topic: ["eval"] }, undefined])
    expect(c.yours.edits).toEqual({ "group:topic:eval": { text: "Evaluating", at: 2, was: "Evaluation" } })
    expect(c.changedAt).toEqual({ "group:topic:eval": 5 })
    // A short list stays one: only the question's own column is shown
    expect((await threads.list())[0]?.columns).toBe(0)
    // And on disk, once nothing else is writing
    await threads.edit("old", { op: "seen" })
    expect(JSON.parse(readFileSync(path.join(owlit, "threads", "old", "thread.json"), "utf8")).version).toBe(2)
  })
})

describe("Threads, a close question", () => {
  it("keeps a later question with the thread and says which rows were added for it", async () => {
    const { threads, wrote } = setup()
    const { id } = await start(threads)
    await threads.write({ id, asked: "回放评价和当场评价，偏差方向有没有研究？", rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower in retrospect.", depth: "abstract" } } }], chatId: "chat-2" })
    expect((await threads.get(id)).alsoAsked).toMatchObject([{ text: "回放评价和当场评价，偏差方向有没有研究？", chatId: "chat-2" }])
    expect(wrote.at(-1)).toMatchObject({ created: false, rows: ["doi-10.1145-3"], asked: "回放评价和当场评价，偏差方向有没有研究？" })
  })

  it("keeps it separate: the added rows become a thread of their own", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, asked: "偏差方向？", groups: [{ id: "g", name: "G" }], columns: [{ id: "m", question: "Method" }], rows: [{ id: "doi-10.1145-3", group: "g", cells: { q: { text: "Lower.", depth: "abstract" }, m: { text: "Survey", depth: "abstract" } } }] })
    const split = await threads.split(id, ["doi-10.1145-3"], "偏差方向？")
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
    await threads.write({ id, asked: "偏差方向？", groups: [{ id: "g", name: "G" }], columns: [{ id: "m", question: "Method" }], rows: [{ id: "doi-10.1145-3", group: "g", cells: { q: { text: "Lower.", depth: "abstract" }, m: { text: "Survey", depth: "abstract" } } }] })
    const split = await threads.split(id, ["doi-10.1145-3"], "偏差方向？")
    await threads.edit(split.id, { op: "rewrite", item: itemId.cell("doi-10.1145-3", "q"), text: "Lower, by a third." })
    const back = await threads.unsplit(split.id)
    expect(back.id).toBe(id)
    const row = back.rows.find((r) => r.id === "doi-10.1145-3")!
    expect(row).toMatchObject({ in: { topic: ["g"] }, cells: { m: expect.objectContaining({ text: "Survey" }) } })
    expect(shownThread(back).rows.find((r) => r.id === "doi-10.1145-3")?.cells.q?.text).toBe("Lower, by a third.")
    expect(back.alsoAsked?.map((a) => a.text)).toEqual(["偏差方向？"])
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
    await expect(threads.unsplit(id)).rejects.toThrow(/wasn't kept separate/)
  })
})

describe("Threads, the user's side", () => {
  it("renames, and a rename back to Owlit's words drops the edit", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rename", title: "Replay as a method" })
    expect((await threads.list())[0]?.title).toBe("Replay as a method")
    await threads.edit(id, { op: "rename", title: "回放式标注作为研究方法" })
    expect((await threads.get(id)).yours.edits).toEqual({})
  })

  it("says in the list whether Owlit changed something since the user looked", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    // Never looked at: new
    expect((await threads.list())[0]?.fresh).toBe(true)
    await threads.edit(id, { op: "seen" })
    expect((await threads.list())[0]?.fresh).toBe(false)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3" }] })
    expect((await threads.list())[0]).toMatchObject({ fresh: true, papers: 3 })
    await threads.edit(id, { op: "seen" })
    expect((await threads.list())[0]?.fresh).toBe(false)
  })

  it("deletes to the trash and puts it back", async () => {
    const { threads, owlit, events } = setup()
    const { id } = await start(threads)
    await threads.delete(id)
    expect(await threads.list()).toEqual([])
    expect(readdirSync(path.join(owlit, "trash"))[0]).toMatch(new RegExp(`-thread-${id}$`))
    await threads.undelete(id)
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
    expect(events.slice(-2)).toEqual([
      { id, gone: true },
      { id, gone: false },
    ])
  })
})

describe("Threads, undo", () => {
  it("takes back an agent's write and keeps what the user did since", async () => {
    const { threads, versions } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower.", depth: "abstract" } } }], chatId: "chat-2" })
    await threads.edit(id, { op: "rename", title: "Replay as a method" })
    const last = (await versions.list({ path: id }))[0]!
    const v = (await versions.get(last.id))!
    await threads.restoreVersion(id, v.content, v.existed !== false, {})
    const c = await threads.get(id)
    expect(c.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(shownThread(c).title).toBe("Replay as a method")
  })

  it("puts a thread an agent started into the trash", async () => {
    const { threads, versions } = setup()
    const { id } = await start(threads)
    const first = (await versions.list({ path: id })).at(-1)!
    const v = (await versions.get(first.id))!
    expect(v.existed).toBe(false)
    const { redoId } = await threads.restoreVersion(id, v.content, false, {})
    expect(await threads.list()).toEqual([])
    const redo = (await versions.get(redoId))!
    await threads.restoreVersion(id, redo.content, redo.existed !== false, {})
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
  })
})

describe("Threads.paperOf", () => {
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
  function withRuns() {
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
        if (id && prompt.includes("gathering"))
          await ctx.threads.write({ id, title: "Replay ratings", rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }], note: "Semantic Scholar wasn't reachable.", run })
        return { text: "Gathered one paper." }
      },
    })
    const scheduler = new Scheduler({ store: new TaskStore(mkdtempSync(path.join(tmpdir(), "owlit-tasks-"))), definitions: ctx.threads.tasks(), retryDelay: () => 5 })
    ctx.threads.attach(scheduler)
    void scheduler.start()
    return { ...ctx, scheduler, prompts, searched }
  }

  it("tells its batches apart for About: the run's searches and note, then a chat's later question", async () => {
    const { threads, scheduler, searched } = withRuns()
    const c = await threads.gather({ question: "回放评价可靠吗？", size: "few" })
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === c.id)!.id)
    searched.push({ by: "chat:c9", at: Date.now(), query: "lifelog video recall", source: "arxiv", results: ["doi-10.1145-2"] })
    await threads.write({ id: c.id, asked: "Does lifelog video help recall?", rows: [{ id: "doi-10.1145-2", cells: { q: { text: "It helps.", depth: "abstract" } } }], chatId: "c9" })

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
    const c = await threads.gather({ question: "回放评价可靠吗？", project: "主动提醒研究", size: "few" })
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

  it("adds a column and asks the agent to fill it, with only thread_write besides reading", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const { id } = await start(threads)
    const c = await threads.ask(id, "Method and sample")
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ question: "Method and sample", kind: "ask" })
    const task = (await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!
    expect(task.kind).toBe("threads.fill")
    await scheduler.wait(task.id)
    expect(prompts[0]?.prompt).toMatch(new RegExp(`The column to fill: ${column.id} — «Method and sample»`))
    expect(prompts[0]?.allow).not.toMatch(/library_add/)
    // Asking the same again fills the same column
    expect((await threads.ask(id, "Method  and sample")).columns).toHaveLength(2)
  })

  it("sets every paper against the user's sentences, in a column the agent fills", async () => {
    const { threads, scheduler, prompts } = withRuns()
    const { id } = await start(threads)
    const c = await threads.compare(id, "System Design.md", ["Replay ratings run lower.", "Timing is one stage of four."])
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "compare", doc: "System Design.md", sentences: [{ id: "l1" }, { id: "l2" }] })
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!.id)
    expect(prompts[0]?.prompt).toMatch(/- l2: «Timing is one stage of four\.»/)
    await threads.edit(id, { op: "hide", column: column.id, hidden: true })
    expect((await threads.get(id)).columns.find((col) => col.id === column.id)?.hidden).toBe(true)
  })

  it("checks watched threads once a day", async () => {
    const { threads, scheduler } = withRuns()
    const { id } = await start(threads)
    await threads.edit(id, { op: "watch", on: true })
    expect(await threads.watched(Date.now())).toEqual([{ id, due: false }])
    expect(await threads.watched(Date.now() + 25 * 3_600_000)).toEqual([{ id, due: true }])
    // Owlit's rules queue it (initiative/rules.ts); the run marks the thread checked
    await scheduler.wait(scheduler.enqueue("threads.check", id, "background").id)
    expect((await threads.get(id)).checkedAt).toBeGreaterThan(0)
    expect(await threads.watched(Date.now() + 23 * 3_600_000)).toEqual([{ id, due: false }])
  })
})
