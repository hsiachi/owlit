import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { McpServer } from "@agentclientprotocol/sdk"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Background, type BackgroundRun } from "../agents/background.ts"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { eventually, until } from "../test-util.ts"
import type { Workspace } from "../workspace/workspace.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  vi.restoreAllMocks()
})

const STORY = "# Story\n\nReplay ratings track the live ones.\n\nThe second claim stands alone.\n"

// A workspace with a doc, and Owlit's background session played by `agent`, given the run's prompt
async function setup(agent: (prompt: string) => Promise<string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-reply-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "story.md"), STORY)
  // A short folder: a Unix socket's path has to fit in about a hundred bytes
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: [] } })
  cores.push(core)
  const call: Call = async (method, params, caller) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  vi.spyOn(Background.prototype, "run").mockImplementation(async (run: BackgroundRun) => {
    void (run.mcpServers[0] as McpServer)
    return { text: await agent(run.prompt), connectorId: "fake" }
  })
  await call("workspace.open", { path: root })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const journal = () => readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  return { call, workspace, journal }
}

type Call = (method: string, params?: unknown, caller?: Caller) => Promise<any>

// One of Owlit's comments, as a run's docs_add_comment sends it to core, on the socket
const RUN = "meetings.goThrough:t0"
const leave = (call: Call, quote: string, text: string) =>
  call(
    "comments.add",
    { path: "story.md", agent: { run: RUN }, comment: { id: `c-${quote.length}`, quote, prefix: "", suffix: "", entries: [{ id: `e-${quote.length}`, text, at: Date.now() }], createdAt: Date.now() } },
    { kind: "socket", run: RUN },
  )

describe("A reply under Owlit's comment", () => {
  it("is answered by Owlit in the comment, as a run the user asked for; a dismissed comment is put away", { timeout: 20_000 }, async () => {
    const { call, workspace, journal } = await setup(async (prompt) => (prompt.includes("the user has replied") ? "The week-long gap is in their Table 2." : "Nothing to add."))
    await leave(call, "Replay ratings track the live ones.", "They drift apart after a week.")
    const [comment] = Object.values(await call("comments.all")).flat() as any[]
    expect(comment).toMatchObject({ quote: "Replay ratings track the live ones.", entries: [{ by: expect.stringMatching(/^o_/) }] })

    await call("comments.put", { path: "story.md", comment: { ...comment, entries: [...comment.entries, { id: "r1", text: "Where does it say so?", at: Date.now() }] } })
    await until(() => workspace.tasks.list().some((t) => t.kind === "docs.reply" && t.state === "done"), { timeout: 10_000, what: "the reply" })
    const answered = (Object.values(await call("comments.all")).flat() as any[])[0]
    expect(answered.entries.map((e: any) => [e.by.slice(0, 2), e.text])).toEqual([
      ["o_", "They drift apart after a week."],
      ["p_", "Where does it say so?"],
      ["o_", "The week-long gap is in their Table 2."],
    ])
    expect(workspace.tasks.list().find((t) => t.kind === "docs.reply")).toMatchObject({ priority: "asked", subject: `story.md#${comment.id}` })
    // The run is a session, not one of the user's chats
    expect(await call("chats.list")).toEqual([])

    await call("comments.dismiss", { path: "story.md", id: comment.id })
    await expect(call("comments.dismiss", { path: "story.md", id: "nope" })).rejects.toThrow()
    expect((Object.values(await call("comments.all")).flat() as any[])[0]).toMatchObject({ dismissedAt: expect.any(Number) })
    await eventually(() => expect(journal().filter((l) => l.kind.startsWith("feedback.")).map((l) => l.kind)).toEqual(["feedback.reply", "feedback.dismiss"]))
  })
})
