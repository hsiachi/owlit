import type { Chat, RpcNotification } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { cutOffSentence } from "../agents/failure.ts"
import { Core } from "../core.ts"
import { knownProfile, MY_OWLIT, testSearchPath, until } from "../test-util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { TRY_AGAIN, tryAgain } from "./chats.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

// A workspace with its socket up, so the fake agent reaches owlit's tools as owlit-mcp would, and the fake
// agent chosen for the work owlit starts
async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-started-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  // A short folder: a Unix socket's path has to fit in about a hundred bytes
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const userDataDir = knownProfile(path.join(base, "userData"))
  const open = async () => {
    const core = new Core({ userDataDir, socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: ["--socket-dir", socketDir] }, searchPath: testSearchPath })
    cores.push(core)
    const heard: RpcNotification[] = []
    core.onNotify((n) => heard.push(n))
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    const workspace = () => (core as unknown as { workspace: Workspace }).workspace
    return { core, call, heard, workspace }
  }
  const first = await open()
  const agent = await first.call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await first.core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
  return { ...first, open, agent }
}

const about = { kind: "paper" as const, id: "doi-10.1-a" }

describe("chats owlit starts", () => {
  it("runs the recipe as Reviewer with no window, signs its writes as Owlit's in that chat, and stays out of the chat list", async () => {
    const { core, call, heard, workspace } = await setup()
    const recipe = `call memory.write ${JSON.stringify({ op: "add", kind: "work", text: "Reads papers on retrieval." })}`
    const started = await core.startFor({ about, title: "A digest", recipe })
    // Running and stoppable as soon as it is started, with what it is about
    expect(await call("agents.running")).toEqual([expect.objectContaining({ chatId: started.chatId, messageId: started.messageId, about })])
    expect(await started.done).toBe("end_turn")

    const chat: Chat = await call("chats.get", { id: started.chatId })
    expect(chat).toMatchObject({ startedBy: "owlit", about, role: "reviewer", title: "A digest" })
    expect(chat.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", undefined],
      ["assistant", "done"],
    ])
    expect(chat.messages[1]!.parts).toContainEqual(expect.objectContaining({ type: "text", text: expect.stringContaining("called:") }))
    const [change] = await workspace().changes.list({ target: { kind: "memory" } })
    expect(change).toMatchObject({ actor: MY_OWLIT, origin: { via: "tool", chatId: started.chatId, replyId: started.messageId } })

    expect(await call("chats.list")).toEqual([])
    // Not a reply the person hasn't seen, even marked
    await call("seen.mark", { kind: "chat", id: started.chatId, message: "older", at: 1 })
    expect((await call("changes.unseen", {})).chats).toEqual([])
    // Every window heard it begin and end, the chat whole each time
    const runs = heard.filter((n) => n.method === "chats.turn").map((n) => (n.params as { chat: Chat }).chat)
    expect(runs.at(0)?.messages.at(-1)?.status).toBe("streaming")
    await until(() => heard.filter((n) => n.method === "chats.turn").length === 2, { what: "the end announced" })
    expect((heard.filter((n) => n.method === "chats.turn").at(-1)!.params as { chat: Chat }).chat.messages.at(-1)?.status).toBe("done")
  })

  it("is stopped as any chat is, and owlit closing cuts it off with the sentence that says so", async () => {
    const { core, call, open } = await setup()
    const stopped = await core.startFor({ about, title: "A digest", recipe: "quiet" })
    await call("agents.cancel", { chatId: stopped.chatId })
    expect(await stopped.done).toBe("cancelled")

    const cut = await core.startFor({ about: { kind: "paper", id: "doi-10.1-b" }, title: "A digest", recipe: "quiet" })
    await until(async () => (await call("chats.get", { id: cut.chatId })).messages.at(-1)?.parts.length, { what: "the agent's first word" })
    await cores.splice(cores.indexOf(core), 1)[0]!.dispose()
    const again = await open()
    const chat: Chat = await again.call("chats.get", { id: cut.chatId })
    expect(chat.messages.at(-1)).toMatchObject({ status: "error", cutOff: "closed", error: cutOffSentence("closed") })
    // Read by what it is about, as the place it worked on finds it after a restart
    expect(await again.workspace().chats.latestAbout({ kind: "paper", id: "doi-10.1-b" })).toMatchObject({ id: cut.chatId })
    expect(await again.call("chats.startedFor", { kind: "paper" })).toEqual([
      expect.objectContaining({ chatId: cut.chatId, about: { kind: "paper", id: "doi-10.1-b" }, reply: expect.objectContaining({ status: "error", cutOff: "closed" }) }),
      expect.objectContaining({ chatId: stopped.chatId, about, reply: expect.objectContaining({ status: "cancelled" }) }),
    ])
  })

  it("retries in the same chat, so the agent sees what it did", async () => {
    const { core, call, workspace } = await setup()
    const first = await core.startFor({ about, title: "A digest", recipe: "refuse me" })
    expect(await first.done).toBe("error")
    const failed: Chat = await call("chats.get", { id: first.chatId })
    expect(failed.messages.at(-1)).toMatchObject({ status: "error", error: expect.any(String) })

    const retry = await tryAgain((core as unknown as { turns: Parameters<typeof tryAgain>[0] }).turns, workspace().chats, first.chatId)
    expect(retry.chatId).toBe(first.chatId)
    expect(await retry.done).toBe("end_turn")
    const chat: Chat = await call("chats.get", { id: first.chatId })
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(chat.messages[2]!.parts).toEqual([{ type: "text", text: TRY_AGAIN }])
    expect(chat.messages[3]).toMatchObject({ status: "done" })
  })

  it("retries on the agent Settings chooses now, in the same chat", async () => {
    const { core, call } = await setup()
    const first = await core.startFor({ about, title: "A digest", recipe: "refuse me" })
    expect(await first.done).toBe("error")
    const other = await call("agents.add", { name: "Fake two", command: `"${process.execPath}" "${fake}"` })
    await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: other.id } }))
    expect(await call("chats.tryAgain", { chatId: first.chatId })).toEqual({ chatId: first.chatId })
    const chat: Chat = await until(async () => {
      const c: Chat = await call("chats.get", { id: first.chatId })
      return c.messages.length === 4 && c.messages[3]!.status === "done" ? c : undefined
    }, { what: "the retry to end" })
    expect(chat.connectorId).toBe(other.id)
    expect(chat.messages[3]).toMatchObject({ connectorId: other.id })
  })

  it("runs on the agent and model Settings chooses for the work owlit starts", async () => {
    const { core, call, agent } = await setup()
    await call("settings.update", { patch: { backgroundModel: { agent: agent.id, model: "large" } } })
    const started = await core.startFor({ about, title: "A digest", recipe: "hello" })
    await started.done
    const chat: Chat = await call("chats.get", { id: started.chatId })
    expect(chat).toMatchObject({ connectorId: agent.id, modelId: "large" })
    expect(chat.messages.at(-1)!.parts).toContainEqual({ type: "text", text: expect.stringMatching(/^echo: hello \(large\//) })
  })
})

describe("a chat owlit starts, with nobody watching", () => {
  const reply = async (call: (method: string, params?: unknown) => Promise<any>, chatId: string) => {
    const chat: Chat = await call("chats.get", { id: chatId })
    return chat.messages.at(-1)!
  }

  it("is refused a write to the person's file outside owlit's tools", async () => {
    const { core, call, workspace } = await setup()
    writeFileSync(path.join(workspace().root, "notes.md"), "mine")
    const started = await core.startFor({ about, title: "A digest", recipe: "rewrite notes.md theirs now" })
    expect(await started.done).toBe("end_turn")
    expect(readFileSync(path.join(workspace().root, "notes.md"), "utf8")).toBe("mine")
    const said = await reply(call, started.chatId)
    expect(said.parts).toContainEqual({ type: "text", text: "you chose no" })
    expect(said.parts.some((p) => p.type === "permission")).toBe(false)
  })

  it("is refused what would wait on a person: a permission, a question", async () => {
    const { core, call } = await setup()
    const asked = await core.startFor({ about, title: "A digest", recipe: "permission please" })
    expect(await asked.done).toBe("end_turn")
    expect((await reply(call, asked.chatId)).parts).toContainEqual({ type: "text", text: "you chose no" })

    const question = await core.startFor({ about: { kind: "paper", id: "doi-10.1-b" }, title: "A digest", recipe: "a question" })
    expect(await question.done).toBe("end_turn")
    const answered = await reply(call, question.chatId)
    expect(answered.parts).toContainEqual({ type: "text", text: `answer ${JSON.stringify({ action: "decline" })}` })
    expect(answered.parts.some((p) => p.type === "question")).toBe(false)
  })
})
