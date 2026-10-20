import type { Chat } from "@owlit/protocol"
import { chatUri, docUri } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { knownProfile, MY_OWLIT, testSearchPath, until } from "../test-util.ts"

const fake = path.join(import.meta.dirname, "../agents/fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

const STORY = "# 研究故事\n\n故事从数据集讲起。\n\n研究问题分两层。\n"
const MEETING = "# P5 周会 2026-10-15\n\n@时英天 00:10:19\n故事要从任务讲起。\n\n@夏奇 00:11:02\n好，从任务出发。\n"
const MATERIAL = "Meetings/P5 周会 2026-10-15.md"
const RECORD = "Meetings/P5 周会 2026-10-15 · 解读.md"

// A workspace with a doc and a meeting's transcript, its socket up so the fake agent reaches owlit's tools
// as owlit-mcp would, and the fake agent chosen for the work owlit starts
async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-go-")))
  const root = path.join(base, "ws")
  mkdirSync(path.join(root, "Meetings"), { recursive: true })
  writeFileSync(path.join(root, "story.md"), STORY)
  writeFileSync(path.join(root, MATERIAL), MEETING)
  // A short folder: a Unix socket's path has to fit in about a hundred bytes
  const socketDir = realpathSync(mkdtempSync(path.join(tmpdir(), "s-")))
  const core = new Core({ userDataDir: knownProfile(path.join(base, "userData")), socket: { dir: socketDir }, mcp: { command: "owlit-mcp", args: ["--socket-dir", socketDir] }, searchPath: testSearchPath })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await core.settings.update((s) => ({ ...s, connectors: { ...s.connectors, background: agent.id } }))
  // The reply of the chat about the material, once its turn has ended (core may still mark it failed)
  const ended = (chatId: string) =>
    until(
      async () => {
        if ((await call("agents.running")).some((t: { chatId: string }) => t.chatId === chatId)) return undefined
        const reply = ((await call("chats.get", { id: chatId })) as Chat).messages.at(-1)
        return reply?.status === "streaming" ? undefined : reply
      },
      { timeout: 10_000, what: "the Go through to end" },
    )
  const comments = async () => Object.values(await call("comments.all")).flat() as any[]
  return { root, call, ended, comments }
}

describe("Go through", () => {
  it("is a chat about the material whose agent writes the record beside it, then lands its points carried over from it", async () => {
    const { root, call, ended, comments } = await setup()
    const before = statSync(path.join(root, MATERIAL)).mtimeMs
    const { chatId } = await call("docs.goThrough", { path: MATERIAL })
    expect(await ended(chatId)).toMatchObject({ status: "done" })
    const chat: Chat = await call("chats.get", { id: chatId })
    expect(chat).toMatchObject({ startedBy: "owlit", about: { kind: "doc", id: MATERIAL }, role: "reviewer" })
    // Told where the record goes, the docs to read against, and the material, which the chat keeps by name
    const asked = chat.messages[0]!.parts[0] as { text: string }
    expect(asked.text).toContain(`with docs_write at ${RECORD}`)
    expect(asked.text).toContain("the workspace's docs are story.md")
    expect(asked.text).toContain(`(The material, ${MATERIAL}, followed here.)`)
    // The record is Owlit's own new doc, the material below a link and untouched
    const record = readFileSync(path.join(root, RECORD), "utf8")
    expect(record).toContain(`## 原文\n\n- [P5 周会 2026-10-15](${docUri(MATERIAL)})`)
    expect(statSync(path.join(root, MATERIAL)).mtimeMs).toBe(before)
    expect((await call("changes.list", { target: { kind: "doc", path: RECORD } }))[0]).toMatchObject({ actor: MY_OWLIT, action: "create", origin: { chatId } })
    // Its point points back to the record, as core says and not the agent
    expect(await comments()).toMatchObject([{ quote: "故事从数据集讲起。", source: { path: RECORD, label: "P5 周会 2026-10-15 · 解读" }, entries: [{ by: MY_OWLIT, text: `A point, from ${RECORD}.` }] }])
    // Not one of the person's chats
    expect(await call("chats.list")).toEqual([])
  })

  it("refuses a point before the record it points back to", async () => {
    const { root, call, ended, comments } = await setup()
    writeFileSync(path.join(root, MATERIAL), `${MEETING}\nFAKE: comment first\n`)
    const { chatId } = await call("docs.goThrough", { path: MATERIAL })
    expect(await ended(chatId)).toMatchObject({ status: "done", parts: [expect.objectContaining({ text: expect.stringContaining("refused: Write the reading with docs_write first") })] })
    // The one made after the record landed
    expect(await comments()).toMatchObject([{ source: { path: RECORD } }])
  })

  it("says why when it finished without its record, and Retry is a new turn in the same chat", async () => {
    const { root, call, ended } = await setup()
    writeFileSync(path.join(root, MATERIAL), `${MEETING}\nFAKE: no record\n`)
    const { chatId } = await call("docs.goThrough", { path: MATERIAL })
    await until(async () => (await call("chats.startedFor", { kind: "doc" }))[0]?.reply?.status === "error", { what: "the failure" })
    expect((await call("chats.startedFor", { kind: "doc" }))[0]).toMatchObject({ chatId, about: { kind: "doc", id: MATERIAL }, reply: { status: "error", error: "Owlit finished without writing its reading." } })
    // Retry: the same chat, told to try again
    const again = await call("docs.goThrough", { path: MATERIAL })
    expect(again.chatId).toBe(chatId)
    await ended(chatId)
    const chat: Chat = await call("chats.get", { id: chatId })
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(chat.messages[2]!.parts).toEqual([{ type: "text", text: "Try again." }])
  })

  it("goes through a transcript attached to a chat, with its record in Meetings and its link to the chat", async () => {
    const { root, call, ended, comments } = await setup()
    const material = ".owlit/chats/c1/files/周会.txt"
    mkdirSync(path.join(root, ".owlit/chats/c1/files"), { recursive: true })
    writeFileSync(path.join(root, material), MEETING)
    await expect(call("docs.goThrough", { path: ".owlit/chats/c1/files/gone.txt" })).rejects.toThrow("That file isn't there any more.")
    const { chatId } = await call("docs.goThrough", { path: material })
    expect(await ended(chatId)).toMatchObject({ status: "done" })
    expect(readFileSync(path.join(root, "Meetings/周会 · 解读.md"), "utf8")).toContain(`- [周会](${chatUri("c1")})`)
    expect((await comments())[0]).toMatchObject({ source: { path: "Meetings/周会 · 解读.md" } })
  })

  it("asks only for text with something in it", async () => {
    const { root, call } = await setup()
    await expect(call("docs.goThrough", { path: "Meetings/slides.pdf" })).rejects.toThrow()
    writeFileSync(path.join(root, "Meetings/empty.md"), "\n")
    await expect(call("docs.goThrough", { path: "Meetings/empty.md" })).rejects.toThrow("There is nothing in it to go through.")
  })
})
