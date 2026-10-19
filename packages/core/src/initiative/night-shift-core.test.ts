import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { McpServer } from "@agentclientprotocol/sdk"
import type { RpcNotification } from "@owlit/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Background, type BackgroundRun } from "../agents/background.ts"
import { Core } from "../core.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { until } from "../test-util.ts"
import { halfDone, sectionsOf, WEEK_MS } from "./scan.ts"

// The night shift through core: what its runs write, where it lands, what the window hears, and what Home
// reads of it. The rules' timing is in night-shift.test.ts; here the runs are queued as the rules would.

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  vi.restoreAllMocks()
})

const DRAFT = "# Draft\n\nReplay ratings drift from live ones.\n\n## Related work\n\n## Method\n\nTwelve people.\n"

type Call = (method: string, params?: unknown) => Promise<any>

async function setup(agent: (prompt: string, run: string, call: Call) => Promise<string>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-night-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "draft.md"), DRAFT)
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: [] } })
  cores.push(core)
  const heard: RpcNotification[] = []
  core.onNotify((n) => heard.push(n))
  const call: Call = async (method, params) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const prompts: string[] = []
  vi.spyOn(Background.prototype, "run").mockImplementation(async (run: BackgroundRun) => {
    prompts.push(run.prompt)
    const args = (run.mcpServers[0] as McpServer & { args: string[] }).args
    return { text: await agent(run.prompt, args[args.indexOf("--run") + 1]!, call), connectorId: "fake" }
  })
  await call("workspace.open", { path: root })
  await call("initiative.set", { patch: { mode: "away" } })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const emit = (event: Record<string, unknown>) => call("activity.emit", { event: { at: Date.now(), ...event } })
  const finished = (kind: string) =>
    until(() => workspace.tasks.list().find((t) => t.kind === kind && ["done", "failed", "cancelled"].includes(t.state)), { timeout: 10_000, what: `a ${kind} to finish` })
  const comments = async () => (Object.values(await call("comments.all")).flat() as any[])
  const journal = () => readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  return { root, call, emit, workspace, finished, comments, journal, prompts, heard }
}

const leave = (call: Call, run: string, quote: string, text: string) =>
  call("comments.add", { path: "draft.md", agent: { run }, comment: { id: `c-${quote.length}`, quote, prefix: "", suffix: "", entries: [{ id: `e-${quote.length}`, by: "owlit", text, at: Date.now() }], createdAt: Date.now() } })

describe("The night shift, through core", () => {
  it("holds what a run made while the user was away for as long as they are in that doc, and says nothing when it lands", { timeout: 20_000 }, async () => {
    const { call, emit, workspace, finished, comments, heard } = await setup(async (_prompt, run, call) => {
      await leave(call, run, "Replay ratings drift from live ones.", "Lee 2024 found they track each other.")
      return "Left 1 comment."
    })
    // Back from being away, reading the doc without typing
    await emit({ kind: "doc.opened", path: "draft.md" })
    workspace.tasks.enqueue("docs.reviewSettled", "draft.md", "background")
    const task = await finished("docs.reviewSettled")
    expect(task).toMatchObject({ state: "done", doing: "Reading “draft” after your edits" })
    expect(await comments()).toEqual([])
    await emit({ kind: "doc.closed", path: "draft.md" })
    await vi.waitFor(async () => expect((await comments()).map((c) => c.quote)).toEqual(["Replay ratings drift from live ones."]), { timeout: 5_000, interval: 20 })
    // Recorded in the change log (Undo), but no "Note added" toast
    expect(heard.some((n) => n.method === "comments.changed")).toBe(true)
    expect(heard.some((n) => n.method === "changes.added")).toBe(false)
    expect(await workspace.changes.list({ target: { kind: "comment", path: "draft.md" } })).toMatchObject([{ actor: expect.stringMatching(/^o_/), action: "create" }])

    // Home's Since you left reads the run
    const runs = await call("chats.runs", { since: 0 })
    expect(runs).toEqual([expect.objectContaining({ title: "Looked at “draft” after your edits", startedBy: "owlit", ended: "done", run: expect.objectContaining({ kind: "docs.reviewSettled", subject: "draft.md" }) })])
    expect(await call("chats.runs", { since: runs[0].endedAt })).toEqual([])
  })

  it("looks over the docs: folds Owlit's comments left behind, and comments on a section half done for a week", { timeout: 20_000 }, async () => {
    const { call, workspace, finished, comments, prompts } = await setup(async (_prompt, run, call) => {
      await leave(call, run, "## Related work", "[Gathering on replays](owlit://threads/t-1) has six papers for this.")
      return "Left 1 comment."
    })
    const old = Date.now() - WEEK_MS - 1000
    await call("comments.add", {
      path: "draft.md",
      comment: { id: "stale", quote: "Replay ratings track the live ones.", prefix: "", suffix: "", entries: [{ id: "e1", by: "owlit", text: "Lee 2024 disagrees.", at: old }], createdAt: old },
    })
    // Found half done a week ago (the look before this one)
    const firstSeen = Object.fromEntries(halfDone(sectionsOf(DRAFT)).map((s) => [s.key, s.title === "Related work" ? old : Date.now()]))
    await workspace.docs.setHalfDone("draft.md", firstSeen)

    workspace.tasks.enqueue("docs.scan", "workspace", "background")
    await finished("docs.scan")
    const all = await comments()
    expect(all.find((c) => c.id === "stale")).toMatchObject({ foldedAt: expect.any(Number) })
    expect(all.filter((c) => !c.foldedAt).map((c) => c.quote)).toEqual(["## Related work"])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("the heading «## Related work»")
    expect(prompts[0]).not.toContain("Method")
    // Once a section has had its comment, the next look says nothing about it
    workspace.tasks.enqueue("docs.scan", "workspace", "background")
    await until(() => workspace.tasks.list().filter((t) => t.kind === "docs.scan" && t.state === "done").length === 2, { timeout: 10_000, what: "the second docs.scan" })
    expect(prompts).toHaveLength(1)
    expect((await call("chats.runs", { since: 0 })).map((r: any) => r.title)).toEqual(["Looked over your docs"])
  })

  it("hears a paper the user adds and one they read in full, and waits for them to be away", { timeout: 20_000 }, async () => {
    const { root, call, emit, journal } = await setup(async () => "Nothing to add.")
    await call("library.add", { paper: { id: "doi-10.1-a", title: "Paper A", authors: ["A. Author"], ids: { doi: "10.1/a" } } })
    writeFileSync(path.join(root, "library/papers/doi-10.1-a/text.md"), Array.from({ length: 5 }, (_, i) => `<!-- page ${i + 1} -->\n\nPage ${i + 1}.\n`).join("\n"))
    const now = Date.now()
    await emit({ kind: "paper.opened", at: now, paperId: "doi-10.1-a" })
    for (const page of [1, 2, 3]) await emit({ kind: "paper.dwell", at: now + page, paperId: "doi-10.1-a", page, seconds: 20 })
    await emit({ kind: "paper.closed", at: now + 10, paperId: "doi-10.1-a" })
    const evaluations = (rule: string) =>
      until(
        () => {
          const found = journal().filter((l) => l.kind === "evaluation" && l.rule === rule)
          return found.length ? found : undefined
        },
        { what: `an evaluation of ${rule}` },
      )
    expect((await evaluations("paper.landed")).map((e) => [e.decision, e.reason])).toEqual([["defer", "waiting for the user to be away"]])
    expect((await evaluations("paper.readInFull")).map((e) => [e.subject, e.decision])).toEqual([["doi-10.1-a", "defer"]])
    await emit({ kind: "idle", seconds: 30 })
    // The two rules run apart once the user is away: wait for both, in whichever order they land
    await vi.waitFor(
      () =>
        expect(journal().filter((l) => l.kind === "evaluation" && l.decision !== "defer").map((e) => [e.rule, e.subject, e.decision, e.reason ?? null])).toEqual(
          expect.arrayContaining([
            ["paper.landed", "doi-10.1-a", "job", null],
            ["paper.landed", "doi-10.1-a", "none", "no threads to bring it to"],
            ["paper.readInFull", "doi-10.1-a", "none", "nothing of Owlit's leans on it"],
          ]),
        ),
      { timeout: 10_000 },
    )
  })
})
