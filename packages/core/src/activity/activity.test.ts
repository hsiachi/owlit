import type { ActivityEvent, RpcNotification } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { ActivityBus } from "./bus.ts"
import { knownProfile, ME } from "../test-util.ts"

const at = 1_790_000_000_000

describe("ActivityBus", () => {
  it("delivers to subscribers of a kind and to catch-all subscribers", () => {
    const bus = new ActivityBus()
    const pages: number[] = []
    const all: string[] = []
    bus.subscribe("paper.dwell", (e) => pages.push(e.page))
    bus.subscribe((e) => all.push(e.kind))
    bus.publish({ kind: "paper.dwell", at, paperId: "p", page: 3, seconds: 5 })
    bus.publish({ kind: "chat.ended", at, chatId: "c" })
    expect(pages).toEqual([3])
    expect(all).toEqual(["paper.dwell", "chat.ended"])
  })

  it("filters by a list of kinds", () => {
    const bus = new ActivityBus()
    const heard: string[] = []
    bus.subscribe(["doc.opened", "doc.edited"], (e) => heard.push(`${e.kind} ${e.path}`))
    bus.publish({ kind: "doc.opened", at, path: "a.md" })
    bus.publish({ kind: "chat.ended", at, chatId: "c" })
    bus.publish({ kind: "doc.edited", at, path: "a.md" })
    expect(heard).toEqual(["doc.opened a.md", "doc.edited a.md"])
  })

  it("stops delivering after unsubscribe, for every kind subscribed", () => {
    const bus = new ActivityBus()
    const heard: string[] = []
    const off = bus.subscribe(["doc.opened", "chat.ended"], (e) => heard.push(e.kind))
    const offAll = bus.subscribe((e) => heard.push(`all ${e.kind}`))
    bus.publish({ kind: "chat.ended", at, chatId: "c" })
    off()
    offAll()
    bus.publish({ kind: "chat.ended", at, chatId: "c" })
    bus.publish({ kind: "doc.opened", at, path: "a.md" })
    expect(heard).toEqual(["chat.ended", "all chat.ended"])
  })

  it("keeps delivering when one listener throws", () => {
    const bus = new ActivityBus()
    const heard: string[] = []
    const error = console.error
    console.error = () => {}
    bus.subscribe("paper.dwell", () => {
      throw new Error("boom")
    })
    bus.subscribe("paper.dwell", (e) => heard.push(String(e.page)))
    bus.publish({ kind: "paper.dwell", at, paperId: "p", page: 5, seconds: 5 })
    console.error = error
    expect(heard).toEqual(["5"])
  })
})

// A visit that reads a paper's digest to its end, long enough to count as read
const readToEnd = (paperId: string, from: number): ActivityEvent[] => [
  { kind: "paper.opened", at: from, paperId },
  { kind: "paper.focus", at: from + 1000, paperId, view: "digest", seconds: 130 },
  { kind: "paper.end", at: from + 2000, paperId, view: "digest" },
  { kind: "paper.closed", at: from + 3000, paperId },
]

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function openCore() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-activity-")))
  const ws = path.join(base, "ws")
  mkdirSync(ws)
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")) })
  cores.push(core)
  const call = async (method: string, params?: unknown) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const journal = path.join(ws, ".owlit/journal.jsonl")
  const lines = () => (existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
  return { core, call, ws, lines }
}

describe("activity.emit and the journal", () => {
  it("journals every event, with the user as actor", async () => {
    const { core, call, ws, lines } = await openCore()
    await call("workspace.open", { path: ws })
    const events: ActivityEvent[] = [
      { kind: "paper.opened", at, paperId: "arxiv-1" },
      { kind: "paper.focus", at: at + 3, paperId: "arxiv-1", view: "pdf", seconds: 30 },
      { kind: "paper.dwell", at: at + 3, paperId: "arxiv-1", page: 3, seconds: 25 },
      { kind: "highlight.added", at: at + 4, paperId: "arxiv-1", highlightId: "h1" },
      { kind: "highlight.removed", at: at + 5, paperId: "arxiv-1", highlightId: "h1" },
      { kind: "paper.marked", at: at + 6, paperId: "arxiv-1", mark: { what: "status", to: "read" } },
      { kind: "paper.closed", at: at + 8, paperId: "arxiv-1" },
      { kind: "doc.opened", at: at + 9, path: "a.md" },
      { kind: "chat.ended", at: at + 10, chatId: "c" },
    ]
    for (const event of events) await call("activity.emit", { event })
    await core["journal"].flush()
    expect(lines()).toEqual(events.map((e) => ({ ...e, actor: ME })))
  })

  it("passes every event to bus listeners", async () => {
    const { core, call, ws } = await openCore()
    await call("workspace.open", { path: ws })
    const heard: string[] = []
    core.activity.subscribe((e) => heard.push(e.kind))
    await call("activity.emit", { event: { kind: "doc.opened", at, path: "a.md" } })
    expect(heard).toEqual(["doc.opened"])
  })

  it("journals nothing while turned off, so a paper read to the end stays as it was; says so to clients", async () => {
    const { core, call, ws, lines } = await openCore()
    await call("workspace.open", { path: ws })
    for (const id of ["p1", "p2"]) await call("library.add", { paper: { id, title: `Paper ${id}`, authors: ["A. Author"], ids: { doi: `10.1/${id}` } } })
    const notes: RpcNotification[] = []
    core.onNotify((n) => notes.push(n))
    const status = async (id: string) => ((await call("library.list")) as { papers: { id: string; status: string }[] }).papers.find((p) => p.id === id)?.status
    expect(await call("activity.setEnabled", { enabled: false })).toEqual({ enabled: false })
    expect(notes.at(-1)).toMatchObject({ method: "settings.changed", params: { activity: { enabled: false } } })

    // Read to the end with the switch off: the read-in-full check reads only the journal
    for (const event of readToEnd("p1", at)) await call("activity.emit", { event })
    await core["journal"].flush()
    expect(lines().filter((l: { actor: string }) => l.actor === ME)).toEqual([])
    // Switched on, the next paper read to the end turns Read; the first stays as it was
    await call("activity.setEnabled", { enabled: true })
    for (const event of readToEnd("p2", at + 10_000)) await call("activity.emit", { event })
    await vi.waitFor(async () => expect(await status("p2")).toBe("read"))
    expect(await status("p1")).toBe("unread")
    expect(notes.filter((n) => n.method === "library.readToEnd").map((n) => (n.params as { paperId: string }).paperId)).toEqual(["p2"])

    // The switch is a machine setting: it survives a restart
    await call("activity.setEnabled", { enabled: false })
    const next = new Core({ userDataDir: core["options"].userDataDir })
    expect(await next.settings.get()).toMatchObject({ activity: { enabled: false } })
  })

  it("drops events when no workspace is open", async () => {
    const { core, call } = await openCore()
    const heard: string[] = []
    core.activity.subscribe((e) => heard.push(e.kind))
    expect(await call("activity.emit", { event: { kind: "doc.edited", at, path: "a.md" } })).toBeNull()
    expect(heard).toEqual([])
  })

  it("rejects malformed events", async () => {
    const { call, ws } = await openCore()
    await call("workspace.open", { path: ws })
    await expect(call("activity.emit", { event: { kind: "doc.edited", at } })).rejects.toMatchObject({ code: -32602 })
    await expect(call("activity.emit", { event: { kind: "doc.typed", at, path: "a" } })).rejects.toMatchObject({ code: -32602 })
    await expect(call("activity.emit", { event: { kind: "paper.focus", at, paperId: "p", view: "pdf", seconds: 0 } })).rejects.toMatchObject({ code: -32602 })
    await expect(call("activity.emit", { event: { kind: "paper.marked", at, paperId: "p", mark: { what: "status", to: "done" } } })).rejects.toMatchObject({ code: -32602 })
  })
})

describe("read from evidence", () => {
  const visit = (paperId: string, from: number, digestSeconds: number, end: boolean): ActivityEvent[] => [
    { kind: "paper.opened", at: from, paperId },
    { kind: "paper.focus", at: from + 1000, paperId, view: "digest", seconds: digestSeconds },
    ...(end ? [{ kind: "paper.end", at: from + 2000, paperId, view: "digest" } as const] : []),
    { kind: "paper.closed", at: from + 3000, paperId },
  ]

  it("sets a paper Read when its digest was read to the end, once, and says how far each paper got", async () => {
    const { core, call, ws } = await openCore()
    await call("workspace.open", { path: ws })
    for (const id of ["p1", "p2", "p3"]) await call("library.add", { paper: { id, title: `Paper ${id}`, authors: ["A. Author"], ids: { doi: `10.1/${id}` } } })
    const notes: RpcNotification[] = []
    core.onNotify((n) => notes.push(n))
    const status = async (id: string) => ((await call("library.list")) as { papers: { id: string; status: string }[] }).papers.find((p) => p.id === id)?.status

    // Scrolled to the end too soon is looked at; the end with two minutes on the digest is read
    for (const event of visit("p2", at, 30, true)) await call("activity.emit", { event })
    for (const event of visit("p1", at + 10_000, 130, true)) await call("activity.emit", { event })
    await vi.waitFor(async () => expect(await status("p1")).toBe("read"))
    expect(notes.find((n) => n.method === "library.readToEnd")).toMatchObject({ params: { paperId: "p1", from: "unread" } })
    expect(await status("p2")).toBe("unread")

    const traces = await call("library.trace", { ids: ["p1", "p2", "p3"] })
    expect(traces).toEqual({
      p1: { state: "read", pdfSeconds: 0, digestSeconds: 130, pages: [] },
      p2: { state: "looked", pdfSeconds: 0, digestSeconds: 30, pages: [] },
      p3: { state: "none", pdfSeconds: 0, digestSeconds: 0, pages: [] },
    })

    // Taken back by the person, it stays as they set it on the next visit
    await call("library.update", { id: "p1", patch: { status: "reading" } })
    for (const event of visit("p1", at + 20_000, 60, true)) await call("activity.emit", { event })
    await core["journal"].flush()
    await vi.waitFor(() => expect(notes.filter((n) => n.method === "library.readToEnd")).toHaveLength(1))
    expect(await status("p1")).toBe("reading")
  })
})
