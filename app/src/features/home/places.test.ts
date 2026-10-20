import type { ActorId, Change, Chat, PersonId, Thread, Unseen, WorkspaceFile } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { chatPlace, docPlaces, placeNews, threadPlace, type Place } from "./places"

const ME: PersonId = "p_00000001"
const RUTH: PersonId = "p_00000002"
const OWLIT = "o_00000001" as const

const file = (path: string, content = "First.\n\nLast paragraph.", modifiedAt = 50): WorkspaceFile => ({ id: path, path, content, createdAt: 1, modifiedAt }) as WorkspaceFile
let n = 0
const change = (path: string, actor: ActorId, at: number, extra: Partial<Change> = {}): Change => ({ id: `c${n++}`, at, actor, action: "update", target: { kind: "doc", path }, origin: { via: "editor" }, ...extra })
const newestFirst = (changes: Change[]) => changes.sort((a, b) => b.at - a.at)
const NONE: Unseen = { changes: [], chats: [], digests: [] }
const names = (actor: ActorId) => (actor === RUTH ? "Ruth" : actor === OWLIT ? "Owlit" : "someone")

describe("docPlaces", () => {
  it("counts a doc only once the person wrote in it, here or in the log", () => {
    const files = [file("synced.md", "x", 900), file("logged.md"), file("cursor.md"), file("figure.png")]
    const places = docPlaces(files, [{ path: "cursor.md", at: 30, head: 0 }], newestFirst([change("logged.md", ME, 20), change("synced.md", "other", 900)]), ME)
    expect(places.map((p) => p.id).sort()).toEqual(["cursor.md", "logged.md"])
    expect(places.find((p) => p.id === "logged.md")).toMatchObject({ did: "edited", at: 20, words: "Last paragraph." })
  })

  it("says who made a later change: Owlit, another person, another program", () => {
    const files = [file("a.md"), file("b.md"), file("c.md"), file("d.md")]
    const changes = newestFirst([
      change("a.md", ME, 10),
      change("a.md", RUTH, 40),
      change("b.md", ME, 10),
      change("b.md", "other", 30),
      change("c.md", ME, 10),
      change("c.md", OWLIT, 20),
      change("d.md", OWLIT, 5, { action: "create" }),
      change("d.md", ME, 8),
    ])
    const by = Object.fromEntries(docPlaces(files, [], changes, ME).map((p) => [p.id, p]))
    expect(by["a.md"]).toMatchObject({ did: "others-edited", by: RUTH, at: 40 })
    expect(by["b.md"]).toMatchObject({ did: "others-edited", by: "other", at: 30 })
    expect(by["c.md"]).toMatchObject({ did: "owlit-edited", at: 20 })
    expect(by["c.md"]!.by).toBeUndefined()
    // The person wrote after Owlit made it: theirs
    expect(by["d.md"]).toMatchObject({ did: "edited", at: 8 })
  })

  it("quotes the paragraph the cursor was in when the trail has it", () => {
    const [place] = docPlaces([file("a.md", "One.\n\nTwo.\n\nThree.")], [{ path: "a.md", at: 5, head: 6 }], [], ME)
    expect(place!.words).toBe("Two.")
  })
})

const thread = (over: Partial<Thread> = {}): Thread =>
  ({
    version: 2,
    id: "t1",
    title: "Reading tools",
    asked: { text: "What tools help people read papers?", at: 100 },
    project: "lit-review",
    sources: [],
    memo: [
      { id: "m1", text: "Most tools [annotate](owlit://paper/p1) the PDF." },
      { id: "m2", text: "Second." },
    ],
    columns: [],
    rows: [],
    createdAt: 100,
    updatedAt: 900,
    overrides: { edits: {}, removed: {}, placed: {}, merged: {} },
    ...over,
  }) as Thread

describe("threadPlace", () => {
  it("is titled by the question, dated by the person's last act, and quotes the memo's first sentence", () => {
    const place = threadPlace(thread({ alsoAsked: [{ text: "And for code?", at: 300 }], overrides: { edits: {}, removed: { "row:p2": { text: "x", at: 450 } }, placed: {}, merged: {} } }))
    expect(place).toMatchObject({ kind: "thread", title: "What tools help people read papers?", at: 450, to: "/threads/t1", detail: "lit-review", words: "Most tools annotate the PDF." })
  })

  it("quotes the memo as the person left it", () => {
    const place = threadPlace(thread({ overrides: { edits: {}, removed: { "memo:m1": { text: "x", at: 200 } }, placed: {}, merged: {} } }))
    expect(place.words).toBe("Second.")
    expect(place.at).toBe(200)
  })
})

describe("chatPlace", () => {
  it("counts a chat once the person sent something", () => {
    const chat = (messages: unknown[]) => ({ id: "c", title: "Q", messages }) as unknown as Chat
    expect(chatPlace(chat([]))).toEqual([])
    expect(chatPlace(chat([{ id: "m", role: "user", createdAt: 7, parts: [{ type: "text", text: "Hello" }] }]))[0]).toMatchObject({ kind: "chat", at: 7 })
  })
})

describe("placeNews", () => {
  const place = (kind: Place["kind"], id: string): Place => ({ kind, id, key: id, title: id, detail: "", at: 0, to: "/", did: null })
  const threadChange = (part: string, action: Change["action"] = "update", actor: ActorId = OWLIT): Change => ({ id: `c${n++}`, at: 1, actor, action, target: { kind: "thread", path: "t1", part }, origin: { via: "tool" } })

  it("counts a thread's new papers, else says who changed it", () => {
    expect(placeNews(place("thread", "t1"), { ...NONE, changes: [threadChange("row:a", "create"), threadChange("row:b", "create"), threadChange("memo:m1")] }, names)?.words).toBe("2 new papers")
    expect(placeNews(place("thread", "t1"), { ...NONE, changes: [threadChange("memo:m1")] }, names)?.words).toBe("Owlit edited")
    // A column added carries no dot
    expect(placeNews(place("thread", "t1"), { ...NONE, changes: [threadChange("column:c")] }, names)).toBeNull()
  })

  it("puts a doc's comments before its edits, with the warning dot", () => {
    const comment = (id: string): Change => ({ id: `c${n++}`, at: 1, actor: RUTH, action: "create", target: { kind: "comment", path: "a.md", part: id }, origin: { via: "watcher" } })
    const unseen = { ...NONE, changes: [comment("k1"), comment("k1/e2"), comment("k2"), change("a.md", RUTH, 1)] }
    expect(placeNews(place("doc", "a.md"), unseen, names)).toEqual({ words: "2 comments", comment: true })
    expect(placeNews(place("doc", "a.md"), { ...NONE, changes: [change("a.md", RUTH, 1)] }, names)).toEqual({ words: "Ruth edited" })
    expect(placeNews(place("doc", "a.md"), { ...NONE, changes: [change("a.md", "other", 1)] }, names)).toEqual({ words: "Changed outside owlit" })
    expect(placeNews(place("doc", "b.md"), unseen, names)).toBeNull()
  })

  it("marks a finished reply and a new digest", () => {
    expect(placeNews(place("chat", "c1"), { ...NONE, chats: ["c1"] }, names)?.words).toBe("Owlit finished")
    expect(placeNews(place("paper", "p1"), { ...NONE, digests: ["p1"] }, names)?.words).toBe("Digest ready")
    expect(placeNews(place("paper", "p2"), { ...NONE, digests: ["p1"] }, names)).toBeNull()
  })
})
