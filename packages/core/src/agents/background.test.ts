import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SessionUpdate } from "@owlit/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { testSearchPath } from "../test-util.ts"
import type { Background } from "./background.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  delete process.env.FAKE_ACP_AUTH
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-bg-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "story.md"), "# Story\n\nThe first claim.\n")
  const core = new Core({ userDataDir: path.join(base, "userData"), searchPath: testSearchPath })
  cores.push(core)
  // The window by default; owlit-mcp on the socket for an agent's call
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  const background = (core as unknown as { background: Background }).background
  return { root, call, background, agent: agent.id as string }
}

// A comment as a client sends it, claiming an author core doesn't take from it
const comment = (id = "c1") => ({
  id,
  quote: "The first claim.",
  prefix: "",
  suffix: "",
  entries: [{ id: `${id}-e`, by: "p_1234abcd", text: "A word on it.", at: 1 }],
  createdAt: 1,
})

describe("what Owlit may write without being asked", () => {
  it("a background session can't write a file", async () => {
    const { root, background, agent } = await setup()
    await expect(background.run({ prompt: "write notes.md hello", root, mcpServers: [], signal: new AbortController().signal, connectorId: agent })).rejects.toThrow()
    expect(existsSync(path.join(root, "notes.md"))).toBe(false)
  })

  it("an agent's comments are signed as Owlit's whatever it says, and never go over one that is there", async () => {
    const { call } = await setup()
    const mcp: Caller = { kind: "socket", chatId: "chat-1" }
    await call("comments.add", { path: "story.md", comment: comment("c1"), agent: { chatId: "chat-1" } }, mcp)
    // The user's own comment, then an agent trying to write over it
    await call("comments.add", { path: "story.md", comment: comment("c3") })
    await expect(call("comments.add", { path: "story.md", comment: comment("c3"), agent: { chatId: "chat-1" } }, mcp)).rejects.toMatchObject({ message: "That comment is already there; an agent adds new ones." })
    const all = await call("comments.all")
    expect(Object.values(all).flat().map((c: any) => [c.id, c.entries[0].by.slice(0, 2)])).toEqual([
      ["c1", "o_"],
      ["c3", "p_"],
    ])
  })
})

describe("a background run", () => {
  it("answers with the agent's own words, its helpers' steps kept apart", async () => {
    const { root, background, agent } = await setup()
    const updates: SessionUpdate[] = []
    const result = await background.run({ prompt: "with a helper", root, mcpServers: [], signal: new AbortController().signal, connectorId: agent, onUpdate: (u) => updates.push(u) })
    expect(result.text).toBe("The answer.")
    expect(updates).toContainEqual(expect.objectContaining({ type: "tool_call", toolCallId: "h1", agentId: "agent-h" }))
    expect(updates).toContainEqual({ type: "agent_started", agentId: "agent-h", title: "Read the story" })
    expect(updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text)).toEqual(["The answer."])
  })

  it("fails in owlit's words when the agent isn't signed in", async () => {
    const { root, background, agent } = await setup()
    process.env.FAKE_ACP_AUTH = "required"
    await expect(background.run({ prompt: "hello", root, mcpServers: [], signal: new AbortController().signal, connectorId: agent })).rejects.toThrow("Fake isn't signed in.")
  })
})
