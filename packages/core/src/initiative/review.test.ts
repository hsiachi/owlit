import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { McpServer } from "@agentclientprotocol/sdk"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Background, type BackgroundRun } from "../agents/background.ts"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { eventually, until } from "../test-util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { paragraphsOf } from "./review.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  vi.restoreAllMocks()
})

const STORY = "# Story\n\nReplay ratings track the live ones.\n\nThe second claim stands alone.\n"

// A workspace with a doc, the dial at When I open things, and Owlit's background session played by
// `agent`: given the run's prompt and the run id owlit-mcp would sign its tools with
async function setup(agent: (prompt: string, run: string, call: Call) => Promise<string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-review-")))
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
  const prompts: string[] = []
  vi.spyOn(Background.prototype, "run").mockImplementation(async (run: BackgroundRun) => {
    prompts.push(run.prompt)
    const args = (run.mcpServers[0] as McpServer & { args: string[] }).args
    const id = args[args.indexOf("--run") + 1]!
    // As owlit-mcp calls core for the run, on the socket
    return { text: await agent(run.prompt, id, (method, params) => call(method, params, { kind: "socket", run: id })), connectorId: "fake" }
  })
  await call("workspace.open", { path: root })
  await call("initiative.set", { patch: { mode: "onOpen" } })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const emit = (event: Record<string, unknown>) => call("activity.emit", { event: { at: Date.now(), ...event } })
  const reviewed = () =>
    until(() => workspace.tasks.list().find((t) => t.kind === "docs.review" && ["done", "failed", "cancelled"].includes(t.state)), { timeout: 10_000, what: "a review to finish" })
  const journal = () => readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  return { root, call, emit, workspace, reviewed, prompts, journal }
}

type Call = (method: string, params?: unknown, caller?: Caller) => Promise<any>

// What owlit-mcp's docs_add_comment sends core
const leave = (call: Call, run: string, quote: string, text: string) =>
  call("comments.add", { path: "story.md", agent: { run }, comment: { id: `c-${quote.length}`, quote, prefix: "", suffix: "", entries: [{ id: `e-${quote.length}`, text, at: Date.now() }], createdAt: Date.now() } })

describe("Review (Owlit looks at a doc you open that changed)", () => {
  it("reads the doc, comments under the paragraph as its run, records the look, and doesn't look again at an unchanged doc", { timeout: 20_000 }, async () => {
    const { call, emit, reviewed, prompts, journal, workspace } = await setup(async (_prompt, run, call) => {
      await leave(call, run, "Replay ratings track the live ones.", "[Smith 2024](owlit://library/doi-10.1-s) found they drift apart after a week.")
      return "Left 1 comment."
    })
    await emit({ kind: "doc.opened", path: "story.md" })
    const task = await reviewed()
    expect(task).toMatchObject({ state: "done", priority: "background", chatId: expect.any(String), doing: "Reading “story” since your last changes" })
    // The first look reads the whole doc
    expect(prompts[0]).toContain("which you haven't looked at before")
    expect(prompts[0]).toContain("The second claim stands alone.")
    const comments = (await call("comments.all"))
    const [comment] = Object.values(comments).flat() as any[]
    expect(comment).toMatchObject({ quote: "Replay ratings track the live ones.", entries: [{ by: expect.stringMatching(/^o_/), chatId: task.chatId }] })
    expect(await call("docs.owlit", { path: "story.md" })).toMatchObject({ looked: { outcome: "comments", count: 1, seen: paragraphsOf(STORY).map((p) => p.hash) } })
    // The run is a session, not one of the user's chats
    expect(await call("chats.list")).toEqual([])
    expect((await call("chats.get", { id: task.chatId })).startedBy).toBe("owlit")

    await emit({ kind: "doc.closed", path: "story.md" })
    await emit({ kind: "doc.opened", path: "story.md" })
    // The second open is decided once the doc has settled: wait for that decision, not for the settle time
    const evaluations = await until(
      () => {
        const found = journal().filter((l) => l.kind === "evaluation" && l.rule === "docs.reviewOnOpen")
        return found.length >= 2 ? found : undefined
      },
      { timeout: 10_000, what: "the second open's evaluation" },
    )
    expect(workspace.tasks.list().filter((t) => t.kind === "docs.review")).toHaveLength(1)
    expect(evaluations.map((e) => [e.decision, e.reason ?? null])).toEqual([
      ["job", null],
      ["none", "unchanged since Owlit looked"],
    ])
  })

  it("reads only the changed paragraphs next time, and holds what it says while the user is writing there", { timeout: 20_000 }, async () => {
    let turn = 0
    const { root, call, emit, reviewed, prompts, workspace } = await setup(async (_prompt, run, call) => {
      turn++
      if (turn === 2) {
        // The user starts typing in the doc while Owlit is reading it
        await call("activity.emit", { event: { kind: "doc.edited", at: Date.now(), path: "story.md" } })
        await leave(call, run, "A third claim, new today.", "No paper in your library says this.")
        return "Left 1 comment."
      }
      return "Nothing to add."
    })
    await emit({ kind: "doc.opened", path: "story.md" })
    await reviewed()
    expect(await call("docs.owlit", { path: "story.md" })).toMatchObject({ looked: { outcome: "nothing", count: 0 } })
    writeFileSync(path.join(root, "story.md"), `${STORY}\nA third claim, new today.\n`)
    await emit({ kind: "doc.closed", path: "story.md" })
    await emit({ kind: "doc.opened", path: "story.md" })
    await until(() => workspace.tasks.list().filter((t) => t.kind === "docs.review" && t.state === "done").length === 2, { timeout: 10_000, what: "the second review" })
    expect(prompts[1]).toContain("changed since you last looked")
    expect(prompts[1]).toContain("A third claim, new today.")
    expect(prompts[1]).not.toContain("The second claim stands alone.")
    // Held: the user is typing in the doc
    expect(Object.values(await call("comments.all")).flat()).toEqual([])
    await emit({ kind: "doc.closed", path: "story.md" })
    await eventually(async () => expect((Object.values(await call("comments.all")).flat() as any[]).map((c) => c.quote)).toEqual(["A third claim, new today."]))
  })

  it("remembers a dismissed comment and tells the next review; answers a reply under its comment", { timeout: 20_000 }, async () => {
    const { root, call, emit, reviewed, prompts, journal, workspace } = await setup(async (prompt, run, call) => {
      if (prompt.includes("the user has replied")) return "The week-long gap is in their Table 2."
      if (prompts.length === 1) await leave(call, run, "Replay ratings track the live ones.", "They drift apart after a week.")
      return "Left 1 comment."
    })
    await emit({ kind: "doc.opened", path: "story.md" })
    await reviewed()
    const [comment] = Object.values(await call("comments.all")).flat() as any[]

    // A reply of the user's: Owlit answers in the comment, as a run they asked for
    await call("comments.put", { path: "story.md", comment: { ...comment, entries: [...comment.entries, { id: "r1", text: "Where does it say so?", at: Date.now() }] } })
    await until(() => workspace.tasks.list().some((t) => t.kind === "docs.reply" && t.state === "done"), { timeout: 10_000, what: "the reply" })
    const answered = (Object.values(await call("comments.all")).flat() as any[])[0]
    expect(answered.entries.map((e: any) => [e.by.slice(0, 2), e.text])).toEqual([
      ["o_", "They drift apart after a week."],
      ["p_", "Where does it say so?"],
      ["o_", "The week-long gap is in their Table 2."],
    ])
    expect(workspace.tasks.list().find((t) => t.kind === "docs.reply")).toMatchObject({ priority: "asked", subject: `story.md#${comment.id}` })

    await call("comments.dismiss", { path: "story.md", id: comment.id })
    await expect(call("comments.dismiss", { path: "story.md", id: "nope" })).rejects.toThrow()
    writeFileSync(path.join(root, "story.md"), `${STORY}\nOne more line.\n`)
    await emit({ kind: "doc.closed", path: "story.md" })
    await emit({ kind: "doc.opened", path: "story.md" })
    await until(() => prompts.filter((p) => !p.includes("the user has replied")).length >= 2, { timeout: 10_000, what: "the second review's prompt" })
    const second = prompts.filter((p) => !p.includes("the user has replied"))[1]!
    expect(second).toContain("The user dismissed these comments of yours")
    expect(second).toContain("They drift apart after a week.")
    await eventually(() => expect(journal().filter((l) => l.kind.startsWith("feedback.")).map((l) => l.kind)).toEqual(["feedback.dialChanged", "feedback.reply", "feedback.dismiss"]))
  })
  it("lands what it held in the workspace it was made in when the user switches to another", { timeout: 20_000 }, async () => {
    const { root, call, emit, reviewed } = await setup(async (_prompt, run, call) => {
      // The user is typing in the doc while Owlit reads it
      await call("activity.emit", { event: { kind: "doc.edited", at: Date.now(), path: "story.md" } })
      await leave(call, run, "Replay ratings track the live ones.", "They drift apart after a week.")
      return "Left 1 comment."
    })
    await emit({ kind: "doc.opened", path: "story.md" })
    await reviewed()
    expect(Object.values(await call("comments.all")).flat()).toEqual([])
    // A copy of the workspace, with the same doc
    const copy = path.join(path.dirname(root), "copy")
    mkdirSync(copy)
    writeFileSync(path.join(copy, "story.md"), STORY)
    await call("workspace.open", { path: copy })
    await emit({ kind: "doc.closed", path: "story.md" })
    // Landed in the first workspace's files, so nothing more is coming for the copy
    const landed = path.join(root, ".owlit/docs/comments/story.md.jsonl")
    await until(() => existsSync(landed) && readFileSync(landed, "utf8").includes("Replay ratings track the live ones."), { what: "the held comment to land in the first workspace" })
    expect(Object.values(await call("comments.all")).flat()).toEqual([])
    await call("workspace.open", { path: root })
    expect((Object.values(await call("comments.all")).flat() as any[]).map((c) => c.quote)).toEqual(["Replay ratings track the live ones."])
  })
})
