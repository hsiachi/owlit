import { itemId, readInFull, RpcErrorCode, shownThread, type Change, type ChatAbout, type Notifications, type Thread, type ThreadPaper } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { ChangeLog } from "../changes/log.ts"
import { Recorder } from "../changes/record.ts"
import { Seen } from "../changes/seen.ts"
import { RpcFailure } from "../rpc/errors.ts"
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
      // Every paper a thread names is in the Library
      facts: async (id) => papers[id],
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

// Owlit's agent, writing for the chat its write names when it names one
const agent = { kind: "owlit" as const }
const window = { kind: "window" as const }

const start = (threads: Threads, extra: object = {}) =>
  threads.write({
    asked: "我的研究方法该怎么设计？",
    title: "回放式标注作为研究方法",
    project: "主动提醒研究",
    sources: ["Semantic Scholar"],
    report: "Two precedents had wearers replay their own footage. Replay ratings run lower than live ones.",
    rows: [
      { id: "doi-10.1145-1", cells: { q: { text: "Replay ratings 0.6 lower, same direction.", depth: "full", passage: { quote: "0.6 points lower", page: 7 } } } },
      { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "abstract" } } },
    ],
    chatId: "chat-1",
    ...extra,
  }, agent)

describe("Threads.write", () => {
  it("starts a thread with the question as its first column, the papers as the Library has them, and the report's first sentence as its line", async () => {
    const { threads, wrote } = setup()
    const out = await start(threads)
    expect(out).toMatchObject({ title: "回放式标注作为研究方法", added: 2, updated: 0 })
    const c = await threads.get(out.id)
    expect(c.columns).toEqual([{ id: "q", question: "我的研究方法该怎么设计？", kind: "ask" }])
    expect(c.rows.map((r) => r.paper.title)).toEqual([papers["doi-10.1145-1"]!.title, papers["doi-10.1145-2"]!.title])
    expect(c.asked).toMatchObject({ text: "我的研究方法该怎么设计？", chatId: "chat-1" })
    expect(c.one).toBe("Two precedents had wearers replay their own footage.")
    expect((await threads.list())[0]).toMatchObject({ question: "我的研究方法该怎么设计？", one: "Two precedents had wearers replay their own footage." })
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

  it("lands the user's rewrite of a cell in the thread, without a dot", async () => {
    const { threads, seen, dots } = setup()
    const { id } = await start(threads)
    await seen.mark(ME, { kind: "thread", id, items: [] })
    await threads.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-2", "q"), text: "Lifelog replay beats diaries." }, window)
    expect((await threads.get(id)).rows.find((r) => r.id === "doi-10.1145-2")?.cells.q?.text).toBe("Lifelog replay beats diaries.")
    expect(await dots(id)).toEqual([])
  })

  it("logs an answer written again from the full text with the one it replaced, whatever asked for it", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    const newest = async (paper: string) => (await changes.list({ target: { kind: "thread", path: id, part: itemId.cell(paper, "q") } }))[0]
    // Read all in full: Owlit rewrites the rows answered from their abstracts
    await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover a third more.", depth: "full", passage: { quote: "a third more", page: 4 } } } }] }, agent)
    expect(readInFull(await newest("doi-10.1145-2"))).toEqual({ was: "Own explanations recover more.", from: "abstract" })
    // A chat's write over an answer from the title only (the paper has no abstract) is the same entry
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }] }, agent)
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Replay ratings 0.6 lower.", depth: "full", passage: { quote: "0.6 points lower", page: 7 } } } }], chatId: "chat-1" }, { kind: "socket", chatId: "chat-1" })
    expect(readInFull(await newest("doi-10.1145-1"))).toEqual({ was: "Lower.", from: "title" })
    // A rewrite that stays from the full text isn't one
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Replay ratings run 0.6 lower.", depth: "full", passage: { quote: "0.6 points lower", page: 7 } } } }] }, agent)
    expect(readInFull(await newest("doi-10.1145-1"))).toBeNull()
  })

  it("rewrites the report whole, and its line with it unless the write gives one", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    await threads.write({ id, report: "## Replay\n\nAs [Kelly et al. 2015](owlit://library/doi-10.1145-2) found, wearers explain more. Live ratings differ." }, agent)
    let c = await threads.get(id)
    expect(c.report).toMatch(/^## Replay/)
    expect(c.one).toBe("As Kelly et al. 2015 found, wearers explain more.")
    await threads.write({ id, report: "Shorter.", one: "Replay as a method, two precedents." }, agent)
    c = await threads.get(id)
    expect([c.report, c.one]).toEqual(["Shorter.", "Replay as a method, two precedents."])
    expect((await changes.list({ path: id })).map((e) => e.target.part).slice(0, 2)).toEqual(["one", "report"])
  })

  it("adds a paper the Library hasn't got as the writer's, under the Library's id, with how it was found", async () => {
    const added: { id: string; title: string; caller: string }[] = []
    const { threads } = setup({
      paper: async (id) => (id === "W42" ? { title: "Replay ratings", authors: ["Oh"], ids: { doi: "10.1145/9" } } : papers[id]),
      facts: async (id) => (id === "doi-10.1145-9" ? { title: "Replay ratings", authors: ["Oh"], ids: { doi: "10.1145/9" } } : papers[id]),
      canonical: async (id) => (id in papers || added.some((a) => a.id === id) ? id : id === "W42" && added.length ? "doi-10.1145-9" : undefined),
      addPaper: async (_id, paper, caller) => {
        added.push({ id: "doi-10.1145-9", title: paper.title, caller: caller.kind })
        return "doi-10.1145-9"
      },
      foundBy: (id) => (id === "W42" ? "replay ratings" : undefined),
    })
    const { id } = await start(threads)
    await threads.write({ id, report: "See [Oh](owlit://library/W42).", rows: [{ id: "W42", is: "Lab study, 30 people", cells: { q: { text: "Lower.", depth: "abstract" } } }] }, agent)
    expect(added).toEqual([{ id: "doi-10.1145-9", title: "Replay ratings", caller: "owlit" }])
    const c = await threads.get(id)
    expect(c.rows.at(-1)).toMatchObject({ id: "doi-10.1145-9", is: "Lab study, 30 people", foundBy: "search: replay ratings", paper: { title: "Replay ratings" }, cells: { q: { text: "Lower." } } })
    expect(c.report).toBe("See [Oh](owlit://library/doi-10.1145-9).")
    // Named again by the search's id, it is that row
    await threads.write({ id, rows: [{ id: "W42", cells: { q: { text: "Lower, by 0.6.", depth: "abstract" } } }] }, agent)
    expect((await threads.get(id)).rows.filter((r) => r.id === "doi-10.1145-9").map((r) => r.cells.q?.text)).toEqual(["Lower, by 0.6."])
    expect(added).toHaveLength(1)
  })

  it("never saves the Library's facts into the thread, whatever it reads", async () => {
    const { threads, owlit } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rename", title: "Replay as a method" }, window)
    await threads.start(id, "more", window, "lifelog").catch(() => undefined)
    const kept = JSON.parse(readFileSync(path.join(owlit, "threads", id, "thread.json"), "utf8"))
    expect(kept.version).toBe(3)
    expect(kept.rows.map((r: object) => "paper" in r)).toEqual([false, false])
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
    const after = await threads.get(id)
    expect(after.columns.at(-1)?.groups).toEqual([])
    expect(after.rows[0]?.in).toBeUndefined()
  })

  it("adds a column once, however often it is asked", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.write({ id, columns: [{ question: "Method and sample" }] }, agent)
    await threads.write({ id, columns: [{ question: "Method  and sample" }] }, agent)
    expect((await threads.get(id)).columns.map((c) => c.question)).toEqual(["我的研究方法该怎么设计？", "Method and sample"])
    await expect(threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { nope: { text: "x", depth: "abstract" } } }] }, agent)).rejects.toThrow(/no column nope/)
  })

  it("writes the rows that are fine and names the one that isn't", async () => {
    const { threads } = setup({ findPassage: async (_id, quote) => (quote === "0.6 points lower" ? 7 : null) })
    const { id } = await start(threads)
    const out = await threads.write(
      {
        id,
        rows: [
          { id: "doi-10.1145-3", is: "Diary study, 40 people", cells: { q: { text: "Recall ran lower.", depth: "abstract" } } },
          { id: "doi-10.1145-2", cells: { q: { text: "Own explanations recover more.", depth: "full", passage: { quote: "not in the paper", page: 1 } } } },
          { id: "doi-10.9999-x" },
        ],
      },
      agent,
    )
    expect(out).toMatchObject({ added: 1, updated: 0, left: [expect.stringMatching(/passage for doi-10\.1145-2 isn't in its text/), expect.stringMatching(/doesn't know the paper doi-10\.9999-x/)] })
    const c = await threads.get(id)
    expect(c.rows.find((r) => r.id === "doi-10.1145-3")).toMatchObject({ is: "Diary study, 40 people", cells: { q: { text: "Recall ran lower." } } })
    expect(c.rows.find((r) => r.id === "doi-10.1145-2")?.cells.q).toMatchObject({ depth: "abstract" })
    // Nothing that could go in: refused whole
    await expect(threads.write({ id, rows: [{ id: "doi-10.9999-x" }] }, agent)).rejects.toThrow(/owlit didn't write it:\n- owlit doesn't know the paper doi-10\.9999-x/)
  })

  it("keeps a report that links a paper that is no row of the thread, naming it, and writes the rest", async () => {
    const { threads } = setup({ canonical: async (id) => (id === "W2" ? "doi-10.1145-2" : id in papers ? id : undefined) })
    const { id } = await start(threads)
    const out = await threads.write(
      { id, report: "[Kelly](owlit://library/W2) and [van Berkel](owlit://library/doi-10.1145-3) disagree.", rows: [{ id: "doi-10.1145-1", is: "Field study" }] },
      agent,
    )
    expect(out.left).toEqual([expect.stringMatching(/^The report links doi-10\.1145-3, which isn't a paper of this thread/)])
    let c = await threads.get(id)
    expect(c.report).toBe("Two precedents had wearers replay their own footage. Replay ratings run lower than live ones.")
    expect(c.rows[0]?.is).toBe("Field study")
    // A link by another id of a row's paper names the row
    await threads.write({ id, report: "[Kelly](owlit://library/W2) found more." }, agent)
    c = await threads.get(id)
    expect(c.report).toBe("[Kelly](owlit://library/doi-10.1145-2) found more.")
  })
})

const GROUPS = [
  { id: "a", name: "Replay" },
  { id: "b", name: "Live" },
  { id: "c", name: "Recall" },
]
const inGroups = (c: Thread) => Object.fromEntries(shownThread(c).rows.map((r) => [r.id, r.in?.topic ?? []]))

describe("Threads, the user's groups", () => {
  it("moves a paper where the user puts it; Owlit's next write of the grouping is the grouping", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "b" }] })
    await threads.edit(id, { op: "move", column: "topic", row: "doi-10.1145-1", group: "b" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["b"] })
    await threads.write({ id, groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] }, agent)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["a"], "doi-10.1145-2": ["c"] })
  })

  it("merges a group into another and ungroups one, in the data", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", group: "a" }, { id: "doi-10.1145-2", group: "c" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "a", into: "b" }, window)
    await threads.edit(id, { op: "ungroup", column: "topic", group: "c" }, window)
    const c = await threads.get(id)
    expect(c.columns.at(-1)?.groups?.map((g) => g.id)).toEqual(["b"])
    expect(inGroups(c)).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [] })
  })

  it("renames a group", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS })
    await threads.edit(id, { op: "rewrite", item: itemId.group("topic", "a"), text: "Watching it again" }, window)
    expect((await threads.get(id)).columns.at(-1)?.groups?.[0]).toEqual({ id: "a", name: "Watching it again" })
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
    const c = await threads.get(id)
    expect(c.columns.at(-1)?.groups).toEqual([{ id: "a", name: "A" }, { id: "a1", name: "A1", parent: "a" }, { id: "b1", name: "B1", parent: "a" }])
    expect(c.rows[0]?.in).toEqual({ topic: ["b1"] })
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
  })

  it("merges a group into one the paper is in already: then it is in that one only", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }, { id: "doi-10.1145-2", group: "a" }] })
    await threads.edit(id, { op: "merge", column: "topic", group: "a", into: "b" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": ["b"] })
  })

  it("ungroups: each paper leaves the group, and one in no other group is in none", async () => {
    const { threads } = setup()
    const { id } = await start(threads, { groups: GROUPS, rows: [{ id: "doi-10.1145-1", groups: ["a", "b"] }, { id: "doi-10.1145-2", group: "a" }] })
    await threads.edit(id, { op: "ungroup", column: "topic", group: "a" }, window)
    expect(inGroups(await threads.get(id))).toEqual({ "doi-10.1145-1": ["b"], "doi-10.1145-2": [] })
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
    expect(c.view).toEqual({ groupBy: "grouping:topic" })
    expect(c.updatedAt).toBe(before.updatedAt)
    expect((await threads.history(id)).some((l) => l.items.includes("view"))).toBe(false)
  })
})

describe("Threads kept by an older version", () => {
  // What a version 2 thread kept on disk: Owlit's text, with what the user did to it beside it
  const v2 = {
    version: 2,
    id: "old",
    title: "Old",
    asked: { text: "Old?", at: 1 },
    project: "",
    sources: ["OpenAlex"],
    memo: [
      { id: "s1", text: "[Kelly et al. 2015](owlit://library/doi-10.1145-2) had wearers replay footage." },
      { id: "s2", text: "Nobody compared it with live ratings." },
      { id: "s3", text: "Replay ratings run lower." },
    ],
    columns: [
      { id: "q", question: "Old?", kind: "ask" },
      { id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: [{ id: "a", name: "Replay" }, { id: "b", name: "Live" }, { id: "c", name: "Recall", parent: "a" }, { id: "d", name: "Diaries" }] },
    ],
    rows: [
      { id: "doi-10.1145-1", paper: papers["doi-10.1145-1"], cells: { q: { text: "Lower.", depth: "abstract", at: 1 } }, in: { topic: ["a"] }, addedAt: 1 },
      { id: "doi-10.1145-2", paper: papers["doi-10.1145-2"], cells: { q: { text: "More.", depth: "abstract", at: 1 } }, in: { topic: ["c"] }, foundBy: "search: lifelog replay", addedAt: 1 },
      { id: "doi-10.1145-3", paper: papers["doi-10.1145-3"], cells: {}, in: { topic: ["d"] }, addedAt: 1 },
      { id: "arxiv-2501.00001", paper: { title: "Gone", authors: [], ids: { arxiv: "2501.00001" } }, cells: {}, addedAt: 1 },
    ],
    size: "many",
    createdAt: 1,
    updatedAt: 1,
    overrides: {
      edits: {
        title: { text: "Replay as a method", at: 2, was: "Old" },
        "memo:s3": { text: "Replay ratings run lower, by 0.6.", at: 2, was: "Replay ratings run lower." },
        "cell:doi-10.1145-2:q": { text: "Recovers more.", at: 2, was: "More." },
        "group:topic:b": { text: "Live ratings", at: 2, was: "Live" },
      },
      removed: { "memo:s2": { text: "Nobody compared it with live ratings.", at: 2 }, "row:arxiv-2501.00001": { text: "Gone", at: 2 }, "group:topic:d": { text: "Diaries", at: 2 } },
      placed: { "topic:doi-10.1145-1:b": { in: true, at: 3 } },
      merged: { "topic:a": "b" },
      view: { groupBy: "grouping:topic" },
    },
    splitFrom: { id: "other", rows: [] },
  }

  it("applies the user's changes once into a version 2 thread, its memo as the report, its papers in the Library", async () => {
    // The Library has the first paper under its arXiv id and lacks the third
    const library = new Set(["arxiv-2400.00001", "doi-10.1145-2"])
    const added: string[] = []
    const { owlit, threads } = setup({
      canonical: async (id, ids) => (id === "doi-10.1145-1" || ids?.doi === "10.1145/1" ? "arxiv-2400.00001" : library.has(id) ? id : undefined),
      addPaper: async (id, paper, caller) => {
        added.push(`${id} ${paper.title} ${caller.kind}`)
        library.add(id)
        return id
      },
      facts: async (id) => (id === "arxiv-2400.00001" ? papers["doi-10.1145-1"] : papers[id]),
    })
    mkdirSync(path.join(owlit, "threads", "old"), { recursive: true })
    writeFileSync(path.join(owlit, "threads", "old", "thread.json"), JSON.stringify(v2))
    const c = await threads.get("old")
    expect(c).toMatchObject({ version: 3, title: "Replay as a method", sources: ["OpenAlex"], view: { groupBy: "grouping:topic" } })
    expect(c.report).toBe("[Kelly et al. 2015](owlit://library/doi-10.1145-2) had wearers replay footage. Replay ratings run lower, by 0.6.")
    expect(c.one).toBe("Kelly et al. 2015 had wearers replay footage.")
    // a went into b, so c (under a) sits under b now; d was ungrouped; b took the user's name
    expect(c.columns.at(-1)?.groups).toEqual([{ id: "b", name: "Live ratings" }, { id: "c", name: "Recall", parent: "b" }])
    expect(c.rows.map((r) => [r.id, r.in?.topic, r.cells.q?.text, r.paper.title])).toEqual([
      ["arxiv-2400.00001", ["b"], "Lower.", papers["doi-10.1145-1"]!.title],
      ["doi-10.1145-2", ["c"], "Recovers more.", papers["doi-10.1145-2"]!.title],
      ["doi-10.1145-3", undefined, undefined, papers["doi-10.1145-3"]!.title],
    ])
    expect(c.rows[1]?.foundBy).toBe("search: lifelog replay")
    // The removed row's paper isn't added; the third is, as Owlit's
    expect(added).toEqual([`doi-10.1145-3 ${papers["doi-10.1145-3"]!.title} owlit`])
    // On disk once nothing else is writing, without the snapshots and without what has gone
    await threads.edit("old", { op: "view", groupBy: "none" }, window)
    const kept = JSON.parse(readFileSync(path.join(owlit, "threads", "old", "thread.json"), "utf8"))
    expect(kept.version).toBe(3)
    expect(Object.keys(kept).filter((k) => ["memo", "overrides", "size", "splitFrom"].includes(k))).toEqual([])
    expect(kept.rows.some((r: object) => "paper" in r)).toBe(false)
    expect(kept.view).toEqual({ groupBy: "none" })
  })

  it("upgrades a version 1 thread through version 2: its groups become a hidden Topic grouping", async () => {
    const { owlit, threads } = setup()
    const v1 = {
      version: 1,
      id: "older",
      title: "Older",
      asked: { text: "Older?", at: 1 },
      project: "",
      sources: [],
      memo: [{ id: "s1", text: "See [Evaluation](owlit://threads/older#group=eval)." }],
      columns: [{ id: "q", question: "Older?", kind: "ask" }],
      rows: [
        { id: "doi-10.1145-1", paper: papers["doi-10.1145-1"], cells: {}, group: "eval", addedAt: 1 },
        { id: "doi-10.1145-2", paper: papers["doi-10.1145-2"], cells: {}, addedAt: 1 },
      ],
      groups: [{ id: "eval", name: "Evaluation" }, { id: "rep", name: "Replay", parent: "eval" }],
      watch: true,
      createdAt: 1,
      updatedAt: 1,
      overrides: { edits: { "group:eval": { text: "Evaluating", at: 2, was: "Evaluation" } }, removed: {} },
    }
    mkdirSync(path.join(owlit, "threads", "older"), { recursive: true })
    writeFileSync(path.join(owlit, "threads", "older", "thread.json"), JSON.stringify(v1))
    const c = await threads.get("older")
    expect(c.version).toBe(3)
    expect(c.report).toBe("See [Evaluation](owlit://threads/older#group=eval).")
    expect(c.columns.at(-1)).toEqual({ id: "topic", question: "Topic", kind: "grouping", hidden: true, groups: [{ id: "eval", name: "Evaluating" }, { id: "rep", name: "Replay", parent: "eval" }] })
    expect(c.rows.map((r) => r.in)).toEqual([{ topic: ["eval"] }, undefined])
    expect("watch" in c).toBe(false)
    // A short list stays one: only the question's own column is shown
    expect((await threads.list())[0]?.columns).toBe(0)
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

})

describe("Threads, the user's side", () => {
  it("renames", async () => {
    const { threads } = setup()
    const { id } = await start(threads)
    await threads.edit(id, { op: "rename", title: "Replay as a method" }, window)
    expect((await threads.list())[0]?.title).toBe("Replay as a method")
    await expect(threads.edit(id, { op: "rename", title: " " }, window)).rejects.toThrow(/Write something/)
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
    expect(second[1]!.after).toEqual({ value: { id: "doi-10.1145-3", addedAt: expect.any(Number) } })
    expect(wrote.filter((n) => n.change.origin.chatId === "chat-2")).toHaveLength(1)
    const undos = []
    for (const e of second) undos.push(await undo(threads, e))
    let c = await threads.get(id)
    expect(c.rows.map((r) => r.id)).toEqual(["doi-10.1145-1", "doi-10.1145-2"])
    expect(c.rows[0]!.cells.q?.text).toBe("Lower by 0.6, from the abstract.")
    expect(c.title).toBe("Replay as a method")
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

describe("Threads, a paper named by another id", () => {
  it("knows a row by the paper it is, whatever id named it", async () => {
    // The search named the paper by its arXiv id; the library keeps it under its DOI
    const library: Record<string, string> = { "arxiv-2310.00001": "doi-10.1145-9", "doi-10.1145-9": "doi-10.1145-9" }
    const { threads } = setup({ canonical: async (id) => library[id] })
    const { id } = await threads.write({ asked: "Do replay ratings hold?", title: "Replay", rows: [{ id: "arxiv-2310.00001", cells: { q: { text: "Lower.", depth: "abstract" } } }] }, agent)
    await threads.write({ id, rows: [{ id: "arxiv-2310.00001", cells: { q: { text: "Lower, by 0.6.", depth: "abstract" } } }] }, agent)
    const c = await threads.get(id)
    expect(c.rows.map((r) => [r.id, r.cells.q?.text])).toEqual([["doi-10.1145-9", "Lower, by 0.6."]])
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

describe("Threads, Owlit's work in chats it starts", () => {
  // A chat owlit starts about the thread: its agent writes the way it would through owlit-mcp, signed
  // with the chat; done is its turn
  function withChats(services: ThreadsServices = {}) {
    const started: { chatId: string; about: ChatAbout; title: string; recipe: string; done: Promise<void> }[] = []
    // What the chats and a typed chat searched, as the Library logs it
    const searched: { by: string; at: number; query: string; source: string; results: string[] }[] = []
    const ctx = setup({
      searches: async (by, since) => searched.filter((s) => s.by === by && s.at > since),
      chatAbout: async (chatId) => started.find((c) => c.chatId === chatId)?.about,
      startChat: async ({ about, title, recipe }) => {
        const chatId = `owlit-${started.length + 1}`
        const by = { kind: "socket" as const, chatId }
        const work = async () => {
          const id = /thread_write,? id ([\w-]+)/.exec(recipe)?.[1]
          searched.push(
            { by: `chat:${chatId}`, at: Date.now(), query: "replay ratings validity", source: "openalex", results: ["doi-10.1145-1", "doi-10.1145-9"] },
            { by: `chat:${chatId}`, at: Date.now(), query: "cited_by of doi-10.1145-1", source: "openalex", results: ["doi-10.1145-8"] },
          )
          // Grouping: the groups first, then every paper in one, as the recipe says
          const grouping = /The grouping: ([\w-]+)/.exec(recipe)?.[1]
          if (id && grouping) {
            await ctx.threads.write({ id, grouping, groups: [{ id: "ch1", name: "Chapter 1" }, { id: "ch2", name: "Chapter 2" }], chatId }, by)
            await ctx.threads.write({ id, grouping, rows: [{ id: "doi-10.1145-1", group: "ch1" }, { id: "doi-10.1145-2", group: "ch2" }], chatId }, by)
          }
          if (id && recipe.includes("gathering"))
            await ctx.threads.write({ id, title: "Replay ratings", rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }], note: "Semantic Scholar wasn't reachable.", chatId }, by)
        }
        const done = Promise.resolve().then(work)
        started.push({ chatId, about, title, recipe, done })
        return { chatId, messageId: `${chatId}-reply`, done: done.then(() => "end_turn" as const) }
      },
      ...services,
    })
    const chat = (chatId: string) => started.find((c) => c.chatId === chatId)!
    return { ...ctx, started, chat, searched }
  }

  it("leaves no empty thread when Gather's chat can't start, and says why", async () => {
    const noAgent = new RpcFailure(RpcErrorCode.Unavailable, "No agent is set up for Owlit to work with. Set one up in Settings › Agents.")
    const checked = withChats({ canStartChat: async () => Promise.reject(noAgent) })
    await expect(checked.threads.gather({ question: "回放评价可靠吗？", size: "few" }, window)).rejects.toBe(noAgent)
    expect(await checked.threads.list()).toEqual([])
    expect(await checked.changes.list()).toEqual([])

    // Known only when the chat starts: the thread made for it goes again
    const late = withChats({ startChat: async () => Promise.reject(noAgent) })
    await expect(late.threads.gather({ question: "回放评价可靠吗？", size: "few" }, window)).rejects.toBe(noAgent)
    expect(await late.threads.list()).toEqual([])
    expect(late.events.at(-1)).toMatchObject({ gone: true })
  })

  it("tells its batches apart for About: a started chat's writes are one batch named by its recipe, then a chat's later question", async () => {
    const { threads, chat, searched } = withChats()
    const { thread: c, chatId } = await threads.gather({ question: "回放评价可靠吗？", size: "few" }, window)
    await chat(chatId).done
    searched.push({ by: "chat:c9", at: Date.now(), query: "lifelog video recall", source: "arxiv", results: ["doi-10.1145-2"] })
    await threads.write({ id: c.id, asked: "Does lifelog video help recall?", rows: [{ id: "doi-10.1145-2", cells: { q: { text: "It helps.", depth: "abstract" } } }], chatId: "c9" }, agent)

    const [gathered, typed, ...rest] = await threads.about(c.id)
    expect(rest).toEqual([])
    expect(gathered).toMatchObject({ trigger: "gather", added: 1, answered: 0, notes: ["Semantic Scholar wasn't reachable."] })
    expect(gathered!.chatId).toBeUndefined()
    expect(gathered!.searches).toEqual([
      { kind: "search", query: "replay ratings validity", source: "openalex", found: 2, kept: 1 },
      { kind: "cited_by", query: "doi-10.1145-1", of: "Replay or Live? Validity of Retrospective Ratings", source: "openalex", found: 1, kept: 0 },
    ])
    expect(typed).toMatchObject({ trigger: "chat", chatId: "c9", asked: "Does lifelog video help recall?", added: 1, searches: [{ query: "lifelog video recall", kept: 1 }] })
  })

  it("keeps a started chat's writes one batch however far apart, as Retry's turn in the same chat adds to it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const { threads, chat } = withChats()
      const { id } = await start(threads)
      const { chatId } = await threads.start(id, "read", window)
      await chat(chatId).done
      const by = { kind: "socket" as const, chatId }
      // The clock stands still under fake Date: a minute on, so these writes aren't the rows' arrival
      vi.setSystemTime(Date.now() + 60_000)
      await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "0.6 lower.", depth: "full", passage: { quote: "0.6 points lower", page: 7 } } } }], chatId }, by)
      vi.setSystemTime(Date.now() + 2 * 3_600_000)
      await threads.write({ id, rows: [{ id: "doi-10.1145-2", cells: { q: { text: "A third more.", depth: "full", passage: { quote: "a third more", page: 4 } } } }], chatId }, by)
      const batches = await threads.about(id)
      expect(batches.at(-1)).toMatchObject({ trigger: "read", answered: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("starts a thread at once and a chat about it that fills it, as Reviewer would, named by the thread", async () => {
    const { threads, chat } = withChats()
    const { thread: c, chatId } = await threads.gather({ question: "回放评价可靠吗？", project: "主动提醒研究", size: "few" }, window)
    expect(c).toMatchObject({ title: "回放评价可靠吗？", project: "主动提醒研究", rows: [] })
    expect(chat(chatId)).toMatchObject({ about: { kind: "thread", id: c.id, recipe: "gather" }, title: "回放评价可靠吗？" })
    expect(chat(chatId).recipe).toMatch(/about ten papers/)
    await chat(chatId).done
    const now = await threads.get(c.id)
    expect(now.title).toBe("Replay ratings")
    expect(now.rows.map((r) => r.id)).toEqual(["doi-10.1145-1"])
  })

  it("runs several at once: each button starts its own chat", async () => {
    const { threads, started } = withChats()
    const { id } = await start(threads)
    const more = await threads.start(id, "more", window)
    const asked = await threads.ask(id, "Method and sample", window)
    expect(new Set([more.chatId, asked.chatId]).size).toBe(2)
    expect(started.map((c) => c.about.recipe)).toEqual(["find-more", "ask-each"])
  })

  it("finds more papers for what the user asks this time, kept as a question asked, and reads only the rows with a PDF to be had", async () => {
    const { threads, chat } = withChats({ hasText: async (id) => id === "doi-10.1145-1", facts: async (id) => (id === "doi-10.1145-2" ? { ...papers[id]!, openPdf: true } : papers[id]) })
    const { id } = await start(threads, { rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }, { id: "doi-10.1145-2", cells: { q: { text: "Recovers more.", depth: "abstract" } } }, { id: "doi-10.1145-3", cells: { q: { text: "No PDF.", depth: "abstract" } } }] })
    const more = await threads.start(id, "more", window, "the same model with and without retrieval")
    expect(chat(more.chatId).recipe).toMatch(/look for: «the same model with and without retrieval»/)
    expect((await threads.get(id)).alsoAsked?.map((a) => a.text)).toEqual(["the same model with and without retrieval"])
    // The question as it stands adds nothing and is looked for as before
    const again = await threads.start(id, "more", window, "我的研究方法该怎么设计？")
    expect(chat(again.chatId).recipe).not.toMatch(/look for/)
    expect((await threads.get(id)).alsoAsked).toHaveLength(1)
    // Read in full: the rows answered from the abstract whose paper has text already or a free PDF
    const read = await threads.start(id, "read", window)
    expect(chat(read.chatId).about.recipe).toBe("read-in-full")
    expect(chat(read.chatId).recipe).toMatch(/reading in full 2 papers/)
    expect(chat(read.chatId).recipe).toMatch(/Read these rows, and no others: doi-10\.1145-1, doi-10\.1145-2\./)
  })

  it("asks for answers from the full text from the start for the rows whose text owlit has", async () => {
    const { threads, chat } = withChats({ hasText: async (id) => id === "doi-10.1145-2" })
    const { id } = await start(threads)
    const { chatId } = await threads.ask(id, "Method and sample", window)
    expect(chat(chatId).recipe).toMatch(/full text in the user's library: doi-10\.1145-2\. Answer them from it/)
    expect(chat(chatId).recipe).not.toMatch(/doi-10\.1145-1/)
  })

  it("adds a column and starts a chat that fills it, naming the column", async () => {
    const { threads, chat } = withChats()
    const { id } = await start(threads)
    const { thread: c, chatId } = await threads.ask(id, "Method and sample", window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ question: "Method and sample", kind: "ask" })
    expect(chat(chatId).about).toEqual({ kind: "thread", id, recipe: "ask-each", column: column.id })
    expect(chat(chatId).recipe).toMatch(new RegExp(`The column to fill: ${column.id} — «Method and sample»`))
    // Asking the same again fills the same column
    expect((await threads.ask(id, "Method  and sample", window)).thread.columns).toHaveLength(2)
  })

  it("sets every paper against the user's sentences, in a column a chat fills", async () => {
    const { threads, chat } = withChats()
    const { id } = await start(threads)
    const { thread: c, chatId } = await threads.compare(id, "System Design.md", ["Replay ratings run lower.", "Timing is one stage of four."], window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "compare", doc: "System Design.md", sentences: [{ id: "l1" }, { id: "l2" }] })
    expect(chat(chatId).recipe).toMatch(/- l2: «Timing is one stage of four\.»/)
    await threads.edit(id, { op: "hide", column: column.id, hidden: true }, window)
    expect((await threads.get(id)).columns.find((col) => col.id === column.id)?.hidden).toBe(true)
  })

  it("groups the papers another way: a hidden grouping a chat fills, groups first, and afresh when asked again", async () => {
    const { threads, chat } = withChats()
    const { id } = await start(threads, { groups: [{ id: "a", name: "A" }], rows: [{ id: "doi-10.1145-1", group: "a" }] })
    const { thread: c, chatId } = await threads.group(id, "the chapters of my story", window)
    const column = c.columns.at(-1)!
    expect(column).toMatchObject({ kind: "grouping", question: "the chapters of my story", hidden: true, groups: [] })
    expect(chat(chatId).about).toMatchObject({ recipe: "group", column: column.id })
    await chat(chatId).done
    expect(chat(chatId).recipe).toMatch(/by «the chapters of my story»/)
    expect(chat(chatId).recipe).not.toMatch(/afresh/)
    let now = shownThread(await threads.get(id))
    expect(now.columns.find((col) => col.id === column.id)?.groups?.map((g) => g.id)).toEqual(["ch1", "ch2"])
    expect(now.rows.map((r) => r.in)).toEqual([
      { topic: ["a"], [column.id]: ["ch1"] },
      { [column.id]: ["ch2"] },
    ])
    const again = await threads.fill(id, column.id)
    await chat(again.chatId).done
    expect(chat(again.chatId).about.recipe).toBe("group")
    expect(chat(again.chatId).recipe).toMatch(/afresh/)
    now = shownThread(await threads.get(id))
    expect(now.rows.map((r) => r.in?.[column.id])).toEqual([["ch1"], ["ch2"]])
    // The same words again are the same grouping
    expect((await threads.group(id, "the chapters  of my story", window)).thread.columns.filter((col) => col.kind === "grouping")).toHaveLength(2)
  })
})

describe("Threads.recipe", () => {
  it("writes a recipe out for one thread: what to look for, the rows to read, the column to fill", async () => {
    const { threads } = setup({ hasText: async (id) => id === "doi-10.1145-1" })
    const { id } = await start(threads, { rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower.", depth: "abstract" } } }, { id: "doi-10.1145-3", cells: { q: { text: "No PDF.", depth: "abstract" } } }] })
    expect(await threads.recipe("find-more", id, { lookFor: "lifelog video" })).toMatch(/look for: «lifelog video»/)
    // The thread's own question is no "this time"
    expect(await threads.recipe("find-more", id, { lookFor: "我的研究方法该怎么设计？" })).not.toMatch(/look for/)
    expect(await threads.recipe("read-in-full", id)).toMatch(/Read these rows, and no others: doi-10\.1145-1\./)
    await threads.write({ id, columns: [{ id: "m", question: "Method and sample" }] }, agent)
    expect(await threads.recipe("ask-each", id, { column: "Method  and sample" })).toMatch(/The column to fill: m — «Method and sample»/)
    await expect(threads.recipe("group", id, { column: "m" })).rejects.toThrow(/no grouping "m".*new_grouping/)
  })
})

describe("Threads, the user's changes in the log", () => {
  it("records each item the user changed, with both sides, and no line in the history", async () => {
    const { threads, changes, owlit } = setup()
    const { id } = await start(threads)
    const lines = (await threads.history(id)).length
    await threads.edit(id, { op: "remove", item: itemId.row("doi-10.1145-2") }, window)
    await threads.edit(id, { op: "rewrite", item: itemId.cell("doi-10.1145-1", "q"), text: "Lower, I think." }, window)
    await threads.edit(id, { op: "project", project: "Thesis" }, window)
    // How the user looks changes nothing worth an entry
    await threads.edit(id, { op: "view", groupBy: "none" }, window)
    const mine = (await changes.list({ path: id, actor: "p_1234abcd" })).reverse()
    expect(mine.map((c) => [c.action, c.target.part, c.origin.via])).toEqual([
      ["delete", "row:doi-10.1145-2", "editor"],
      // A removed row's answers go with it, each an entry an undo puts back
      ["delete", "cell:doi-10.1145-2:q", "editor"],
      ["update", "cell:doi-10.1145-1:q", "editor"],
      ["update", "project", "editor"],
    ])
    expect(mine[0]!.before).toEqual({ value: expect.objectContaining({ id: "doi-10.1145-2" }) })
    expect(mine[2]!.after).toMatchObject({ value: { text: "Lower, I think." } })
    expect(mine[3]).toMatchObject({ before: { value: "主动提醒研究" }, after: { value: "Thesis" } })
    expect(await threads.history(id)).toHaveLength(lines)
    // What the user did is the thread now
    const kept = JSON.parse(readFileSync(path.join(owlit, "threads", id, "thread.json"), "utf8"))
    expect(kept.rows.map((r: { id: string }) => r.id)).toEqual(["doi-10.1145-1"])
  })
})
