import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { testSearchPath } from "../test-util.ts"

// The rules' version as turns.ts reads it, raised by the test as a change to the rules would
const version = vi.hoisted(() => ({ now: 0 }))
vi.mock("./rules.ts", async (actual) => {
  const rules = await actual<typeof import("./rules.ts")>()
  version.now = rules.RULES_VERSION
  return {
    ...rules,
    get RULES_VERSION() {
      return version.now
    },
  }
})

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

it("tells a session that outlived a change to owlit's rules the version in force, once", async () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-rules-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const core = new Core({ userDataDir: path.join(base, "userData"), searchPath: testSearchPath })
  cores.push(core)
  const said: string[] = []
  core.onNotify((n: RpcNotification) => {
    const update = n.method === "chat.update" ? (n.params as { update: SessionUpdate }).update : undefined
    if (update?.type === "agent_message_chunk") said.push(update.text)
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
  const send = (text: string) => {
    n++
    return call("agents.prompt", {
      chatId: "c1",
      connectorId: agent.id,
      input: { text, mentions: [], attachments: [] },
      userMessage: { id: `u${n}`, role: "user", createdAt: n * 10, parts: [{ type: "text", text }] },
      assistantMessageId: `a${n}`,
    })
  }
  const told = version.now
  await send("rules?")
  expect((await call("chats.get", { id: "c1" })).rules).toEqual({ [agent.id]: told })
  version.now = told + 1
  await send("rules?")
  await send("rules?")
  expect(said).toEqual(["got the rules", "got the new rules", "no rules this time"])
  // Kept with the chat, so a session loaded after a restart knows what it was told
  expect((await call("chats.get", { id: "c1" })).rules).toEqual({ [agent.id]: told + 1 })
})
