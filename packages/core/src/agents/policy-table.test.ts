import type { SessionUpdate } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { testSearchPath } from "../test-util.ts"

// One cell of the role table changed: an Assistant may no longer change the user's words. Every route
// that decides what Owlit may do reads the same table, so each of them follows.
vi.mock("@owlit/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@owlit/protocol")>()
  return { ...actual, ROLE_TABLE: { ...actual.ROLE_TABLE, words: { ...actual.ROLE_TABLE.words, assistant: "refuse" } } }
})

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

describe("the role table", () => {
  it("decides an engine's edit, its own write and owlit's tools alike", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-table-")))
    const root = path.join(base, "ws")
    mkdirSync(root)
    writeFileSync(path.join(root, "notes.md"), "twelve chars")
    const core = new Core({ userDataDir: path.join(base, "userData"), searchPath: testSearchPath })
    cores.push(core)
    const updates: SessionUpdate[] = []
    core.onNotify((n) => n.method === "chat.update" && updates.push((n.params as { update: SessionUpdate }).update))
    const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
    await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false, role: "assistant" } })
    let n = 0
    const send = (text: string) => {
      n++
      return call("agents.prompt", {
        chatId: "c1",
        connectorId: agent.id,
        role: "assistant",
        input: { text, mentions: [], attachments: [] },
        userMessage: { id: `u${n}`, role: "user", createdAt: n * 10, parts: [{ type: "text", text }] },
        assistantMessageId: `a${n}`,
      })
    }
    const said = () => updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text)

    // The engine's request to edit is refused before any card
    await send("rewrite notes.md thirteen chars")
    expect(said()).toEqual(["you chose no"])
    expect(updates.some((u) => u.type === "permission_request")).toBe(false)
    // Its own write through owlit (ACP fs) is refused, which fails the fake agent's turn
    await expect(send("write notes.md other words")).rejects.toThrow(/Owlit works as Assistant in this chat/)
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    // And owlit's tools refuse the same class
    await call("library.add", { paper: { id: "doi-10.9-a", title: "Paper", authors: [], ids: { doi: "10.9/a" } } })
    await expect(call("library.update", { id: "doi-10.9-a", patch: { title: "Other" } }, { kind: "socket", chatId: "c1" })).rejects.toThrow(/^Not done: Owlit works as Assistant in this chat/)
  })
})
