import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Background } from "./background.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-bg-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "story.md"), "# Story\n\nThe first claim.\n")
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  const background = (core as unknown as { background: Background }).background
  return { root, call, background, agent: agent.id as string }
}

const comment = (by: "owlit" | "you", id = "c1") => ({
  id,
  quote: "The first claim.",
  prefix: "",
  suffix: "",
  entries: [{ id: `${id}-e`, by, text: "A word on it.", at: 1 }],
  createdAt: 1,
})

describe("what Owlit may write without being asked", () => {
  it("a background session can't write a file", async () => {
    const { root, background, agent } = await setup()
    await expect(background.run({ prompt: "write notes.md hello", root, mcpServers: [], signal: new AbortController().signal, connectorId: agent })).rejects.toThrow()
    expect(existsSync(path.join(root, "notes.md"))).toBe(false)
  })

  it("an agent adds Owlit's own comments only, and never over one that is there", async () => {
    const { call } = await setup()
    await call("comments.add", { path: "story.md", comment: comment("owlit"), agent: {} })
    await expect(call("comments.add", { path: "story.md", comment: comment("you", "c2"), agent: {} })).rejects.toMatchObject({ message: "An agent leaves only Owlit's own comments." })
    // The user's own comment, then an agent trying to write over it
    await call("comments.add", { path: "story.md", comment: comment("you", "c3") })
    await expect(call("comments.add", { path: "story.md", comment: { ...comment("owlit", "c3") }, agent: {} })).rejects.toMatchObject({ message: "That comment is already there; an agent adds new ones." })
    const all = await call("comments.all")
    expect(Object.values(all).flat().map((c: any) => [c.id, c.entries[0].by])).toEqual([
      ["c1", "owlit"],
      ["c3", "you"],
    ])
  })
})
