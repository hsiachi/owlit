import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { ENGINE_ID } from "./agents.ts"

// The Owlit engine (packages/owlit-agent) run by core as owlit runs it, with pi-ai's scripted model in
// place of a real one, and owlit-mcp on the workspace's socket for its tools
const ENGINE = path.join(import.meta.dirname, "../../../owlit-agent/src/main.ts")
const MCP = path.join(import.meta.dirname, "../../../owlit-mcp/src/main.ts")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup(env: Record<string, string> = { OWLIT_ENGINE_FAUX: "1" }) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-engine-")))
  const root = path.join(base, "ws")
  // A Unix socket's path has to be short
  const dir = mkdtempSync("/tmp/oe-")
  mkdirSync(root)
  writeFileSync(path.join(root, "notes.md"), "twelve chars")
  const make = () =>
    new Core({
      userDataDir: path.join(base, "userData"),
      socket: { dir },
      mcp: { command: process.execPath, args: [MCP, "--socket-dir", dir] },
      engine: { command: process.execPath, args: [ENGINE], env },
    })
  const updates: SessionUpdate[] = []
  const start = async () => {
    const core = make()
    cores.push(core)
    core.onNotify((n: RpcNotification) => {
      if (n.method === "chat.update") updates.push((n.params as { update: SessionUpdate }).update)
    })
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { core, call }
  }
  let n = 0
  const send = (call: (method: string, params?: unknown) => Promise<any>, text: string, extra: object = {}) => {
    n++
    return call("agents.prompt", {
      chatId: "c1",
      connectorId: ENGINE_ID,
      role: "reviewer",
      input: { text, mentions: [], attachments: [] },
      userMessage: { id: `u${n}`, role: "user", createdAt: n * 10, parts: [{ type: "text", text }] },
      assistantMessageId: `a${n}`,
      ...extra,
    })
  }
  const said = () => updates.splice(0).filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text).join("")
  return { start, send, updates, said, root, base }
}

describe("Owlit engine", () => {
  it("is offered as a built-in agent and reports what it offers when checked", async () => {
    const { start } = await setup()
    const { call } = await start()
    const engine = (await call("agents.list")).find((c: any) => c.id === ENGINE_ID)
    expect(engine).toMatchObject({ name: "Owlit engine (Beta)", builtIn: true })
    const checked = await call("agents.check", { id: ENGINE_ID })
    expect(checked).toMatchObject({ status: "connected", authenticated: true, defaultModelId: "faux/faux-small", defaultEffortId: "medium" })
    expect(checked.models.map((m: any) => m.id)).toEqual(["faux/faux-small", "faux/faux-large"])
    expect(checked.signInMethods.map((m: any) => m.id)).toEqual(["chatgpt", "api-key:faux"])
    expect(checked.signInMethods[0]).toMatchObject({ name: "ChatGPT", provider: "openai" })
    expect(checked.models.map((m: any) => m.group)).toEqual(["faux", "faux"])
    expect(checked.signInMethods[1]).toMatchObject({ apiKey: true })
  }, 30_000)

  it("answers, uses owlit's tools through owlit-mcp, and stops when asked", async () => {
    const { start, send, said, updates } = await setup()
    await start().then(async ({ call }) => {
      await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
      expect(await send(call, "hello there")).toEqual({ stopReason: "end_turn" })
      expect(said()).toBe("engine: hello there (faux-small/medium)")

      await send(call, "tool docs_list")
      const tool = updates.find((u) => u.type === "tool_call") as any
      expect(tool).toMatchObject({ title: "mcp__owlit__docs_list", kind: "read" })
      expect(said()).toMatch(/^tool said: .*notes\.md/)

      const slow = send(call, "slow")
      await new Promise((r) => setTimeout(r, 300))
      const at = Date.now()
      await call("agents.cancel", { chatId: "c1" })
      expect(await slow).toEqual({ stopReason: "cancelled" })
      expect(Date.now() - at).toBeLessThan(1000)
    })
  }, 30_000)

  it("picks a chat up again after owlit restarts, with the model it was set to", async () => {
    const { start, send, said, root } = await setup()
    const first = await start()
    await first.call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
    await send(first.call, "first question", { modelId: "faux/faux-small", effortId: "high" })
    expect(said()).toBe("engine: first question (faux-small/high)")
    const chat = await first.call("chats.get", { id: "c1" })
    const sessionId = chat.sessions[ENGINE_ID]
    expect(existsSync(path.join(root, ".owlit/engine", `${sessionId}.jsonl`))).toBe(true)
    await first.core.dispose()

    const second = await start()
    await send(second.call, "after restart", { modelId: "faux/faux-small", effortId: "high" })
    expect(said()).toBe("engine: after restart (faux-small/high)")
    // The same session went on: no new one was recorded
    expect((await second.call("chats.get", { id: "c1" })).sessions[ENGINE_ID]).toBe(sessionId)
  }, 30_000)

  it("says it isn't signed in, takes an API key, and signs out", async () => {
    // The real providers, with no key from the environment
    const blank = Object.fromEntries(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "QWEN_TOKEN_PLAN_CN_API_KEY", "MOONSHOT_API_KEY"].map((k) => [k, ""]))
    const { start, base } = await setup(blank)
    const { call } = await start()
    const out = await call("agents.check", { id: ENGINE_ID })
    expect(out).toMatchObject({ status: "error", authenticated: false, error: "Owlit engine (Beta) isn't signed in. Sign in under Settings › Agents, then try again." })
    expect(out.signInMethods.map((m: any) => m.id)).toEqual(["chatgpt", "api-key:openai", "api-key:anthropic", "api-key:openrouter", "api-key:deepseek", "api-key:qwen-token-plan-cn", "api-key:moonshotai-cn"])

    const signedIn = await call("agents.signIn", { id: ENGINE_ID, methodId: "api-key:deepseek", apiKey: " sk-test " })
    expect(signedIn).toMatchObject({ status: "connected", authenticated: true })
    expect(signedIn.models.length).toBeGreaterThan(0)
    expect(signedIn.models.every((m: any) => m.id.startsWith("deepseek/"))).toBe(true)
    const file = path.join(base, "userData/agents/owlit-engine/auth.json")
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ deepseek: { type: "api_key", key: "sk-test" } })
    expect(statSync(file).mode & 0o777).toBe(0o600)

    expect(signedIn.signIns).toEqual([{ methodId: "api-key:deepseek", name: "DeepSeek API key", hint: "test" }])

    // A second provider at once: models from both, each under its provider's heading
    const both = await call("agents.signIn", { id: ENGINE_ID, methodId: "api-key:anthropic", apiKey: "sk-ant-wxyz" })
    expect(both.signIns.map((s: any) => s.methodId)).toEqual(["api-key:deepseek", "api-key:anthropic"])
    expect(new Set(both.models.map((m: any) => m.group))).toEqual(new Set(["DeepSeek", "Anthropic"]))

    // Signing out of one keeps the other
    const one = await call("agents.signOut", { id: ENGINE_ID, methodId: "api-key:deepseek" })
    expect(one).toMatchObject({ authenticated: true, signIns: [{ methodId: "api-key:anthropic", name: "Anthropic API key", hint: "wxyz" }] })
    expect(one.models.every((m: any) => m.group === "Anthropic")).toBe(true)

    expect(await call("agents.signOut", { id: ENGINE_ID })).toMatchObject({ authenticated: false, signIns: [] })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({})
  }, 30_000)
})
