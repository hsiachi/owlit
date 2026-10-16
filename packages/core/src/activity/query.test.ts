import type { ActivityEvent, AgentRecord, JournalEntry } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { answerActivity, MAX_LINES } from "./query.ts"

const MIN = 60_000
const DAY = 86_400_000
const now = 1_790_000_000_000
const user = (e: ActivityEvent): JournalEntry => ({ ...e, actor: "user" })
const agent = (e: AgentRecord): JournalEntry => ({ ...e, actor: "agent" })
const names = { paper: (id: string) => ({ p1: "Paper One", p2: "Paper Two" })[id], chat: (id: string) => ({ c1: "About tools" })[id] }

// Two days ago the user read p1 for a while; yesterday glanced at p2, wrote a doc and talked in a chat;
// an agent changed the doc
const journal: JournalEntry[] = [
  user({ kind: "paper.opened", at: now - 2 * DAY, paperId: "p1" }),
  user({ kind: "paper.focus", at: now - 2 * DAY + 30_000, paperId: "p1", view: "pdf", seconds: 30 }),
  user({ kind: "paper.dwell", at: now - 2 * DAY + 30_000, paperId: "p1", page: 3, seconds: 30 }),
  user({ kind: "paper.focus", at: now - 2 * DAY + 60_000, paperId: "p1", view: "pdf", seconds: 30 }),
  user({ kind: "paper.dwell", at: now - 2 * DAY + 60_000, paperId: "p1", page: 4, seconds: 20 }),
  user({ kind: "paper.focus", at: now - 2 * DAY + 90_000, paperId: "p1", view: "digest", seconds: 30 }),
  user({ kind: "highlight.added", at: now - 2 * DAY + 91_000, paperId: "p1", highlightId: "h1" }),
  user({ kind: "paper.marked", at: now - 2 * DAY + 92_000, paperId: "p1", mark: { what: "starred", to: true } }),
  user({ kind: "paper.closed", at: now - 2 * DAY + 95_000, paperId: "p1" }),
  user({ kind: "paper.opened", at: now - DAY, paperId: "p2" }),
  user({ kind: "paper.closed", at: now - DAY + 3000, paperId: "p2" }),
  user({ kind: "doc.opened", at: now - DAY + 5 * MIN, path: "notes/a.md" }),
  user({ kind: "doc.edited", at: now - DAY + 6 * MIN, path: "notes/a.md" }),
  user({ kind: "doc.edited", at: now - DAY + 7 * MIN, path: "notes/a.md" }),
  user({ kind: "doc.edited", at: now - DAY + 8 * MIN, path: "notes/a.md" }),
  agent({ kind: "agent.wrote", at: now - DAY + 9 * MIN, path: "notes/a.md", versionId: "v1", chatId: "c1" }),
  agent({ kind: "agent.wrote", at: now - DAY + 9 * MIN, path: ".owlit/threads/x/thread.json", versionId: "v2" }),
  user({ kind: "chat.ended", at: now - DAY + 10 * MIN, chatId: "c1" }),
]

describe("answerActivity", () => {
  it("recent: each thing touched, newest first, with facts", () => {
    const { items, since } = answerActivity(journal, { mode: "recent" }, { now, names })
    expect(since).toBe(now - 14 * DAY)
    expect(items!.map((i) => (i.kind === "doc" ? i.path : i.id))).toEqual(["c1", "notes/a.md", "p2", "p1"])
    expect(items!.find((i) => i.kind === "paper" && i.id === "p1")).toMatchObject({
      title: "Paper One",
      visits: 1,
      pdfSeconds: 60,
      digestSeconds: 30,
      pages: { 3: 30, 4: 20 },
      highlights: 1,
      starred: true,
      read: true,
    })
    expect(items!.find((i) => i.kind === "doc")).toMatchObject({ opens: 1, edits: 3, agentEdits: 1 })
    expect(items!.find((i) => i.kind === "chat")).toMatchObject({ title: "About tools", sessions: 1 })
  })

  it("top: what took the user's time and hand, leaving out what was only opened", () => {
    const { items } = answerActivity(journal, { mode: "top", since: now - 3 * DAY }, { now, names })
    expect(items!.map((i) => (i.kind === "doc" ? i.path : i.id))).toEqual(["p1", "notes/a.md", "c1"])
  })

  it("looks back only as far as asked", () => {
    expect(answerActivity(journal, { mode: "recent", since: now - DAY - 1 }, { now, names }).items!.some((i) => i.kind === "paper" && i.id === "p1")).toBe(false)
    expect(answerActivity(journal, { mode: "top" }, { now: now + 30 * DAY, names }).items).toEqual([])
  })

  it("log: a visit to a paper is one line, a run of edits one line with a count, owlit's own state left out", () => {
    const { lines } = answerActivity(journal, { mode: "log", since: now - 3 * DAY }, { now, names })
    expect(lines!.map((l) => [l.actor, l.what, l.paper?.id ?? l.doc ?? l.chat?.id, l.times ?? 1])).toEqual([
      ["user", "read", "p1", 1],
      ["user", "highlighted", "p1", 1],
      ["user", "starred", "p1", 1],
      ["user", "opened", "p2", 1],
      ["user", "opened", "notes/a.md", 1],
      ["user", "edited", "notes/a.md", 3],
      ["agent", "changed", "notes/a.md", 1],
      ["user", "wrote in the chat", "c1", 1],
    ])
    expect(lines![0]).toMatchObject({ seconds: 90, pages: [3, 4], detail: "30 s of it on the digest" })
    expect(answerActivity(journal, { mode: "log", since: now - 3 * DAY, actor: "agent" }, { now, names }).lines!.map((l) => l.what)).toEqual(["changed"])
  })

  it("log: keeps the latest lines within the limit and says there are more", () => {
    const many = Array.from({ length: 500 }, (_, i) => user({ kind: "highlight.added", at: now - 1000 + i, paperId: `p${i}`, highlightId: `h${i}` }))
    const answer = answerActivity(many, { mode: "log", limit: 1000 }, { now, names })
    expect(answer.lines).toHaveLength(MAX_LINES)
    expect(answer.lines!.at(-1)!.paper!.id).toBe("p499")
    expect(answer.more).toBe(true)
  })

  it("of: one paper's whole history, under its new id too", () => {
    const moved = [user({ kind: "paper.focus", at: now - 3 * DAY, paperId: "local-1", view: "pdf", seconds: 40 }), ...journal]
    const { items, lines } = answerActivity(moved, { mode: "of", paper: "p1" }, { now, names, alias: (id) => (id === "local-1" ? "p1" : id) })
    expect(items).toHaveLength(1)
    expect(items![0]).toMatchObject({ kind: "paper", id: "p1", pdfSeconds: 100 })
    expect(lines!.map((l) => l.what)).toEqual(["read", "read", "highlighted", "starred"])
  })

  it("of: a doc's history has the user's edits and what agents changed", () => {
    const { items, lines } = answerActivity(journal, { mode: "of", doc: "notes/a.md" }, { now, names })
    expect(items).toEqual([expect.objectContaining({ kind: "doc", edits: 3, agentEdits: 1 })])
    expect(lines!.map((l) => `${l.actor} ${l.what}`)).toEqual(["user opened", "user edited", "agent changed"])
  })

  it("answers with nothing when nothing was recorded", () => {
    expect(answerActivity([], { mode: "recent" }, { now, names })).toEqual({ since: now - 14 * DAY, items: [] })
    expect(answerActivity([], { mode: "log" }, { now, names })).toEqual({ since: now - 7 * DAY, lines: [] })
    expect(answerActivity([], { mode: "of", chat: "c9" }, { now, names })).toEqual({ items: [], lines: [] })
  })
})

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

describe("activity.query", () => {
  async function open() {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-query-")))
    const root = path.join(base, "ws")
    mkdirSync(path.join(root, ".owlit"), { recursive: true })
    const core = new Core({ userDataDir: path.join(base, "userData") })
    cores.push(core)
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { call, root }
  }

  it("gives a paper's history with the sentences Owlit's answers cited from it", async () => {
    const { call, root } = await open()
    const at = Date.now() - 60_000
    writeFileSync(path.join(root, ".owlit/journal.jsonl"), JSON.stringify(user({ kind: "paper.focus", at, paperId: "p1", view: "pdf", seconds: 30 })) + "\n")
    await call("chats.create", { chat: { id: "c1", title: "Why", createdAt: at, updatedAt: at, pinned: false } })
    await call("chats.appendMessage", { id: "c1", message: { id: "a1", role: "assistant", createdAt: at, parts: [{ type: "text", text: `[P](owlit://library/p1#p4 "A sentence.")` }] } })
    const answer = await call("activity.query", { query: { mode: "of", paper: "p1" } })
    expect(answer).toMatchObject({ recording: true, items: [{ kind: "paper", id: "p1", title: "p1", pdfSeconds: 30 }], cited: [{ quote: "A sentence.", page: 4, chatId: "c1", chatTitle: "Why" }] })
  })

  it("says nothing while recording is turned off", async () => {
    const { call, root } = await open()
    writeFileSync(path.join(root, ".owlit/journal.jsonl"), JSON.stringify(user({ kind: "doc.edited", at: Date.now(), path: "a.md" })) + "\n")
    await call("activity.setEnabled", { enabled: false })
    expect(await call("activity.query", { query: { mode: "recent" } })).toEqual({ recording: false })
  })

  it("rejects a question it can't answer", async () => {
    const { call } = await open()
    await expect(call("activity.query", { query: { mode: "of" } })).rejects.toMatchObject({ code: -32602 })
    await expect(call("activity.query", { query: { mode: "of", paper: "p1", doc: "a.md" } })).rejects.toMatchObject({ code: -32602 })
    await expect(call("activity.query", { query: { mode: "everything" } })).rejects.toMatchObject({ code: -32602 })
  })
})
