import { itemId, readInFull, RpcErrorCode, type Change, type Notifications, type ThreadPaper } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
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
    { recorder, changes },
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
// Owlit working for a chat: the chat a write names is the caller's
const chat = (chatId: string) => ({ kind: "owlit" as const, chatId })
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
  }, chat("chat-1"))

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
    await threads.edit(id, { op: "project", project: "Thesis" }, window)
    await threads.edit(id, { op: "view", groupBy: "none" }, window)
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
    // A group Owlit takes out of the grouping takes its papers out of it
    await threads.write({ id, groups: [] }, agent)
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
    expect((await threads.history(id)).some((l) => l.items?.includes("view"))).toBe(false)
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
    await threads.write({ id, asked: "回放评价和当场评价，偏差方向有没有研究？", rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower in retrospect.", depth: "abstract" } } }], chatId: "chat-2" }, chat("chat-2"))
    expect((await threads.get(id)).alsoAsked).toMatchObject([{ text: "回放评价和当场评价，偏差方向有没有研究？", chatId: "chat-2" }])
    expect(wrote.at(-1)).toMatchObject({ change: { action: "create", target: { kind: "thread", path: id, part: "alsoAsked" } }, thread: { rows: ["doi-10.1145-3"], asked: "回放评价和当场评价，偏差方向有没有研究？" } })
  })

})

describe("Threads, the user's side", () => {
  it("gives a row Owlit added a dot, and none to the user's own changes", async () => {
    const { threads, seen, dots } = setup()
    const { id } = await start(threads)
    await seen.mark(ME, { kind: "thread", id, items: [] })
    await threads.edit(id, { op: "project", project: "Thesis" }, window)
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
  it("takes back an agent's write item by item, keeping what a later write did since", async () => {
    const { threads, changes, wrote } = setup()
    const { id } = await start(threads)
    await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Lower.", depth: "abstract" } } }], chatId: "chat-2" }, chat("chat-2"))
    await threads.write({ id, title: "Replay as a method", chatId: "chat-3" }, chat("chat-3"))
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower by 0.6, from the abstract.", depth: "abstract" } } }], chatId: "chat-3" }, chat("chat-3"))
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

  it("undoes one write whole, going on past an item a later write changed and naming it", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    await threads.write(
      {
        id,
        report: "Replay runs lower: [Fernández](owlit://library/doi-10.1145-1).",
        rows: [
          { id: "doi-10.1145-1", cells: { q: { text: "Lower by 0.6.", depth: "abstract" } } },
          { id: "doi-10.1145-3", is: "Diary study", cells: { q: { text: "Recall ran lower.", depth: "abstract" } } },
        ],
        chatId: "chat-2",
      },
      chat("chat-2"),
    )
    await threads.write({ id, rows: [{ id: "doi-10.1145-1", cells: { q: { text: "Lower by 0.6, in two studies.", depth: "abstract" } } }], chatId: "chat-3" }, chat("chat-3"))
    // As the chat's card does it: each entry of the write, newest first, on past one that is refused
    const left: string[] = []
    for (const e of await writeOf(changes, id, "chat-2")) {
      await undo(threads, e).catch((error: RpcFailure) => {
        expect(error.code).toBe(RpcErrorCode.Conflict)
        left.push(e.target.part!)
      })
    }
    expect(left).toEqual([itemId.cell("doi-10.1145-1", "q")])
    const c = await threads.get(id)
    expect(c.rows.map((r) => [r.id, r.cells.q?.text])).toEqual([
      ["doi-10.1145-1", "Lower by 0.6, in two studies."],
      ["doi-10.1145-2", "Own explanations recover more."],
    ])
    expect(c.report).toBe("Two precedents had wearers replay their own footage. Replay ratings run lower than live ones.")
  })

  it("puts a thread an agent started into the trash, and back", async () => {
    const { threads, changes } = setup()
    const { id } = await start(threads)
    const [first, ...rest] = (await changes.list({ path: id })).reverse()
    expect(first).toMatchObject({ action: "create", target: { kind: "thread", path: id } })
    // Then each item it put in, in the same write, so About and the chat's card read what it added
    expect(rest.map((e) => [e.target.part, e.origin.writeId])).toEqual(
      ["row:doi-10.1145-1", "cell:doi-10.1145-1:q", "row:doi-10.1145-2", "cell:doi-10.1145-2:q", "report", "one"].map((part) => [part, first!.origin.writeId]),
    )
    const undone = await undo(threads, first!)
    expect(undone).toMatchObject({ actor: "p_1234abcd", action: "delete", undoes: first!.id })
    expect(await threads.list()).toEqual([])
    await undo(threads, undone)
    expect((await threads.list()).map((c) => c.id)).toEqual([id])
  })
})

describe("Threads, About", () => {
  // What chats searched, as the Library logs it
  function withSearches() {
    const searched: { by: string; at: number; query: string; source: string; results: string[] }[] = []
    const ctx = setup({ searches: async (by, since) => searched.filter((s) => s.by === by && s.at >= since) })
    return { ...ctx, searched }
  }

  it("tells a chat's batches apart, each with its searches, and a later chat's with the question it was for", async () => {
    const { threads, searched } = withSearches()
    searched.push(
      { by: "chat:chat-1", at: Date.now(), query: "replay ratings validity", source: "openalex", results: ["doi-10.1145-1", "doi-10.1145-9"] },
      { by: "chat:chat-1", at: Date.now(), query: "cited_by of doi-10.1145-1", source: "openalex", results: ["doi-10.1145-8"] },
    )
    const { id } = await start(threads, { note: "Semantic Scholar wasn't reachable." })
    searched.push({ by: "chat:c9", at: Date.now(), query: "lifelog video recall", source: "arxiv", results: ["doi-10.1145-3"] })
    await threads.write({ id, asked: "Does lifelog video help recall?", rows: [{ id: "doi-10.1145-3", cells: { q: { text: "It helps.", depth: "abstract" } } }], chatId: "c9" }, chat("c9"))

    const [gathered, typed, ...rest] = await threads.about(id)
    expect(rest).toEqual([])
    expect(gathered).toMatchObject({ trigger: "chat", chatId: "chat-1", added: 2, answered: 0, notes: ["Semantic Scholar wasn't reachable."] })
    expect(gathered!.searches).toEqual([
      { kind: "search", query: "replay ratings validity", source: "openalex", found: 2, kept: 1 },
      { kind: "cited_by", query: "doi-10.1145-1", of: "Replay or Live? Validity of Retrospective Ratings", source: "openalex", found: 1, kept: 0 },
    ])
    expect(typed).toMatchObject({ trigger: "chat", chatId: "c9", asked: "Does lifelog video help recall?", added: 1, searches: [{ query: "lifelog video recall", kept: 1 }] })
  })

  it("shows a write that was undone without its rows, and with them again after Redo", async () => {
    const { threads, changes, searched } = withSearches()
    const { id } = await start(threads)
    searched.push({ by: "chat:chat-2", at: Date.now(), query: "experience sampling recall", source: "s2", results: ["doi-10.1145-3"] })
    await threads.write({ id, rows: [{ id: "doi-10.1145-3", cells: { q: { text: "Recall ran lower.", depth: "abstract" } } }, { id: "doi-10.1145-1", cells: { q: { text: "Lower by 0.6.", depth: "abstract" } } }], chatId: "chat-2" }, chat("chat-2"))
    expect((await threads.about(id)).at(-1)).toMatchObject({ chatId: "chat-2", added: 1, answered: 1, searches: [{ kept: 1 }] })
    const undos = []
    for (const e of await writeOf(changes, id, "chat-2")) undos.push(await undo(threads, e))
    expect((await threads.about(id)).at(-1)).toMatchObject({ chatId: "chat-2", added: 0, answered: 0, searches: [{ query: "experience sampling recall", kept: 0 }] })
    for (const u of undos.reverse()) await undo(threads, u)
    expect((await threads.about(id)).at(-1)).toMatchObject({ chatId: "chat-2", added: 1, answered: 1 })
  })

  it("reads lines from before the change log as they were written", async () => {
    const { threads, owlit } = setup()
    const { id } = await start(threads)
    const c = await threads.get(id)
    // A write the log never had: a gathering chat's, its rows named on the line
    writeFileSync(
      path.join(owlit, "threads", id, "history.jsonl"),
      JSON.stringify({ at: 10, by: "chat:owlit-1", recipe: "gather", items: ["row:doi-10.1145-2", "cell:doi-10.1145-1:q"], added: ["doi-10.1145-2"], searches: [{ at: 9, query: "replay", source: "openalex", results: ["doi-10.1145-2"] }] }) + "\n",
    )
    const [old] = await threads.about(id)
    expect(old).toMatchObject({ at: 10, trigger: "gather", added: 1, answered: 1, searches: [{ query: "replay", kept: 1 }] })
    expect(c.rows).toHaveLength(2)
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

describe("Threads, the user's changes in the log", () => {
  it("records the project the user moved it to, with both sides, and no line in the history", async () => {
    const { threads, changes, owlit } = setup()
    const { id } = await start(threads)
    const lines = (await threads.history(id)).length
    await threads.edit(id, { op: "project", project: "Thesis" }, window)
    // How the user looks changes nothing worth an entry
    await threads.edit(id, { op: "view", groupBy: "none" }, window)
    const mine = (await changes.list({ path: id, actor: "p_1234abcd" })).reverse()
    expect(mine.map((c) => [c.action, c.target.part, c.origin.via])).toEqual([["update", "project", "editor"]])
    expect(mine[0]).toMatchObject({ before: { value: "主动提醒研究" }, after: { value: "Thesis" } })
    expect(await threads.history(id)).toHaveLength(lines)
    const kept = JSON.parse(readFileSync(path.join(owlit, "threads", id, "thread.json"), "utf8"))
    expect(kept.project).toBe("Thesis")
  })
})
