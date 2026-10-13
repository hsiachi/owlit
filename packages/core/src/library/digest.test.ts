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
    expect(digest).toMatch(/^# Paper doi-10\.1-a\n\n## Question\n/)
    expect(digest).not.toContain("```")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1-a/digest.json"), "utf8"))).toMatchObject({ by: expect.stringMatching(/^custom-/) })
    expect((await call("library.list")).papers[0]).toMatchObject({ hasDigest: true, digestAt: expect.any(Number) })
    expect(await call("chats.list")).toEqual([])
  })

  it("writes one in the background when a paper is starred", async () => {
    const { call, addPaper, digestDone } = await setup()
    await addPaper("doi-10.1-b")
    await call("library.update", { id: "doi-10.1-b", patch: { starred: true } })
    expect(await digestDone("doi-10.1-b")).toMatchObject({ state: "done", priority: "background" })
  })

  it("writes none for papers merely added, and never replaces a note that is there", async () => {
    const { root, call, workspace, addPaper } = await setup()
    for (let i = 0; i < 50; i++) await addPaper(`doi-10.1-bulk${i}`)
    await new Promise((r) => setTimeout(r, 200))
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])

    writeFileSync(path.join(root, "library/papers/doi-10.1-bulk0/digest.md"), "# From pitta\n\nKept as it is.\n")
    await call("activity.emit", { event: { kind: "paper.opened", at: Date.now(), paperId: "doi-10.1-bulk0" } })
    await call("library.requestDigest", { id: "doi-10.1-bulk0" })
    await new Promise((r) => setTimeout(r, 200))
    expect(workspace.tasks.list().filter((t) => t.kind === "paper.digest")).toEqual([])
    expect(readFileSync(path.join(root, "library/papers/doi-10.1-bulk0/digest.md"), "utf8")).toBe("# From pitta\n\nKept as it is.\n")
    await expect(call("library.writeDigest", { id: "doi-10.1-bulk0", text: "# Other\n" })).rejects.toThrow("already has a reading note")
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
