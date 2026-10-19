import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { eventually } from "../test-util.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-chats-")))
  const root = path.join(base, "ws")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(root)
  const open = async () => {
    const core = new Core({ userDataDir: path.join(base, "userData") })
    cores.push(core)
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { core, call }
  }
  const chatsDir = path.join(root, ".owlit/chats")
  return { root, open, chatsDir }
}

const summary = (id: string, t: number) => ({ id, title: "New chat", createdAt: t, updatedAt: t, pinned: false, connectorId: "claude-code" })
const msg = (id: string, role: "user" | "assistant", t: number, extra: object = {}) => ({ id, role, createdAt: t, parts: [{ type: "text", text: id }], ...extra })

describe("chats", () => {
  it("keeps chats, titles, pins and messages across a restart", async () => {
    const { open } = await setup()
    const first = await open()
    await first.call("chats.create", { chat: summary("a", 1) })
    await first.call("chats.create", { chat: summary("b", 2) })
    await first.call("chats.appendMessage", { id: "a", message: msg("u1", "user", 10) })
    await first.call("chats.update", { id: "a", patch: { title: "About tools" } })
    await first.call("chats.update", { id: "b", patch: { pinned: true } })
    await first.core.dispose()

    const second = await open()
    const list = await second.call("chats.list")
    expect(list.map((c: any) => [c.id, c.title, c.pinned])).toEqual([
      ["a", "About tools", false],
      ["b", "New chat", true],
    ])
    expect((await second.call("chats.get", { id: "a" })).messages.map((m: any) => m.id)).toEqual(["u1"])
  })

  it("writes a streaming answer a moment later, and at once when final", async () => {
    const { open, chatsDir } = await setup()
    const { call } = await open()
    await call("chats.create", { chat: summary("a", 1) })
    await call("chats.appendMessage", { id: "a", message: msg("r1", "assistant", 2, { status: "streaming" }) })
    await call("chats.patchMessage", { id: "a", message: msg("r1", "assistant", 2, { status: "streaming", parts: [{ type: "text", text: "partial" }] }) })
    const onDisk = () => JSON.parse(readFileSync(path.join(chatsDir, "a.json"), "utf8")).messages[0]
    expect(onDisk()).toBeUndefined()
    await eventually(() => expect(onDisk()?.parts[0].text).toBe("partial"))
    await call("chats.patchMessage", { id: "a", message: msg("r1", "assistant", 2, { status: "done" }), final: true })
    expect(onDisk().status).toBe("done")
  })

  it("brings a message cut off mid-stream back as cancelled", async () => {
    const { open, chatsDir } = await setup()
    const first = await open()
    await first.call("chats.create", { chat: summary("a", 1) })
    await first.call("chats.appendMessage", { id: "a", message: msg("r1", "assistant", 2, { status: "streaming" }) })
    const onDisk = () => JSON.parse(readFileSync(path.join(chatsDir, "a.json"), "utf8")).messages[0]
    await eventually(() => expect(onDisk()?.status).toBe("streaming"))
    // As if the process had been killed: nothing flushed at exit
    const second = await open().catch(async () => {
      await first.core.dispose()
      return open()
    })
    expect((await second.call("chats.get", { id: "a" })).messages[0].status).toBe("cancelled")
  })

  it("moves a deleted chat to the trash", async () => {
    const { open, root, chatsDir } = await setup()
    const { call } = await open()
    await call("chats.create", { chat: summary("a", 1) })
    await call("chats.delete", { id: "a" })
    expect(await call("chats.list")).toEqual([])
    expect(existsSync(path.join(chatsDir, "a.json"))).toBe(false)
    expect(readdirSync(path.join(root, ".owlit/trash")).some((n) => n.endsWith("-chat-a"))).toBe(true)
  })

  it("brings back a chat trashed by an older build, which kept only its JSON", async () => {
    const { open, root } = await setup()
    const { call } = await open()
    const { mkdirSync } = await import("node:fs")
    mkdirSync(path.join(root, ".owlit/trash"), { recursive: true })
    writeFileSync(path.join(root, ".owlit/trash/5-chat-old.json"), JSON.stringify({ version: 1, ...summary("old", 1), messages: [msg("u1", "user", 2)] }))
    expect((await call("chats.restore", { id: "old" })).messages.map((m: any) => m.id)).toEqual(["u1"])
    expect((await call("chats.list")).map((c: any) => c.id)).toEqual(["old"])
  })

  it("rebuilds the index from the chat files", async () => {
    const { open, chatsDir } = await setup()
    const first = await open()
    await first.call("chats.create", { chat: summary("a", 1) })
    await first.core.dispose()
    rmSync(path.join(chatsDir, "index.json"))
    const second = await open()
    expect((await second.call("chats.list")).map((c: any) => c.id)).toEqual(["a"])
  })

  it("moves a chat's last update to when its answer finished, so an answer that ends after a look is found", async () => {
    const { open } = await setup()
    const { call } = await open()
    await call("chats.create", { chat: summary("c", 1) })
    await call("chats.appendMessage", { id: "c", message: msg("q", "user", 5) })
    await call("chats.appendMessage", { id: "c", message: msg("a", "assistant", 10, { status: "streaming" }) })
    await call("chats.patchMessage", { id: "c", message: msg("a", "assistant", 10, { status: "done", finishedAt: 40 }), final: true })
    expect((await call("chats.list")).find((c: { id: string }) => c.id === "c").updatedAt).toBe(40)
  })

  it("keeps the layout in workspace.json", async () => {
    const { open, root } = await setup()
    const { call } = await open()
    await call("workspace.setLayout", { patch: { agentChatId: "a" } })
    expect(await call("workspace.layout")).toEqual({ agentChatId: "a" })
    expect(JSON.parse(readFileSync(path.join(root, ".owlit/workspace.json"), "utf8")).layout).toEqual({ agentChatId: "a" })
    await call("workspace.setLayout", { patch: { agentChatId: null } })
    expect(await call("workspace.layout")).toEqual({})
    writeFileSync(path.join(root, ".owlit/workspace.json"), "{ broken")
    const error = await call("workspace.setLayout", { patch: { x: 1 } }).catch((e) => e)
    expect(error.message).toContain("can't be read")
  })
})
