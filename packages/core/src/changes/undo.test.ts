import type { Change, UiRequest } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { hunks, merge } from "./hunks.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup(text = "on disk") {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-undo-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "a.md"), text)
  const core = new Core({
    userDataDir: path.join(base, "userData"),
    host: { trash: async (p) => renameSync(p, path.join(base, `trashed-${path.basename(p)}`)) },
  })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  // The chat Owlit's writes here are for
  await call("chats.create", { chat: { id: "chat-1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
  await call("docs.list")
  const read = (rel = "a.md") => readFileSync(path.join(root, rel), "utf8")
  // The person's save in the editor
  const save = async (rel: string, content: string) => call("docs.write", { path: rel, content, expectedModifiedAt: (await call("docs.read", { path: rel })).modifiedAt })
  // Every entry kept for a path, oldest first
  const log = async (rel: string): Promise<Change[]> => (await call("changes.list", { path: rel })).reverse()
  const undo = (id: string): Promise<{ change: Change; left?: string[] }> => call("changes.undo", { id })
  return { core, root, call, read, save, log, undo }
}

describe("hunks", () => {
  it("diffs Chinese by character and other text by word", () => {
    expect(hunks("回放评分更低。", "回放评分略低。")).toEqual([{ from: 4, to: 5, insert: "略" }])
    expect(hunks("ratings run lower", "ratings run much lower")).toEqual([{ from: 12, to: 12, insert: "much " }])
  })

  it("leaves out a hunk that a later edit overlaps or inserts into, and keeps both at an edge", () => {
    const base = "one two three"
    expect(merge(base, hunks(base, "one 2 three"), hunks(base, "one two 3"))).toEqual({ text: "one 2 3", left: [] })
    expect(merge(base, hunks(base, "one 2 three"), hunks(base, "one two, three"))).toEqual({ text: "one 2, three", left: [] })
    expect(merge(base, hunks(base, "one 2 three"), hunks(base, "one deux three"))).toEqual({ text: "one deux three", left: [{ from: 4, to: 7, insert: "2" }] })
    expect(merge(base, hunks(base, "one three"), hunks(base, "one t-w-o three")).left).toEqual([{ from: 4, to: 8, insert: "" }])
  })
})

describe("changes.undo", () => {
  it("takes back a doc change passage by passage, keeping what was written since, Chinese too", async () => {
    const { core, root, read, save, log, undo } = await setup("回放评分更低。\n\nThe method works well.\n")
    await core.fs.write(path.join(root, "a.md"), "回放评分略低。\n\nThe method works well.\n\nOwlit's new paragraph.\n", { chatId: "chat-1" })
    await save("a.md", "回放评分略低。\n\nThe method works, mostly.\n\nOwlit's new paragraph.\n")
    const [write] = await log("a.md")
    const { change, left } = await undo(write!.id)
    expect(read()).toBe("回放评分更低。\n\nThe method works, mostly.\n")
    expect(left).toBeUndefined()
    expect(change).toMatchObject({ actor: expect.stringMatching(/^p_/), action: "update", origin: { via: "editor", chatId: "chat-1" }, undoes: write!.id })
    // The undo undone puts Owlit's passages back, around the person's
    await undo(change.id)
    expect(read()).toBe("回放评分略低。\n\nThe method works, mostly.\n\nOwlit's new paragraph.\n")
  })

  it("takes back one passage of a change, leaving the others, as an undo naming that passage", async () => {
    const { core, root, read, save, log, call } = await setup("First claim.\n\nSecond claim.\n\nThird claim.\n")
    const owlit = "First claim, sharpened.\n\nSecond claim.\n\nThird claim, sharpened.\n"
    await core.fs.write(path.join(root, "a.md"), owlit, { chatId: "chat-1" })
    await save("a.md", owlit.replace("Second", "The second"))
    const [write] = await log("a.md")
    const { change } = await call("changes.undoPart", { id: write!.id, index: 1 })
    expect(read()).toBe("First claim, sharpened.\n\nThe second claim.\n\nThird claim.\n")
    expect(change).toMatchObject({ undoes: write!.id, target: { kind: "doc", path: "a.md", part: "passage:1" }, origin: { chatId: "chat-1" } })
    // The doc's marks keep the first passage, still Owlit's, in its place
    const [proposal] = await call("changes.proposals", { path: "a.md", text: read(), since: 0 })
    expect(proposal.hunks.map((h: { insert: string }) => h.insert)).toEqual([", sharpened", ""])
    // Redo puts the passage back, and the doc marks it again
    await call("changes.undo", { id: change.id })
    expect(read()).toBe("First claim, sharpened.\n\nThe second claim.\n\nThird claim, sharpened.\n")
    const [again] = await call("changes.proposals", { path: "a.md", text: read(), since: 0 })
    expect(again.hunks.map((h: { insert: string }) => h.insert)).toEqual([", sharpened", ", sharpened"])
    // Edited since: left as it is
    await save("a.md", read().replace("First claim, sharpened.", "First claim, honed."))
    await expect(call("changes.undoPart", { id: write!.id, index: 0 })).rejects.toThrow("was edited since")
  })

  it("says how much a doc change changed, and in how many passages as the doc marks them", async () => {
    const { core, root, log, call } = await setup("First claim.\n\nSecond claim.\n\nThird claim.\n")
    await core.fs.write(path.join(root, "a.md"), "First claim, sharpened.\n\nSecond claim.\n\nThird claim, sharpened.\n", { chatId: "chat-1" })
    const [write] = await log("a.md")
    expect(await call("changes.stats", { ids: [write!.id] })).toMatchObject({ unit: "words", added: 2, removed: 0, passages: 2 })
  })

  it("names the passages edited since, which stay as they are, and refuses when none is left", async () => {
    const { core, root, read, save, log, undo } = await setup("First claim.\n\nSecond claim.\n")
    await core.fs.write(path.join(root, "a.md"), "First claim, sharpened.\n\nSecond claim, sharpened.\n")
    await save("a.md", "First claim, quite sharpened.\n\nSecond claim, sharpened.\n")
    const [write] = await log("a.md")
    const { left } = await undo(write!.id)
    expect(read()).toBe("First claim, quite sharpened.\n\nSecond claim.\n")
    expect(left).toEqual([", sharpened"])
    await core.fs.write(path.join(root, "c.md"), "One two.")
    await core.fs.write(path.join(root, "c.md"), "One three.")
    await save("c.md", "One thirty.")
    const [, second] = await log("c.md")
    await expect(undo(second!.id)).rejects.toThrow("Every passage of that change in c.md was edited since, so owlit left it as it is.")
    expect(read("c.md")).toBe("One thirty.")
  })

  it("takes a doc Owlit made to the Trash, unless it was written in since", async () => {
    const { core, root, save, log, undo } = await setup()
    await core.fs.write(path.join(root, "notes/new.md"), "made by the agent")
    const [made] = await log("notes/new.md")
    expect(made!.action).toBe("create")
    const { change } = await undo(made!.id)
    expect(change.action).toBe("delete")
    expect(existsSync(path.join(root, "notes/new.md"))).toBe(false)
    await undo(change.id)
    expect(readFileSync(path.join(root, "notes/new.md"), "utf8")).toBe("made by the agent")

    await core.fs.write(path.join(root, "b.md"), "Owlit's draft")
    await save("b.md", "Owlit's draft, and mine")
    const [create, typed] = await log("b.md")
    // The person's first typing in a new doc is its own entry, not folded into the create
    expect([create!.action, typed!.action]).toEqual(["create", "update"])
    await expect(undo(create!.id)).rejects.toThrow("b.md changed after it was made, so owlit left it where it is.")
  })

  it("puts the result through the editor that has the doc open, as hunks from the editor's text", async () => {
    const { core, root, call, log, undo } = await setup()
    await core.fs.write(path.join(root, "a.md"), "agent text")
    const asked: UiRequest[] = []
    core.onNotify((n) => {
      if (n.method !== "ui.request") return
      const req = n.params as UiRequest
      asked.push(req)
      void call("ui.respond", { requestId: req.requestId, result: req.method === "fs.read" ? { content: "agent text, typed" } : { applied: true } })
    })
    await call("ui.setOpenDocs", { clientId: "w1", paths: ["a.md"] })
    const [write] = await log("a.md")
    await undo(write!.id)
    expect(asked.at(-1)).toMatchObject({ method: "fs.write", params: { path: "a.md", content: "on disk, typed", hunks: [{ from: 0, to: 5, insert: "on" }, { from: 6, to: 10, insert: "disk" }] } })
  })

  it("sets a paper's field back, unless it changed since", async () => {
    const { call, log, undo } = await setup()
    const id = "arxiv-1706.03762"
    await call("library.add", { paper: { id, title: "Attention Is All You Need", authors: ["Ashish Vaswani"], ids: { arxiv: "1706.03762" }, year: 2017 } })
    await call("library.update", { id, patch: { status: "read" } })
    const field = (await log(id)).find((c) => c.target.part === "status")!
    expect(field).toMatchObject({ before: "unread", after: "read" })
    const { change } = await undo(field.id)
    expect((await call("library.list")).papers[0].status).toBe("unread")
    expect(change).toMatchObject({ target: { part: "status" }, before: "read", after: "unread", undoes: field.id })
    await call("library.update", { id, patch: { status: "reading" } })
    await expect(undo(field.id)).rejects.toThrow("The paper's reading status changed since, so owlit left it as it is.")
  })

  it("sets a thread's item back", async () => {
    const { core, call, undo } = await setup()
    const ws = (core as any).workspace
    const { id } = await ws.threads.write({ asked: "Do replay ratings hold?", title: "Replay" }, { kind: "socket", chatId: "c1" })
    await call("threads.edit", { id, edit: { op: "rename", title: "Replay as a method" } })
    const [rename] = await call("changes.list", { target: { kind: "thread", path: id, part: "title" } })
    await undo(rename.id)
    expect((await call("threads.get", { id })).overrides.edits).toEqual({})
  })

  it("takes back a comment's reply alone, and a whole comment with its replies", async () => {
    const { call, log, undo } = await setup()
    const comment = { id: "k1", quote: "disk", prefix: "on ", suffix: "", createdAt: 1, entries: [{ id: "e1", text: "Why?", at: 1 }] }
    await call("comments.add", { path: "a.md", comment })
    await call("comments.put", { path: "a.md", comment: { ...comment, entries: [...comment.entries, { id: "e2", text: "Because.", at: 2 }] } })
    const [made, reply] = await log("a.md")
    expect([made!.target.part, reply!.target.part]).toEqual(["k1", "k1/e2"])
    const { change } = await undo(reply!.id)
    expect((await call("comments.all"))["a.md"][0].entries.map((e: { id: string }) => e.id)).toEqual(["e1"])
    await undo(change.id)
    expect((await call("comments.all"))["a.md"][0].entries.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"])
    await undo(made!.id)
    expect((await call("comments.all"))["a.md"] ?? []).toEqual([])
  })

  it("takes back a memory line, and the undo too", async () => {
    const { call, undo } = await setup()
    await call("memory.put", { kind: "work", text: "Cite as (Author, Year)." })
    const [line] = await call("changes.list", { target: { kind: "memory" } })
    const { change } = await undo(line.id)
    expect((await call("memory.list")).lines).toEqual([])
    await undo(change.id)
    expect((await call("memory.list")).lines.map((l: { text: string }) => l.text)).toEqual(["Cite as (Author, Year)."])
  })
})
