import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { cleanDigest } from "./library.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

// A workspace whose background agent is the fake one, and a paper with its text read
async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-digest-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const core = new Core({ userDataDir: path.join(base, "userData") })
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
  const digestDone = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const task = workspace.tasks.list().find((t) => t.kind === "paper.digest" && t.subject === id)
      if (task && ["done", "failed", "cancelled"].includes(task.state)) return task
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error("no digest task finished")
  }
  return { root, call, workspace, addPaper, digestDone }
}

describe("reading notes", () => {
  it("writes one when a paper's page is opened, with no chat to show for it", async () => {
    const { root, call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-a")
    await call("activity.emit", { event: { kind: "paper.opened", at: Date.now(), paperId: "doi-10.1-a" } })
    expect(await digestDone("doi-10.1-a")).toMatchObject({ state: "done", priority: "waiting" })
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
    const { root, call, workspace, addPaper, digestDone } = await setup()
    for (let i = 0; i < 50; i++) await addPaper(`doi-10.1-bulk${i}`)
    await new Promise((r) => setTimeout(r, 200))
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])

    const note = path.join(root, "library/papers/doi-10.1-bulk0/digest.md")
    writeFileSync(note, "# From pitta\n\nKept as it is.\n")
    await call("activity.emit", { event: { kind: "paper.opened", at: Date.now(), paperId: "doi-10.1-bulk0" } })
    await call("library.requestDigest", { id: "doi-10.1-bulk0" })
    await new Promise((r) => setTimeout(r, 200))
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

  it("waits for a paper's text before writing, and skips papers with nothing to read", async () => {
    const { root, call, workspace, addPaper } = await setup()
    await addPaper("doi-10.1-none", false)
    await call("library.requestDigest", { id: "doi-10.1-none" })
    await new Promise((r) => setTimeout(r, 100))
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])
    expect(existsSync(path.join(root, "library/papers/doi-10.1-none/digest.md"))).toBe(false)
  })
})

describe("cleanDigest", () => {
  it("drops a code fence and words before the title", () => {
    expect(cleanDigest("Here it is:\n# T\n\n## Question\nQ.")).toBe("# T\n\n## Question\nQ.\n")
    expect(cleanDigest("```markdown\n# T\n\nBody\n```")).toBe("# T\n\nBody\n")
  })
})
