import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-turns-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "notes.md"), "twelve chars")
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const updates: SessionUpdate[] = []
  core.onNotify((n: RpcNotification) => {
    if (n.method === "chat.update") updates.push((n.params as { update: SessionUpdate }).update)
  })
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
  let n = 0
  const send = (text: string, extra: object = {}) => {
    n++
    return call("agents.prompt", {
      chatId: "c1",
      connectorId: agent.id,
      input: { text, mentions: [], attachments: [] },
      userMessage: { id: `u${n}`, role: "user", createdAt: n * 10, parts: [{ type: "text", text }] },
      assistantMessageId: `a${n}`,
      ...extra,
    })
  }
  const text = () => updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text).join("")
  return { core, call, send, updates, text, root, agent }
}

describe("turns", () => {
  it("streams an answer and saves both messages", async () => {
    const { send, text, call, root } = await setup()
    expect(await send("hello there")).toEqual({ stopReason: "end_turn" })
    expect(text()).toBe("echo: hello there (small/ask/low)")
    const chat = await call("chats.get", { id: "c1" })
    expect(chat.messages.map((m: any) => [m.id, m.status ?? null])).toEqual([["u1", null], ["a1", "done"]])
    expect(chat.messages[1].parts).toEqual([{ type: "text", text: "echo: hello there (small/ask/low)" }])
    await call("chats.get", { id: "c1" })
    expect(Object.keys(JSON.parse(readFileSync(path.join(root, ".owlit/chats/c1.json"), "utf8")).sessions)).toHaveLength(1)
  })

  it("tells a new session owlit's rules before its first prompt, and only then", async () => {
    const { send, updates, call } = await setup()
    await send("rules?")
    await send("rules?")
    const said = updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text)
    expect(said).toEqual(["got the rules", "no rules this time"])
    // The preamble is the agent's, not the chat's
    const saved = await call("chats.get", { id: "c1" })
    expect(JSON.stringify(saved.messages)).not.toContain("owlit agent rules")
    expect(await call("agents.rules")).toMatch(/^owlit agent rules, version 1/)
  })

  it("sets the model, mode and effort the chat asks for", async () => {
    const { send, text } = await setup()
    await send("one", { modelId: "large", modeId: "auto", effortId: "high" })
    expect(text()).toContain("(large/auto/high)")
  })

  it("asks permission and passes on the answer; Reject reaches the agent", async () => {
    const { send, updates, call, text } = await setup()
    const turn = send("needs permission")
    while (!updates.some((u) => u.type === "permission_request")) await sleep(20)
    const ask = updates.find((u) => u.type === "permission_request") as Extract<SessionUpdate, { type: "permission_request" }>
    await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "no" })
    await turn
    expect(updates).toContainEqual({ type: "permission_resolved", requestId: ask.requestId, outcome: "reject_once" })
    expect(text()).toBe("you chose no")
    // Everything the agent said before it answered is in the saved message
    const saved = (await call("chats.get", { id: "c1" })).messages[1]
    expect(saved.parts.map((p: any) => p.type)).toEqual(["tool_call", "permission", "text"])
    expect(saved.parts[0].status).toBe("failed")
  })

  it("cancels a turn quickly, closing it as cancelled", async () => {
    const { send, call } = await setup()
    const turn = send("slow please")
    await sleep(400)
    const t = Date.now()
    await call("agents.cancel", { chatId: "c1" })
    expect(await turn).toEqual({ stopReason: "cancelled" })
    expect(Date.now() - t).toBeLessThan(1000)
    expect((await call("chats.get", { id: "c1" })).messages[1].status).toBe("cancelled")
  })

  it("continues after the agent restarts, with the conversation as context", async () => {
    const { send, core, text, updates } = await setup()
    await send("remember 42")
    core.agents.dispose()
    updates.length = 0
    await send("what number")
    // The fake agent lost its sessions, so owlit started a new one and passed the conversation on
    expect(text()).toBe("echo: what number (small/ask/low) with history")
  })

  it("fails a turn whose agent crashes, and the next turn works", async () => {
    const { send, call } = await setup()
    const error = await send("crash now").catch((e) => e)
    expect(error.message).toBeTruthy()
    expect((await call("chats.get", { id: "c1" })).messages[1]).toMatchObject({ status: "error" })
    expect(await send("again")).toEqual({ stopReason: "end_turn" })
  })

  it("serves file reads inside the workspace and refuses the rest", async () => {
    const { send, text, updates } = await setup()
    await send("read notes.md")
    expect(text()).toBe("read 12 characters")
    updates.length = 0
    await send("read ../../../etc/passwd")
    expect(text()).toMatch(/could not read: .*outside the workspace/)
  })

  it("keeps what an agent overwrote when it writes the disk itself", async () => {
    const { send, root, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "agent.wrote" && wrote.push(n.params))
    await send("direct notes.md rewritten by the agent")
    for (let i = 0; i < 80 && !wrote.length; i++) await sleep(25)
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("rewritten by the agent")
    expect(wrote).toHaveLength(1)
    expect(wrote[0]).toMatchObject({ path: "notes.md", chatId: "c1" })
    expect(readFileSync(path.join(root, ".owlit/versions", wrote[0].versionId), "utf8")).toBe("twelve chars")
    await call("versions.restore", { id: wrote[0].versionId })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
  })

  it("writes files for the agent and tells clients", async () => {
    const { send, root, core } = await setup()
    const heard: unknown[] = []
    core.onNotify((n) => n.method === "docs.changed" && heard.push(n.params))
    await send("write new.md hello")
    expect(readFileSync(path.join(root, "new.md"), "utf8")).toBe("hello")
    expect(heard).toHaveLength(1)
  })
})
