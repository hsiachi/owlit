import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { McpServer } from "@agentclientprotocol/sdk"
import { chatUri, docUri } from "@owlit/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Background, type BackgroundRun } from "../agents/background.ts"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { until } from "../test-util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { cleanReading, goThroughPrompt, recordOf } from "./go-through.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  vi.restoreAllMocks()
})

const STORY = "# 研究故事\n\n故事从数据集讲起。\n\n研究问题分两层。\n"
const MEETING = "# P5 周会 2026-10-15\n\n@时英天 00:10:19\n故事要从任务讲起。\n\n@夏奇 00:11:02\n好，从任务出发。\n"
const READING = "# P5 周会 · 2026-10-15\n\n## Owlit 的解读\n\n*2026-10-15 · 对照 [研究故事](owlit://docs/story.md)*\n\n时英天建议故事从任务讲起，你同意了。\n\n### 要点\n\n- **时英天**：故事要从任务讲起。你当场同意了。\n\n### 待办\n\n- [ ] 改研究故事的开头\n"

type Call = (method: string, params?: unknown, caller?: Caller) => Promise<any>

// A workspace with a doc and a meeting's transcript, and Owlit's background session played by `agent`
async function setup(agent: (prompt: string, run: string, call: Call) => Promise<string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-go-")))
  const root = path.join(base, "ws")
  mkdirSync(path.join(root, "Meetings"), { recursive: true })
  writeFileSync(path.join(root, "story.md"), STORY)
  writeFileSync(path.join(root, "Meetings/P5 周会 2026-10-15.md"), MEETING)
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: [] } })
  cores.push(core)
  const call: Call = async (method, params, caller) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const prompts: string[] = []
  vi.spyOn(Background.prototype, "run").mockImplementation(async (run: BackgroundRun) => {
    prompts.push(run.prompt)
    const args = (run.mcpServers[0] as McpServer & { args: string[] }).args
    const id = args[args.indexOf("--run") + 1]!
    // As owlit-mcp calls core for the run, on the socket
    return { text: await agent(run.prompt, id, (method, params) => call(method, params, { kind: "socket", run: id })), connectorId: "fake" }
  })
  await call("workspace.open", { path: root })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const done = (kind: string, n = 1) =>
    until(
      () => {
        const finished = workspace.tasks.list().filter((t) => t.kind === kind && ["done", "failed", "cancelled"].includes(t.state))
        return finished.length >= n ? finished[0]! : undefined
      },
      { timeout: 10_000, what: `${kind} to finish` },
    )
  return { root, call, workspace, prompts, done }
}

// What owlit-mcp's docs_add_comment sends core, with Owlit's own word as a second entry
const point = (call: Call, run: string, own?: string) =>
  call(
    "comments.add",
    {
      path: "story.md",
      comment: {
        id: "c1",
        quote: "故事从数据集讲起。",
        prefix: "",
        suffix: "",
        // An agent can't say where words came from; core does
        source: { path: "elsewhere.md", label: "forged" },
        entries: [{ id: "e1", text: "时英天在周会上建议故事从任务讲起，你当场同意了。", at: Date.now() }, ...(own ? [{ id: "e2", text: own, at: Date.now() }] : [])],
        createdAt: Date.now(),
      },
    },
    { kind: "socket", run },
  )

describe("Go through", () => {
  it("writes a record beside the material, the material untouched, and lands its points carried over from it once the record is there", { timeout: 20_000 }, async () => {
    const material = "Meetings/P5 周会 2026-10-15.md"
    let heldWhileReading: unknown[] = []
    const { root, call, prompts, done } = await setup(async (_prompt, run, call) => {
      await point(call, run, "任务的定义现在在 §3 第一段，可以提上来。")
      heldWhileReading = Object.values(await call("comments.all")).flat()
      return `Here is the reading.\n\n\`\`\`markdown\n${READING}\`\`\``
    })
    const before = statSync(path.join(root, material)).mtimeMs
    const task = await call("docs.goThrough", { path: material })
    expect(task).toMatchObject({ kind: "meetings.goThrough", priority: "asked" })
    expect(await done("meetings.goThrough")).toMatchObject({ state: "done" })
    // Told the material, the docs to read it against, and where the record will be
    expect(prompts[0]).toContain("故事要从任务讲起")
    expect(prompts[0]).toContain("story.md")
    expect(prompts[0]).toContain(`[P5 周会 2026-10-15 · 解读](${docUri("Meetings/P5 周会 2026-10-15 · 解读.md")})`)
    // The points waited for the record
    expect(heldWhileReading).toEqual([])
    const record = readFileSync(path.join(root, "Meetings/P5 周会 2026-10-15 · 解读.md"), "utf8")
    expect(record).toBe(recordOf(READING.trim(), material, true))
    expect(record).toContain("## 原文")
    expect(statSync(path.join(root, material)).mtimeMs).toBe(before)
    const [comment] = Object.values(await call("comments.all")).flat() as any[]
    expect(comment).toMatchObject({ source: { path: "Meetings/P5 周会 2026-10-15 · 解读.md", label: "P5 周会 2026-10-15 · 解读" }, entries: [{ by: expect.stringMatching(/^o_/) }, { by: expect.stringMatching(/^o_/), text: "任务的定义现在在 §3 第一段，可以提上来。" }] })
    expect(await call("docs.owlit", { path: material })).toMatchObject({ wentThrough: { record: "Meetings/P5 周会 2026-10-15 · 解读.md" } })
    // The record is the run's write: it can be undone from the run
    expect(await call("chats.list")).toEqual([])
  })

  it("goes through a transcript attached to a chat, with its record in Meetings and its link to the chat", { timeout: 20_000 }, async () => {
    const { root, call, workspace, prompts, done } = await setup(async (_prompt, run, call) => {
      await point(call, run)
      return READING
    })
    const material = ".owlit/chats/c1/files/周会.txt"
    mkdirSync(path.join(root, ".owlit/chats/c1/files"), { recursive: true })
    writeFileSync(path.join(root, material), MEETING)
    // As docs.goThrough enqueues it
    workspace.tasks.enqueue("meetings.goThrough", material, "asked")
    expect(await done("meetings.goThrough")).toMatchObject({ state: "done" })
    expect(prompts[0]).toContain("故事要从任务讲起")
    expect(readFileSync(path.join(root, "Meetings/周会 · 解读.md"), "utf8")).toBe(recordOf(READING.trim(), material, true, chatUri("c1")))
    expect((Object.values(await call("comments.all")).flat() as any[])[0]).toMatchObject({ source: { path: "Meetings/周会 · 解读.md" } })
  })

  it("drops the points of a run that stops before its record", { timeout: 20_000 }, async () => {
    const { call, done } = await setup(async (_prompt, run, call) => {
      await point(call, run)
      return "I couldn't make sense of it."
    })
    await call("docs.goThrough", { path: "Meetings/P5 周会 2026-10-15.md" })
    expect(await done("meetings.goThrough")).toMatchObject({ state: "failed" })
    expect(Object.values(await call("comments.all")).flat()).toEqual([])
  })

  it("asks only for text", async () => {
    const { call } = await setup(async () => READING)
    await expect(call("docs.goThrough", { path: "Meetings/slides.pdf" })).rejects.toThrow()
  })
})

describe("the reading", () => {
  it("comes out of the answer without a fence or words before its title", () => {
    expect(cleanReading(`Sure.\n\n\`\`\`md\n${READING}\`\`\`\nDone.`)).toBe(READING.trim())
    expect(cleanReading(`Here it is:\n${READING}`)).toBe(READING.trim())
  })

  it("tells the agent to keep proposals apart from decisions and never to guess a speaker", () => {
    const prompt = goThroughPrompt({ path: "m.md", content: "x", record: "m · reading.md", recordLabel: "m · reading", docs: [], today: "2026-10-16" })
    expect(prompt).toContain("Most things that sound like a decision are this")
    expect(prompt).toContain("never guess a name from context")
    expect(prompt).toContain("(none)")
  })
})
