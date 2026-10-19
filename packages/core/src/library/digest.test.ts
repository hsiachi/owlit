import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Task } from "@owlit/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Background } from "../agents/background.ts"
import { Core } from "../core.ts"
import { TaskStore } from "../tasks/index.ts"
import { until, testSearchPath } from "../test-util.ts"
import { workspaceDataDir, type Workspace } from "../workspace/workspace.ts"
import { cleanDigest } from "./library.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
  vi.restoreAllMocks()
})

// A workspace whose background agent is the fake one, and a paper with its text read
async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-digest-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const core = new Core({ userDataDir: path.join(base, "userData"), searchPath: testSearchPath })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  const addPaper = async (id: string, text = true) => {
    await call("library.add", { paper: { id, title: `Paper ${id}`, authors: ["A. Author"], ids: { doi: `10.1/${id}` } } })
    if (text) writeFileSync(path.join(root, "library/papers", id, "text.md"), "<!-- page 1 -->\n\nThe paper's text.\n")
  }
  const digestDone = (id: string) =>
    until(
      () => {
        const task = workspace.tasks.list().find((t) => t.kind === "paper.digest" && t.subject === id)
        return task && ["done", "failed", "cancelled"].includes(task.state) ? task : undefined
      },
      { what: `the digest of ${id}` },
    )
  const journal = () => readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  // Stars the paper and waits for the digest rule to say, in the journal, why it writes nothing
  const starredForNothing = async (id: string) => {
    await call("library.update", { id, patch: { starred: true } })
    const found = await until(() => journal().find((l) => l.kind === "evaluation" && l.rule === "digest.onStar" && l.subject === id), { what: `digest.onStar's decision on ${id}` })
    expect(found.decision).toBe("none")
    return found.reason as string
  }
  return { root, call, workspace, addPaper, digestDone, starredForNothing }
}

describe("digests", () => {
  it("writes one when asked, with no chat to show for it; opening a paper's page asks for nothing", async () => {
    const { root, call, workspace, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-opened")
    await addPaper("doi-10.1-a")
    await call("activity.emit", { event: { kind: "paper.opened", at: Date.now(), paperId: "doi-10.1-opened" } })
    await call("library.requestDigest", { id: "doi-10.1-a" })
    expect(await digestDone("doi-10.1-a")).toMatchObject({ state: "done", priority: "asked" })
    // Heard before the ask, and queued nothing
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest").map((t) => t.subject)).toEqual(["doi-10.1-a"])
    const digest = readFileSync(path.join(root, "library/papers/doi-10.1-a/digest.md"), "utf8")
    // Unset, the language is the system's; a test host has none, so English
    expect(digest).toMatch(/^# Paper doi-10\.1-a\n\n## Summary\n\n- \*\*Background\*\*: Written in English, having seen 0 pictures\./)
    expect(digest).toContain("## Details")
    expect(digest).not.toContain("```")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1-a/digest.json"), "utf8"))).toMatchObject({ format: 2, language: "en", by: expect.stringMatching(/^custom-/) })
    expect((await call("library.list")).papers[0]).toMatchObject({ hasDigest: true, digestAt: expect.any(Number) })
    expect((await call("library.list")).papers[0].digestOutdated).toBeUndefined()
    expect(await call("chats.list")).toEqual([])
  })

  it("keeps its run as a session the paper's row opens: why, steps, result; not in the chat list", async () => {
    const { call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-r")
    await call("library.requestDigest", { id: "doi-10.1-r" })
    const task = await digestDone("doi-10.1-r")
    expect(task).toMatchObject({ state: "done", chatId: expect.any(String), doing: "Writing the digest of “Paper doi-10.1-r”" })
    const run = await call("chats.get", { id: task.chatId })
    expect(run).toMatchObject({ startedBy: "owlit", run: { taskId: task.id, kind: "paper.digest", subject: "doi-10.1-r" }, title: "Digest of “Paper doi-10.1-r”" })
    expect(run.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: "You asked for a digest of “Paper doi-10.1-r”." }] })
    // The note itself is the paper's; the session says it was written
    expect(run.messages[1]).toMatchObject({ role: "assistant", status: "done", parts: [{ type: "text", text: "The digest is written: [Paper doi-10.1-r](owlit://library/doi-10.1-r)" }] })
    expect(await call("chats.list")).toEqual([])
  })

  it("writes in the language Settings asks for, and says when a note is in another", async () => {
    const { root, call, addPaper, digestDone } = await setup()
    // A word typed before the setting was a list means the listed language
    await call("settings.update", { patch: { library: { digestLanguage: "中文" } } })
    expect((await call("settings.get")).library).toMatchObject({ digestLanguage: "zh-Hans", digestLanguageSystem: "en" })
    await addPaper("doi-10.1-zh")
    await call("library.requestDigest", { id: "doi-10.1-zh" })
    await digestDone("doi-10.1-zh")
    expect(readFileSync(path.join(root, "library/papers/doi-10.1-zh/digest.md"), "utf8")).toContain("Written in Simplified Chinese (简体中文)")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1-zh/digest.json"), "utf8"))).toMatchObject({ language: "zh-Hans" })

    await call("settings.update", { patch: { library: { digestLanguage: "ja" } } })
    expect((await call("library.list")).papers[0].digestOutdated).toBe("language")
  })

  it("writes one in the background when a paper is starred", async () => {
    const { call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-b")
    await call("library.update", { id: "doi-10.1-b", patch: { starred: true } })
    expect(await digestDone("doi-10.1-b")).toMatchObject({ state: "done", priority: "background" })
  })

  it("writes none for papers merely added, and replaces a note that is there only when asked", async () => {
    const { root, call, workspace, addPaper, digestDone, starredForNothing } = await setup()
    for (let i = 0; i < 50; i++) await addPaper(`doi-10.1-bulk${i}`)

    const note = path.join(root, "library/papers/doi-10.1-bulk0/digest.md")
    writeFileSync(note, "# From pitta\n\nKept as it is.\n")
    // Asked for, the decision is made before the call returns
    await call("library.requestDigest", { id: "doi-10.1-bulk0" })
    // The rule's decision on the star comes after the adds' events: no digest for any of them by then
    expect(await starredForNothing("doi-10.1-bulk0")).toBe("has a digest")
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])
    expect(readFileSync(note, "utf8")).toBe("# From pitta\n\nKept as it is.\n")
    // Written another way than owlit writes notes now: the page offers to rewrite it
    const paper = async () => (await call("library.list")).papers.find((p: { id: string }) => p.id === "doi-10.1-bulk0")
    expect((await paper()).digestOutdated).toBe("format")

    await call("library.requestDigest", { id: "doi-10.1-bulk0", rewrite: true })
    expect(await digestDone("doi-10.1-bulk0")).toMatchObject({ state: "done", priority: "asked" })
    expect(readFileSync(note, "utf8")).toMatch(/^# Paper doi-10\.1-bulk0\n\n## Summary/)
    expect((await paper()).digestOutdated).toBeUndefined()
  })

  it("shows the agent the paper's figures and lists them, when it has some", async () => {
    const { root, call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-fig")
    const dir = path.join(root, "library/papers/doi-10.1-fig")
    // As paper.figures leaves them; a PDF so the figures count as the paper's
    writeFileSync(path.join(dir, "paper.pdf"), "%PDF-1.4\n%%EOF\n")
    mkdirSync(path.join(dir, "figures"))
    writeFileSync(path.join(dir, "figures/figure-1.png"), "png bytes")
    writeFileSync(
      path.join(dir, "figures.json"),
      JSON.stringify({ version: 1, source: "layout", at: Date.now(), figures: [{ id: "figure-1", kind: "figure", label: "Figure 1", caption: "Figure 1: A chart.", page: 0, rect: { x: 1, y: 2, w: 3, h: 4 }, file: "figure-1.png" }] }),
    )
    await call("library.requestDigest", { id: "doi-10.1-fig" })
    await digestDone("doi-10.1-fig")
    const digest = readFileSync(path.join(dir, "digest.md"), "utf8")
    expect(digest).toContain("having seen 1 pictures")
    expect(digest).toContain("![Figure](figure-1)")
  })

  it("records how many pictures the agent saw, for the header to say what the digest was written from", async () => {
    const { call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-plain")
    await call("library.requestDigest", { id: "doi-10.1-plain" })
    await digestDone("doi-10.1-plain")
    expect(await call("library.digestSource", { id: "doi-10.1-plain" })).toEqual({ pictures: 0, language: "en", textPages: 1 })
  })

  it("waits for a paper's text before writing, and skips papers with nothing to read", async () => {
    const { root, call, workspace, addPaper, starredForNothing } = await setup()
    await addPaper("doi-10.1-none", false)
    await call("library.requestDigest", { id: "doi-10.1-none" })
    // Its text is read first, and finds nothing
    await until(() => workspace.tasks.list().some((t) => t.kind === "paper.text" && t.subject === "doi-10.1-none" && ["done", "failed", "cancelled"].includes(t.state)), { what: "the paper's text task" })
    expect(await starredForNothing("doi-10.1-none")).toBe("nothing to read")
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])
    expect(existsSync(path.join(root, "library/papers/doi-10.1-none/digest.md"))).toBe(false)
  })
})

describe("background runs at open", () => {
  it("start only once owlit's tools are reachable: a digest left queued gets owlit-mcp", async () => {
    const { root, addPaper } = await setup()
    await addPaper("doi-10.1-left")
    await cores.pop()!.dispose()
    // The last session queued the digest and stopped before it ran
    const userDataDir = path.join(path.dirname(root), "userData")
    const store = new TaskStore(path.join(workspaceDataDir(userDataDir, root), "tasks"))
    const left: Task = { id: "left-digest", kind: "paper.digest", subject: "doi-10.1-left", lane: "agent", priority: "background", state: "queued", attempts: 0, createdAt: Date.now() }
    store.record(left, [left])
    await store.flush()

    const runs: unknown[] = []
    vi.spyOn(Background.prototype, "run").mockImplementation(async (run) => {
      runs.push(run.mcpServers)
      return { text: `# Paper doi-10.1-left\n\n## Summary\n\n${"- A line of the note.\n".repeat(12)}`, connectorId: "fake" }
    })
    // A short folder: a Unix socket's path has to fit in about a hundred bytes
    const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
    const core = new Core({ userDataDir, socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: [] }, searchPath: testSearchPath })
    cores.push(core)
    await core.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const workspace = (core as unknown as { workspace: Workspace }).workspace
    expect(await workspace.tasks.wait("left-digest")).toMatchObject({ state: "done" })
    expect(runs).toEqual([[expect.objectContaining({ name: "owlit", command: "owlit-mcp", args: ["--workspace", root] })]])
  })
})

describe("cleanDigest", () => {
  it("drops a code fence and words before the title", () => {
    expect(cleanDigest("Here it is:\n# T\n\n## Question\nQ.")).toBe("# T\n\n## Question\nQ.\n")
    expect(cleanDigest("```markdown\n# T\n\nBody\n```")).toBe("# T\n\nBody\n")
  })
})
