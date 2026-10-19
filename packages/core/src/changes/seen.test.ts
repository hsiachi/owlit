import { RpcErrorCode, unseenOf, type Change, type ChatMessage } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { sha1 } from "../fs-util.ts"
import { knownProfile, ME, MY_OWLIT } from "../test-util.ts"
import { Seen } from "./seen.ts"

const OTHER_PERSON = "p_99999999" as const

const entry = (at: number, target: Change["target"], extra: Partial<Change> = {}): Change => ({ id: `${at}`, at, actor: MY_OWLIT, action: "update", target, origin: { via: "tool" }, ...extra })

const reply = (id: string, status: ChatMessage["status"]): ChatMessage => ({ id, role: "assistant", parts: [], createdAt: 1, status })

describe("Seen", () => {
  it("keeps each person's marks in their own file, and ignores a mark older than the one kept", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-seen-"))
    const seen = new Seen(owlit, () => 100)
    await seen.mark(ME, { kind: "comments", path: "a.md", at: 50 })
    await seen.mark(ME, { kind: "comments", path: "a.md", at: 40 })
    await seen.mark(OTHER_PERSON, { kind: "doc", path: "a.md", hash: "abc", at: 60 })
    await seen.mark(OTHER_PERSON, { kind: "doc", path: "a.md", hash: "older", at: 10 })
    // Read again from disk, as another start of owlit would
    const again = new Seen(owlit)
    expect(await again.get(ME)).toMatchObject({ since: 100, comments: { "a.md": 50 }, docs: {} })
    expect(await again.get(OTHER_PERSON)).toMatchObject({ docs: { "a.md": { hash: "abc", at: 60 } }, comments: {} })
    expect(existsSync(path.join(owlit, "seen", `${ME}.json`))).toBe(true)
  })

  it("marks a thread's first look as a whole once, and its items on screen one by one", async () => {
    const seen = new Seen(mkdtempSync(path.join(tmpdir(), "owlit-seen-")))
    await seen.mark(ME, { kind: "thread", id: "t", items: [], at: 10 })
    await seen.mark(ME, { kind: "thread", id: "t", items: ["row:a"], at: 20 })
    expect((await seen.get(ME, ["threads"])).threads).toEqual({ t: { t: 10, "row:a": 20 } })
  })
})

describe("unseenOf", () => {
  const marks = { since: 0, docs: { "a.md": { hash: "h", at: 10 } }, threads: { t: { t: 10, "row:a": 30 } }, chats: { c1: { message: "m1", at: 10 }, c2: { message: "m2", at: 10 } }, comments: {}, digests: {} }

  it("gives a thread's items changed by someone else after the person's mark on them or on the thread", () => {
    const changes = [
      entry(40, { kind: "thread", path: "t", part: "row:b" }, { action: "create" }),
      entry(25, { kind: "thread", path: "t", part: "cell:a:q" }),
      entry(20, { kind: "thread", path: "t", part: "row:a" }, { action: "create" }),
      entry(35, { kind: "thread", path: "t", part: "memo:s1" }, { actor: ME }),
      entry(36, { kind: "thread", path: "t", part: "column:c1" }, { action: "create" }),
      entry(37, { kind: "thread", path: "never-looked", part: "row:a" }, { action: "create" }),
    ]
    // row:a was seen at 30, after it came; its cell has no mark of its own, so the thread's first look counts
    expect(unseenOf(marks, ME, { changes, chats: [], papers: [] }).changes.map((c) => c.target.part)).toEqual(["row:b", "cell:a:q"])
  })

  it("gives a doc's changes by others after its text was on the person's screen", () => {
    const changes = [entry(30, { kind: "doc", path: "a.md" }), entry(20, { kind: "doc", path: "a.md" }, { actor: ME }), entry(5, { kind: "doc", path: "a.md" }), entry(30, { kind: "doc", path: "b.md" })]
    expect(unseenOf(marks, ME, { changes, chats: [], papers: [] }).changes.map((c) => [c.target.path, c.at])).toEqual([["a.md", 30]])
  })

  it("gives a chat whose last reply ended well after the last message the person saw, never one they never opened", () => {
    const chats = [
      { id: "c1", messages: [reply("m1", "done"), reply("m3", "done")] },
      { id: "c2", messages: [reply("m2", "done")] },
      { id: "c3", messages: [reply("m4", "done")] },
      { id: "c1-stopped", messages: [reply("m5", "cancelled")] },
    ]
    expect(unseenOf({ ...marks, chats: { ...marks.chats, "c1-stopped": { message: "m0", at: 1 } } }, ME, { changes: [], chats, papers: [] }).chats).toEqual(["c1"])
  })
})

describe("seen over RPC", () => {
  const cores: Core[] = []
  afterEach(async () => {
    await Promise.all(cores.splice(0).map((core) => core.dispose()))
  })

  async function setup() {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-seen-rpc-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")) })
    cores.push(core)
    const call = async (method: string, params?: unknown, caller?: Parameters<Core["handle"]>[1]): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { core, root, call }
  }

  it("refuses a program on the socket: an agent has nothing it has seen", async () => {
    const { call } = await setup()
    const agent = { kind: "socket" as const, chatId: "chat-1" }
    await expect(call("seen.get", {}, agent)).rejects.toMatchObject({ code: RpcErrorCode.Forbidden })
    await expect(call("seen.mark", { kind: "comments", path: "a.md" }, agent)).rejects.toMatchObject({ code: RpcErrorCode.Forbidden })
    await expect(call("changes.unseen", {}, agent)).rejects.toMatchObject({ code: RpcErrorCode.Forbidden })
  })

  it("says what Owlit changed in a doc since the person had it on screen, and which paragraphs", async () => {
    const { core, root, call } = await setup()
    const mine = "The method works well.\n\nReplay ratings run lower.\n"
    await call("docs.create", { path: "a.md", content: mine })
    await call("seen.mark", { kind: "doc", path: "a.md", hash: sha1(mine), at: 1 })
    await core.fs.write(path.join(root, "a.md"), "The method works well.\n\nReplay ratings run 0.6 lower, in the same direction.\n", { chatId: "chat-1" })
    const { changes } = await call("changes.unseen", {})
    expect(changes.map((c: Change) => [c.target.path, c.actor])).toEqual([["a.md", MY_OWLIT]])
    expect(await call("changes.since", { path: "a.md", hash: sha1(mine) })).toEqual([{ text: "Replay ratings run 0.6 lower, in the same direction.", actor: MY_OWLIT, at: changes[0].at }])
    // Once on screen again, nothing is new
    await call("seen.mark", { kind: "doc", path: "a.md", hash: sha1(readFileSync(path.join(root, "a.md"), "utf8")) })
    expect((await call("changes.unseen", {})).changes).toEqual([])
  })
})
