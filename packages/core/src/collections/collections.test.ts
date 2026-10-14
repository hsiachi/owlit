import { itemId, shownCollection, type CollectionPaper } from "@owlit/protocol"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Versions } from "../docs/versions.ts"
import { Scheduler, TaskStore } from "../tasks/index.ts"
import { Collections, uniqueId, type CollectionsServices } from "./collections.ts"

const papers: Record<string, CollectionPaper> = {
  "doi-10.1145-1": { title: "Replay or Live? Validity of Retrospective Ratings", authors: ["Fernández", "Oh"], ids: { doi: "10.1145/1" }, year: 2026 },
  "doi-10.1145-2": { title: "Retrospective think-aloud with lifelog video", authors: ["Kelly"], ids: { doi: "10.1145/2" }, year: 2015 },
  "doi-10.1145-3": { title: "Experience sampling versus retrospective recall", authors: ["van Berkel"], ids: { doi: "10.1145/3" }, year: 2017 },
}

function setup(services: CollectionsServices = {}) {
  const owlit = mkdtempSync(path.join(tmpdir(), "owlit-collections-"))
  const versions = new Versions(owlit)
  const events: { id: string; gone: boolean }[] = []
  const wrote: unknown[] = []
  const collections = new Collections(
    owlit,
    { versions },
    {
      paper: async (id) => papers[id],
      changed: (id, c) => events.push({ id, gone: !c }),
      wrote: (w) => wrote.push(w),
      ...services,
    },
  )
  return { owlit, versions, collections, events, wrote }
}

const start = (collections: Collections, extra: object = {}) =>
  collections.write({
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

describe("Collections.write", () => {
  it("starts a collection with the question as its first column and the papers as the search found them", async () => {
    const { collections, wrote } = setup()
    const out = await start(collections)
    expect(out).toMatchObject({ title: "回放式标注作为研究方法", added: 2, updated: 0, left: [] })
    const c = await collections.get(out.id)
    expect(c.columns).toEqual([{ id: "q", question: "我的研究方法该怎么设计？", kind: "ask" }])
    expect(c.rows.map((r) => r.paper.title)).toEqual([papers["doi-10.1145-1"]!.title, papers["doi-10.1145-2"]!.title])
    expect(c.asked).toMatchObject({ text: "我的研究方法该怎么设计？", chatId: "chat-1" })
    expect(c.memo.map((s) => s.id)).toEqual(["s1", "s2"])
    // Nothing in a new collection is marked as changed: the whole thing is new
    expect(c.changedAt).toEqual({})
    expect(wrote).toMatchObject([{ id: out.id, label: "回放式标注作为研究方法", chatId: "chat-1", created: true, rows: ["doi-10.1145-1", "doi-10.1145-2"] }])
  })

  it("refuses a paper it can't look up, and a new collection without its question or title", async () => {
    const { collections } = setup()
    await expect(collections.write({ title: "x" })).rejects.toThrow(/asked/)
    await expect(start(collections, { rows: [{ id: "doi-10.9999-x" }] })).rejects.toThrow(/doesn't know the paper doi-10.9999-x/)
  })

  it("adds to a collection, marking only what changed once the user has looked", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.write({ id, rows: [{ id: "doi-10.1145-3" }] })
    expect((await collections.get(id)).changedAt).toEqual({})
    await collections.edit(id, { op: "seen" })
    const out = await collections.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Retrospective answers run lower.", depth: "abstract" } } }, { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "abstract" } } }] })
    expect(out).toMatchObject({ added: 0, updated: 1 })
    const c = await collections.get(id)
    expect(Object.keys(c.changedAt)).toEqual([itemId.cell("doi-10.1145-3", "q")])
  })

  it("keeps the user's rewrite of a cell through Owlit's later answers, without a dot", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.edit(id, { op: "seen" })
    await collections.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-2", "q"), text: "Lifelog replay beats diaries." })
    await collections.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "Explanations from replay are more complete.", depth: "full", passage: { quote: "more complete", page: 12 } } } }] })
    const c = await collections.get(id)
    const shown = shownCollection(c)
    expect(shown.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Lifelog replay beats diaries.")
    expect(c.yours.edits[itemId.cell("doi-10.1145-2", "q")]?.was).toBe("Own explanations recover more.")
    expect(c.changedAt[itemId.cell("doi-10.1145-2", "q")]).toBeUndefined()
    // Owlit's own answer is still there underneath
    expect(c.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Explanations from replay are more complete.")
  })

  it("never brings back a row the user removed", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.edit(id, { op: "remove", item: itemId.row("doi-10.1145-2") })
    const out = await collections.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "again", depth: "abstract" } } }] })
    expect(out.left).toEqual(["doi-10.1145-2"])
    expect(shownCollection(await collections.get(id)).rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
  })

  it("keeps a memo sentence the user rewrote even when Owlit drops it, and keeps removed words out", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.edit(id, { op: "rewrite", item: itemId.memo("s1"), text: "ProAgent and Kelly 2015 are the closest precedents." })
    await collections.edit(id, { op: "remove", item: itemId.memo("s2") })
    await collections.write({ id, memo: [{ text: "Replay ratings run lower than live ones." }, { text: "Nothing compares replay with live reminders." }] })
    const shown = shownCollection(await collections.get(id))
    expect(shown.memo.map((s) => s.text)).toEqual(["ProAgent and Kelly 2015 are the closest precedents.", "Nothing compares replay with live reminders."])
  })

  it("groups rows, and refuses a group that isn't there", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await expect(collections.write({ id, rows: [{ id: "doi-10.1145-1", group: "eval" }] })).rejects.toThrow(/group eval/)
    await collections.write({ id, groups: [{ id: "eval", name: "Evaluating proactive systems" }], rows: [{ id: "doi-10.1145-1", group: "eval" }] })
    expect((await collections.get(id)).rows[0]?.group).toBe("eval")
    await collections.edit(id, { op: "ungroup", group: "eval" })
    const c = await collections.get(id)
    expect(c.groups).toEqual([])
    expect(c.rows[0]?.group).toBeUndefined()
  })

  it("adds a column once, however often it is asked", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.write({ id, columns: [{ question: "Method and sample" }] })
    await collections.write({ id, columns: [{ question: "Method  and sample" }] })
    expect((await collections.get(id)).columns.map((c) => c.question)).toEqual(["我的研究方法该怎么设计？", "Method and sample"])
    await expect(collections.write({ id, rows: [{ id: "doi-10.1145-1", cells: { nope: { text: "x", depth: "abstract" } } }] })).rejects.toThrow(/no column nope/)
  })
})

describe("Collections, a close question", () => {
  it("keeps a later question with the collection and says which rows were added for it", async () => {
    const { collections, wrote } = setup()
    const { id } = await start(collections)
    await collections.write({ id, asked: "回放评价和当场评价，偏差方向有没有研究？", rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower in retrospect.", depth: "abstract" } } }], chatId: "chat-2" })
    expect((await collections.get(id)).alsoAsked).toMatchObject([{ text: "回放评价和当场评价，偏差方向有没有研究？", chatId: "chat-2" }])
    expect(wrote.at(-1)).toMatchObject({ created: false, rows: ["doi-10.1145-3"], asked: "回放评价和当场评价，偏差方向有没有研究？" })
  })

  it("keeps it separate: the added rows become a collection of their own", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.write({ id, asked: "偏差方向？", groups: [{ id: "g", name: "G" }], columns: [{ id: "m", question: "Method" }], rows: [{ id: "doi-10.1145-3", group: "g", cells: { q: { text: "Lower.", depth: "abstract" }, m: { text: "Survey", depth: "abstract" } } }] })
    const split = await collections.split(id, ["doi-10.1145-3"], "偏差方向？")
    expect(split).toMatchObject({ title: "偏差方向？", asked: { text: "偏差方向？" }, project: "主动提醒研究" })
    expect(split.rows).toEqual([expect.objectContaining({ id: "doi-10.1145-3", cells: { q: expect.objectContaining({ text: "Lower." }) } })])
    expect(split.rows[0]?.group).toBeUndefined()
    const from = await collections.get(id)
    expect(from.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(from.alsoAsked).toEqual([])
  })
})

describe("Collections, the user's side", () => {
  it("renames, and a rename back to Owlit's words drops the edit", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    await collections.edit(id, { op: "rename", title: "Replay as a method" })
    expect((await collections.list())[0]?.title).toBe("Replay as a method")
    await collections.edit(id, { op: "rename", title: "回放式标注作为研究方法" })
    expect((await collections.get(id)).yours.edits).toEqual({})
  })

  it("says in the list whether Owlit changed something since the user looked", async () => {
    const { collections } = setup()
    const { id } = await start(collections)
    // Never looked at: new
    expect((await collections.list())[0]?.fresh).toBe(true)
    await collections.edit(id, { op: "seen" })
    expect((await collections.list())[0]?.fresh).toBe(false)
    await collections.write({ id, rows: [{ id: "doi-10.1145-3" }] })
    expect((await collections.list())[0]).toMatchObject({ fresh: true, papers: 3 })
    await collections.edit(id, { op: "seen" })
    expect((await collections.list())[0]?.fresh).toBe(false)
  })

  it("deletes to the trash and puts it back", async () => {
    const { collections, owlit, events } = setup()
    const { id } = await start(collections)
    await collections.delete(id)
    expect(await collections.list()).toEqual([])
    expect(readdirSync(path.join(owlit, "trash"))[0]).toMatch(new RegExp(`-collection-${id}$`))
    await collections.undelete(id)
    expect((await collections.list()).map((c) => c.id)).toEqual([id])
    expect(events.slice(-2)).toEqual([
      { id, gone: true },
      { id, gone: false },
    ])
  })
})

describe("Collections, undo", () => {
  it("takes back an agent's write and keeps what the user did since", async () => {
    const { collections, versions } = setup()
    const { id } = await start(collections)
    await collections.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower.", depth: "abstract" } } }], chatId: "chat-2" })
    await collections.edit(id, { op: "rename", title: "Replay as a method" })
    const last = (await versions.list({ path: id }))[0]!
    const v = (await versions.get(last.id))!
    await collections.restoreVersion(id, v.content, v.existed !== false, {})
    const c = await collections.get(id)
    expect(c.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(shownCollection(c).title).toBe("Replay as a method")
  })

  it("puts a collection an agent started into the trash", async () => {
    const { collections, versions } = setup()
    const { id } = await start(collections)
    const first = (await versions.list({ path: id })).at(-1)!
    const v = (await versions.get(first.id))!
    expect(v.existed).toBe(false)
    const { redoId } = await collections.restoreVersion(id, v.content, false, {})
    expect(await collections.list()).toEqual([])
    const redo = (await versions.get(redoId))!
    await collections.restoreVersion(id, redo.content, redo.existed !== false, {})
    expect((await collections.list()).map((c) => c.id)).toEqual([id])
  })
})

describe("Collections.paperOf", () => {
  it("finds a paper a collection keeps, whatever collection it is in", async () => {
    const { collections } = setup()
    await start(collections)
    expect((await collections.paperOf("doi-10.1145-2"))?.title).toBe(papers["doi-10.1145-2"]!.title)
    expect(await collections.paperOf("doi-10.1145-9")).toBeUndefined()
  })
})

describe("uniqueId", () => {
  it("names a collection from its Latin words, or at random when there are too few", () => {
    expect(uniqueId("UIST 2026 papers", [])).toBe("uist-2026-papers")
    expect(uniqueId("UIST 2026 papers", ["uist-2026-papers"])).toBe("uist-2026-papers-2")
    expect(uniqueId("回放式标注作为研究方法", [])).toMatch(/^c-[0-9a-f]{6}$/)
  })
})

describe("Collections, Owlit's work in the background", () => {
  function withRuns() {
    const prompts: { prompt: string; allow: string }[] = []
    const ctx = setup({
      // The agent writes the way it would through owlit-mcp: a row and a title on the first write
      agent: async (prompt, _signal, allow) => {
        prompts.push({ prompt, allow: allow.source })
        const id = /collection_write,? id ([\w-]+)/.exec(prompt)?.[1]
        if (id && prompt.includes("gathering")) await ctx.collections.write({ id, title: "Replay ratings", rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }] })
        return { text: "Gathered one paper." }
      },
    })
    const scheduler = new Scheduler({ store: new TaskStore(mkdtempSync(path.join(tmpdir(), "owlit-tasks-"))), definitions: ctx.collections.tasks(), retryDelay: () => 5 })
    ctx.collections.attach(scheduler)
    return { ...ctx, scheduler, prompts }
  }

  it("starts a collection at once and fills it in the background", async () => {
    const { collections, scheduler, prompts } = withRuns()
    const c = await collections.gather({ question: "回放评价可靠吗？", project: "主动提醒研究", size: "few" })
    expect(c).toMatchObject({ title: "回放评价可靠吗？", project: "主动提醒研究", size: "few", rows: [] })
    const task = Object.values(await scheduler.list()).find((t) => t.subject === c.id)!
    expect(task.kind).toBe("collections.gather")
    expect((await scheduler.wait(task.id)).state).toBe("done")
    const now = await collections.get(c.id)
    expect(now.title).toBe("Replay ratings")
    expect(now.rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
    expect(prompts[0]?.prompt).toMatch(/about ten papers/)
    expect(prompts[0]?.allow).toMatch(/library_\(search\|related\|journal\)/)
  })

  it("adds a column and asks the agent to fill it, with only collection_write besides reading", async () => {
    const { collections, scheduler, prompts } = withRuns()
    const { id } = await start(collections)
    const c = await collections.ask(id, "Method and sample")
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ question: "Method and sample", kind: "ask" })
    const task = (await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!
    expect(task.kind).toBe("collections.fill")
    await scheduler.wait(task.id)
    expect(prompts[0]?.prompt).toMatch(new RegExp(`The column to fill: ${column.id} — «Method and sample»`))
    expect(prompts[0]?.allow).not.toMatch(/library_add/)
    // Asking the same again fills the same column
    expect((await collections.ask(id, "Method  and sample")).columns).toHaveLength(2)
  })

  it("sets every paper against the user's sentences, in a column the agent fills", async () => {
    const { collections, scheduler, prompts } = withRuns()
    const { id } = await start(collections)
    const c = await collections.compare(id, "System Design.md", ["Replay ratings run lower.", "Timing is one stage of four."])
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "compare", doc: "System Design.md", sentences: [{ id: "l1" }, { id: "l2" }] })
    await scheduler.wait((await scheduler.list()).find((t) => t.subject === `${id}:${column.id}`)!.id)
    expect(prompts[0]?.prompt).toMatch(/- l2: «Timing is one stage of four\.»/)
    await collections.edit(id, { op: "hide", column: column.id, hidden: true })
    expect((await collections.get(id)).columns.find((col) => col.id === column.id)?.hidden).toBe(true)
  })

  it("checks watched collections once a day", async () => {
    const { collections, scheduler } = withRuns()
    const { id } = await start(collections)
    await collections.edit(id, { op: "watch", on: true })
    await collections.checkWatched(Date.now())
    expect((await scheduler.list()).filter((t) => t.kind === "collections.check")).toHaveLength(0)
    await collections.checkWatched(Date.now() + 25 * 3_600_000)
    const task = (await scheduler.list()).find((t) => t.kind === "collections.check")!
    await scheduler.wait(task.id)
    expect((await collections.get(id)).checkedAt).toBeGreaterThan(0)
  })
})
