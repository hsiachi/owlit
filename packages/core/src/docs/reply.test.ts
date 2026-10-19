import type { Chat } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { knownProfile, ME, MY_OWLIT, testSearchPath, until } from "../test-util.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

const STORY = "# Story\n\nReplay ratings track the live ones.\n\nThe second claim stands alone.\n"

// A workspace with a doc and one of Owlit's comments on it (left from a chat, as docs_add_comment does),
// its socket up so the fake agent reaches owlit's tools as owlit-mcp would, and the fake agent chosen for
// the work owlit starts
async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-reply-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "story.md"), STORY)
  // A short folder: a Unix socket's path has to fit in about a hundred bytes
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")), socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: ["--socket-dir", socketDir] }, searchPath: testSearchPath })
  cores.push(core)
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
  await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false, role: "reviewer" } })
  await call(
    "comments.add",
    { path: "story.md", comment: { id: "k1", quote: "Replay ratings track the live ones.", prefix: "", suffix: "", entries: [{ id: "e1", text: "They drift apart after a week.", at: 1 }], createdAt: 1 } },
    { kind: "socket", chatId: "c1" },
  )
  const comment = async () => (await call("comments.all"))["story.md"][0]
  // The person replies under it, at the window
  const reply = async (text: string) => {
    const now = await comment()
    await call("comments.put", { path: "story.md", comment: { ...now, entries: [...now.entries, { id: `r${now.entries.length}`, text, at: Date.now() }] } })
  }
  const about = { kind: "comment", id: "story.md#k1" }
  // The chat about the comment, once a turn in it has ended with this many messages
  const ended = (messages: number) =>
    until(
      async () => {
        const [started] = await call("chats.startedFor", { kind: "comment" })
        if (!started || (await call("agents.running")).length) return undefined
        const chat: Chat = await call("chats.get", { id: started.chatId })
        return chat.messages.length === messages && chat.messages.at(-1)!.status !== "streaming" ? chat : undefined
      },
      { timeout: 10_000, what: "Owlit's answer" },
    )
  return { core, call, comment, reply, about, ended }
}

const said = (comment: { entries: { by: string; text: string }[] }) => comment.entries.map((e) => [e.by, e.text])

describe("A reply under Owlit's comment", () => {
  it("is answered in the comment by a turn of the chat about it, and the next reply continues that chat", async () => {
    const { call, comment, reply, about, ended } = await setup()
    await reply("Where does it say so?")
    const first = await ended(2)
    expect(first).toMatchObject({ startedBy: "owlit", about, role: "reviewer" })
    expect(first.messages[0]!.parts[0]).toMatchObject({ text: expect.stringContaining("The user: Where does it say so?") })
    expect(said(await comment())).toEqual([
      [MY_OWLIT, "They drift apart after a week."],
      [ME, "Where does it say so?"],
      [MY_OWLIT, "Answered, 2 entries in."],
    ])
    await reply("And after a month?")
    const second = await ended(4)
    expect(second.id).toBe(first.id)
    expect((await comment()).entries.at(-1)).toMatchObject({ by: MY_OWLIT, text: "Answered, 4 entries in." })
    // Not one of the person's chats
    expect(await call("chats.list")).toEqual([expect.objectContaining({ id: "c1" })])
  })

  it("isn't held behind other work Owlit is doing", async () => {
    const { core, comment, reply, ended } = await setup()
    const busy = await core.startFor({ about: { kind: "paper", id: "doi-10.1-a" }, title: "A digest", recipe: "quiet" })
    await reply("Where does it say so?")
    await until(async () => (await comment()).entries.length === 3, { timeout: 10_000, what: "the answer" })
    expect((await comment()).entries.at(-1)).toMatchObject({ by: MY_OWLIT })
    await core.handle({ jsonrpc: "2.0", id: 1, method: "agents.cancel", params: { chatId: busy.chatId } })
    await ended(2)
  })

  it("corrects Owlit's own comment when the reply shows it wrong: its words replaced, the old kept, the replies left", async () => {
    const { comment, reply, ended } = await setup()
    await reply("Table 2 shows they do for a week. FAKE: correct")
    await ended(2)
    expect((await comment()).entries).toMatchObject([
      { by: MY_OWLIT, text: "The right words, after all.", was: "They drift apart after a week.", editedAt: expect.any(Number) },
      { by: ME, text: "Table 2 shows they do for a week. FAKE: correct" },
    ])
  })

  it("says why when the turn ended without a word in the comment, and Retry is a new turn in that chat", async () => {
    const { call, comment, reply, ended } = await setup()
    await reply("FAKE: silent")
    const chat = await ended(2)
    await until(async () => (await call("chats.get", { id: chat.id })).messages.at(-1).status === "error", { what: "the failure" })
    expect((await call("chats.startedFor", { kind: "comment" }))[0].reply).toMatchObject({ status: "error", error: "Owlit finished without answering in the comment." })
    expect((await comment()).entries).toHaveLength(2)
    expect(await call("chats.tryAgain", { chatId: chat.id })).toEqual({ chatId: chat.id })
    expect((await ended(4)).messages[2]!.parts).toEqual([{ type: "text", text: "Try again." }])
  })
})
