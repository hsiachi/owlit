import type { Caller } from "../rpc/router.ts"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { knownProfile, MY_OWLIT, testSearchPath } from "../test-util.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

const STORY = "# 研究故事\n\n故事从数据集讲起。\n\n研究问题分两层。\n"
const RECORD = "Meetings/P5 周会 2026-10-15 · 解读.md"
// Owlit in the chat the person asked to go through a meeting, as owlit-mcp calls core for it
const CHAT: Caller = { kind: "socket", chatId: "c1" }

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-go-")))
  const root = path.join(base, "ws")
  mkdirSync(path.join(root, "Meetings"), { recursive: true })
  writeFileSync(path.join(root, "story.md"), STORY)
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")), searchPath: testSearchPath })
  cores.push(core)
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const point = (record: string) => ({
    id: `p-${Math.random()}`,
    quote: "故事从数据集讲起。",
    prefix: "",
    suffix: "",
    entries: [{ id: "e1", text: `A point, from ${record}.`, at: 1 }],
    createdAt: 1,
    source: { path: record, label: "" },
  })
  const comments = async () => Object.values(await call("comments.all")).flat() as any[]
  return { root, call, point, comments }
}

describe("Going through material in a chat", () => {
  it("takes a point that names the chat's reading, and core names the reading", async () => {
    const { root, call, point, comments } = await setup()
    await call("agents.writeDoc", { path: RECORD, content: "# The reading\n\nWhat changes.\n" }, CHAT)
    await call("comments.add", { path: "story.md", comment: point(RECORD) }, CHAT)
    expect(await comments()).toMatchObject([{ source: { path: RECORD, label: "P5 周会 2026-10-15 · 解读" }, entries: [{ by: MY_OWLIT }] }])
    expect(readFileSync(path.join(root, "story.md"), "utf8")).toBe(STORY)
  })

  it("refuses a point before its reading, and one naming a doc another chat or the person wrote", async () => {
    const { root, call, point, comments } = await setup()
    await expect(call("comments.add", { path: "story.md", comment: point(RECORD) }, CHAT)).rejects.toThrow("Write the reading with docs_write first")
    await call("agents.writeDoc", { path: RECORD, content: "# The reading\n" }, { kind: "socket", chatId: "c2" })
    await expect(call("comments.add", { path: "story.md", comment: point(RECORD) }, CHAT)).rejects.toThrow("Write the reading with docs_write first")
    writeFileSync(path.join(root, "Meetings/notes.md"), "# Mine\n")
    await expect(call("comments.add", { path: "story.md", comment: point("Meetings/notes.md") }, CHAT)).rejects.toThrow("Write the reading with docs_write first")
    expect(await comments()).toEqual([])
  })

  it("leaves a comment that carries nothing over without a source", async () => {
    const { call, point, comments } = await setup()
    const { source: _none, ...plain } = point(RECORD)
    await call("comments.add", { path: "story.md", comment: plain }, CHAT)
    expect((await comments())[0].source).toBeUndefined()
  })
})
