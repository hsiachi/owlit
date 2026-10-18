import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { until } from "../test-util.ts"
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
  const heard: RpcNotification[] = []
  const start = async () => {
    const core = make()
    cores.push(core)
    core.onNotify((n: RpcNotification) => {
      heard.push(n)
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
  const of = (method: string) => heard.filter((n) => n.method === method).map((n) => n.params as any)
  return { start, send, updates, said, root, base, of }
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

      const before = updates.length
      const slow = send(call, "slow")
      await until(() => updates.slice(before).some((u) => u.type === "agent_message_chunk"), { timeout: 10_000, what: "the slow answer to start" })
      await call("agents.cancel", { chatId: "c1" })
      // Left alone, the slow answer ends as end_turn: only a cancel that landed ends it cancelled
      expect(await slow).toEqual({ stopReason: "cancelled" })
    })
  }, 30_000)

  it("takes owlit's rules, the role and the user's name in its system prompt, not in the first prompt", async () => {
    const { start, send, said } = await setup()
    const { call } = await start()
    await call("settings.update", { patch: { profile: { name: "Xia" } } })
    await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
    await send(call, "system?", { role: "assistant" })
    expect(said()).toBe("rules:true role:Assistant name:Xia preamble:false")
    // A new role is a new system prompt (the session is loaded again with the role's options)
    await send(call, "system?", { role: "coauthor" })
    expect(said()).toBe("rules:true role:Co-author name:Xia preamble:false")
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

    // A failed sign-in says why, not just that something went wrong
    await expect(call("agents.signIn", { id: ENGINE_ID, methodId: "api-key:deepseek", apiKey: "  " })).rejects.toThrow("The API key is empty.")

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

  describe("edits, by Owlit's role", () => {
    const edit = (path: string, from: string, to: string) => `tool edit_file ${JSON.stringify({ path, old_text: from, new_text: to })}`
    const waitFor = (updates: SessionUpdate[], type: string): Promise<any> => until(() => updates.find((u) => u.type === type), { timeout: 10_000, what: `a ${type}` })

    it("as Assistant, asks with the diff; Apply writes through owlit, Discard leaves the file", async () => {
      const { start, send, said, updates, root, of } = await setup()
      const { call } = await start()
      await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })

      const applying = send(call, edit("notes.md", "twelve", "twenty"), { role: "assistant" })
      const ask = await waitFor(updates, "permission_request")
      expect(ask).toMatchObject({ title: "Edit notes.md", kind: "edit", options: [{ name: "Apply", kind: "allow_once" }, { name: "Discard", kind: "reject_once" }] })
      // The diff is drawn in place from the tool call the question describes
      const call1 = updates.filter((u) => u.type === "tool_call").at(-1) as any
      expect(call1).toMatchObject({ kind: "edit", diff: { path: "notes.md", oldText: "twelve chars", newText: "twenty chars" } })
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
      await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "apply" })
      await applying
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twenty chars")
      expect(said()).toBe("tool said: Changed notes.md.")
      // Written through owlit: a version to undo, and the write is the chat's
      expect(of("agent.wrote")).toEqual([expect.objectContaining({ path: "notes.md", chatId: "c1" })])

      updates.length = 0
      const discarding = send(call, edit("notes.md", "twenty", "ninety"), { role: "assistant" })
      const again = await waitFor(updates, "permission_request")
      await call("agents.respondPermission", { chatId: "c1", requestId: again.requestId, optionId: "discard" })
      await discarding
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twenty chars")
      expect(said()).toMatch(/^tool failed: The user didn't apply this change to notes\.md/)
      expect(of("agent.wrote")).toHaveLength(1)
    }, 30_000)

    it("as Co-author, writes without asking, still through owlit", async () => {
      const { start, send, said, updates, root, of } = await setup()
      const { call } = await start()
      await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
      await send(call, `tool write_file ${JSON.stringify({ path: "plan.md", content: "# Plan\n" })}`, { role: "coauthor" })
      expect(updates.some((u) => u.type === "permission_request")).toBe(false)
      expect(readFileSync(path.join(root, "plan.md"), "utf8")).toBe("# Plan\n")
      expect(said()).toBe("tool said: Wrote plan.md.")
      expect(of("agent.wrote")).toEqual([expect.objectContaining({ path: "plan.md", chatId: "c1" })])
    }, 30_000)

    it("hands work to agents of its own: each shown on its own, its edits asked for in its name", async () => {
      const { start, send, said, updates, root } = await setup()
      const { call } = await start()
      await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
      const agent = (task: string, prompt: string) => `tool agent ${JSON.stringify({ task, prompt })}`
      const turn = send(call, agent("Fix the notes", edit("notes.md", "twelve", "twenty")), { role: "assistant" })
      const ask = await waitFor(updates, "permission_request")
      // The agent's edit is asked for on its own session, so owlit knows whose it is
      expect(ask).toMatchObject({ title: "Edit notes.md", agentId: expect.stringContaining(":agent:") })
      await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "apply" })
      expect(await turn).toEqual({ stopReason: "end_turn" })
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twenty chars")
      // The chat's agent got the agent's report back as the tool's result
      expect(said()).toBe("tool said: tool said: Changed notes.md.")
      const saved = (await call("chats.get", { id: "c1" })).messages[1]
      const shown = saved.parts.filter((p: any) => p.type === "agent")
      expect(shown).toEqual([{ type: "agent", agentId: ask.agentId, title: "Fix the notes", status: "done", report: "tool said: Changed notes.md." }])
      // The agent tool itself is no step; the agent's steps are its own
      const steps = saved.parts.filter((p: any) => p.type === "tool_call")
      expect(steps.map((p: any) => [p.title, p.agentId])).toEqual([["Edit notes.md", ask.agentId]])
    }, 30_000)

    it("as Reviewer, reads but has no edit tools", async () => {
      const { start, send, said, root } = await setup()
      const { call } = await start()
      await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
      await send(call, `tool read_file ${JSON.stringify({ path: "notes.md" })}`)
      expect(said()).toBe("tool said:     1\ttwelve chars")
      await send(call, edit("notes.md", "twelve", "twenty"))
      expect(said()).toBe("tool failed: Tool edit_file not found")
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    }, 30_000)
  })

  describe("background work", () => {
    it("offers only the owlit tools the run allows, no file tools, and uses the model chosen for background work", async () => {
      const { start, root } = await setup()
      const { core, call } = await start()
      const run = (prompt: string, extra: object = {}) =>
        (core as any).background.run({ prompt, root, mcpServers: (core as any).mcpServers(root), signal: new AbortController().signal, connectorId: ENGINE_ID, ...extra })

      expect((await run("tool docs_list")).text).toMatch(/^tool said: .*notes\.md/)
      // Writing a margin note or a file isn't for a background run
      expect((await run(`tool docs_add_comment ${JSON.stringify({ path: "notes.md", quote: "twelve", comment: "hm" })}`)).text).toBe("tool failed: Tool docs_add_comment not found")
      expect((await run(`tool write_file ${JSON.stringify({ path: "x.md", content: "x" })}`)).text).toBe("tool failed: Tool write_file not found")
      expect(existsSync(path.join(root, "x.md"))).toBe(false)
      // Nothing of a background run is kept in the workspace
      expect(existsSync(path.join(root, ".owlit/engine"))).toBe(false)

      // The model picked in Settings, kept per agent
      await call("settings.update", { patch: { backgroundModel: { agent: ENGINE_ID, model: "faux/faux-large" } } })
      const { connectors } = await (core as any).settings.get()
      expect(connectors.backgroundModels).toEqual({ [ENGINE_ID]: "faux/faux-large" })
      expect((await run("hello", { models: connectors.backgroundModels })).text).toMatch(/^engine: hello \(faux-large\//)
      await call("settings.update", { patch: { backgroundModel: { agent: ENGINE_ID, model: null } } })
      expect((await (core as any).settings.get()).connectors.backgroundModels).toBeUndefined()
    }, 30_000)
  })
})
