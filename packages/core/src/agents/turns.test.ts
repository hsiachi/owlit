import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { cannotRead, ownTurnOver, sendsPictures } from "./profiles.ts"
import { attachmentBlocks, promptBlocks } from "./turns.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-turns-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "notes.md"), "twelve chars")
  const core = new Core({ userDataDir: path.join(base, "userData"), lateQuietMs: 300 })
  cores.push(core)
  const updates: SessionUpdate[] = []
  core.onNotify((n: RpcNotification) => {
    if (n.method === "chat.update") updates.push((n.params as { update: SessionUpdate }).update)
  })
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const agent = await call("agents.add", { name: "Fake", command: `"${process.execPath}" "${fake}"` })
  await call("chats.create", { chat: { id: "c1", title: "t", createdAt: 1, updatedAt: 1, pinned: false } })
  let n = 0
  const send = (text: string, extra: object = {}) => {
    n++
    return call("agents.prompt", {
      chatId: "c1",
      connectorId: agent.id,
      input: { text, mentions: [], attachments: [] },
      userMessage: { id: `u${n}`, role: "user", createdAt: n * 10, parts: [{ type: "text", text }] },
      assistantMessageId: `a${n}`,
      ...extra,
    })
  }
  const text = () => updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text).join("")
  return { core, call, send, updates, text, root, agent }
}

describe("turns", () => {
  it("streams an answer and saves both messages", async () => {
    const { send, text, call, root } = await setup()
    expect(await send("hello there")).toEqual({ stopReason: "end_turn" })
    expect(text()).toBe("echo: hello there (small/ask/low)")
    const chat = await call("chats.get", { id: "c1" })
    expect(chat.messages.map((m: any) => [m.id, m.status ?? null])).toEqual([["u1", null], ["a1", "done"]])
    expect(chat.messages[1].parts).toEqual([{ type: "text", text: "echo: hello there (small/ask/low)" }])
    await call("chats.get", { id: "c1" })
    expect(Object.keys(JSON.parse(readFileSync(path.join(root, ".owlit/chats/c1.json"), "utf8")).sessions)).toHaveLength(1)
  })

  it("tells a new session owlit's rules before its first prompt, and only then", async () => {
    const { send, updates, call } = await setup()
    await send("rules?")
    await send("rules?")
    const said = updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text)
    expect(said).toEqual(["got the rules", "no rules this time"])
    // The preamble is the agent's, not the chat's
    const saved = await call("chats.get", { id: "c1" })
    expect(JSON.stringify(saved.messages)).not.toContain("owlit agent rules")
    expect(await call("agents.rules")).toMatch(/^owlit agent rules, version 10/)
  })

  it("puts owlit's words before the user's: rules, role, the conversation so far, then a line, then the message", () => {
    const texts = (blocks: ReturnType<typeof promptBlocks>) => blocks.map((b) => (b as { text: string }).text.split("\n")[0])
    const input = { text: "hi", mentions: [], attachments: [] }
    expect(texts(promptBlocks(input, "/ws", "earlier", true, undefined, "[owlit] In this chat Owlit works as Reviewer"))).toEqual([
      "[owlit] This session runs inside owlit. The user's workspace is /ws.",
      "[owlit] In this chat Owlit works as Reviewer",
      "The conversation so far, for context:",
      "[owlit] The user's message follows.",
      "hi",
    ])
    // Nothing of owlit's to say: just the message
    expect(texts(promptBlocks(input, "/ws", null))).toEqual(["hi"])
  })

  it("says where a selected passage came from: a page of the paper, or Owlit's digest of it", () => {
    const source = { kind: "paper" as const, id: "p1", uri: "owlit://library/p1", title: "A paper" }
    const said = (selection: { page?: number; inDigest?: boolean }) =>
      promptBlocks({ text: "why?", mentions: [], attachments: [], selection: { text: "a claim", source, ...selection } }, "/ws", null)
        .map((b) => (b as { text?: string }).text ?? "")
        .find((t) => t.startsWith("The user selected"))
    expect(said({ page: 3 })).toBe("The user selected this passage in A paper, on page 3:\n> a claim")
    expect(said({ inDigest: true })).toContain("in Owlit's digest of A paper (its digest.md, written from the full text; check the paper itself")
  })

  it("gives the agent each attached file as a link to owlit's copy, and an image as a picture too", async () => {
    const { send, text, call, root } = await setup()
    const { file } = await call("chats.attach", { chatId: "c1", name: "shot.png", mimeType: "image/png", data: Buffer.from("png").toString("base64") })
    await send("whole prompt", { input: { text: "whole prompt", mentions: [], attachments: [file] } })
    const abs = path.join(root, ".owlit/chats/c1/files/shot.png")
    expect(text()).toContain(`The user attached a file. owlit keeps a copy of each in the workspace; leave them unchanged:\n- shot.png: ${abs}`)
    expect(text()).toContain(`[file://${abs}] [image]`)
  })

  it("leaves pictures out where the agent can't take them, and says when a copy is gone", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-blocks-")))
    mkdirSync(path.join(root, ".owlit/chats/c1/files"), { recursive: true })
    writeFileSync(path.join(root, ".owlit/chats/c1/files/My shot.png"), "png")
    const shot = { id: "a", name: "My shot.png", size: 3, mimeType: "image/png", path: ".owlit/chats/c1/files/My shot.png" }
    const gone = { id: "b", name: "gone.pdf", size: 3, mimeType: "application/pdf", path: ".owlit/chats/c1/files/gone.pdf" }
    const old = { id: "c", name: "old.docx", size: 3, mimeType: "" }
    const types = (blocks: Awaited<ReturnType<typeof attachmentBlocks>>) => blocks.map((b) => b.type)
    const withPicture = await attachmentBlocks([shot], root, true)
    expect(types(withPicture)).toEqual(["text", "resource_link", "image"])
    expect(withPicture[1]).toMatchObject({ uri: `file://${root}/.owlit/chats/c1/files/My%20shot.png`, name: "My shot.png", mimeType: "image/png", size: 3 })
    expect(withPicture[2]).toMatchObject({ data: Buffer.from("png").toString("base64"), mimeType: "image/png" })
    const blocks = await attachmentBlocks([shot, gone, old], root, false)
    expect(types(blocks)).toEqual(["text", "resource_link", "text", "text"])
    expect(blocks.slice(2).map((b) => (b as { text: string }).text)).toEqual([
      "(The user attached gone.pdf, but owlit no longer has a copy of it.)",
      "(The user attached old.docx, but owlit no longer has a copy of it.)",
    ])
    expect(await attachmentBlocks([], root, true)).toEqual([])
  })

  it("knows which agents take pictures and which files each can't read", () => {
    const images = { agentCapabilities: { promptCapabilities: { image: true } } }
    expect(sendsPictures("claude-code", images, "opus")).toBe(true)
    expect(sendsPictures("codex", images, "gpt-6-sol")).toBe(true)
    expect(sendsPictures("codex", images, "gpt-oss-120b")).toBe(false)
    expect(sendsPictures("gemini-cli", { agentCapabilities: {} })).toBe(false)
    expect(cannotRead("owlit-engine")).toEqual(["word", "other"])
    expect(cannotRead("claude-code")).toEqual([])
  })

  it("tells a new session the user's name when they gave one", () => {
    const first = (name?: string) => (promptBlocks({ text: "hi", mentions: [], attachments: [] }, "/ws", null, true, name)[0] as { text: string }).text
    expect(first("Xia")).toContain("The user's name is Xia")
    expect(first()).not.toContain("The user's name")
  })

  it("sets the model and effort the chat asks for, and leaves the mode of an agent owlit has no guard for", async () => {
    const { send, text } = await setup()
    await send("one", { modelId: "large", role: "coauthor", effortId: "high" })
    expect(text()).toContain("(large/ask/high)")
  })

  it("refuses a Reviewer's request to run something before the user sees it", async () => {
    const { send, updates, text } = await setup()
    await send("needs permission", { role: "reviewer" })
    expect(updates.some((u) => u.type === "permission_request")).toBe(false)
    expect(text()).toBe("you chose no")
  })

  it("decides consent for owlit's own tools by the chat's role, asking the user when the role says so", async () => {
    const { send, updates, call } = await setup()
    // Between turns the saved role decides, and nobody can be asked
    await call("chats.update", { id: "c1", patch: { role: "reviewer" } })
    expect(await call("agents.consent", { chatId: "c1", action: "add_paper", title: "Add a paper" })).toMatchObject({ allowed: false })
    await call("chats.update", { id: "c1", patch: { role: "assistant" } })
    expect(await call("agents.consent", { chatId: "c1", action: "add_paper", title: "Add a paper" })).toEqual({ allowed: true })
    expect(await call("agents.consent", { chatId: "c1", action: "delete", title: "Delete old" })).toMatchObject({ allowed: false })
    // During an Assistant's turn a delete is asked in the chat, as a tool call with the card
    const turn = send("slow please", { role: "assistant" })
    // The turn is under way once the agent says something (a cold start takes longer than any fixed wait)
    while (!updates.some((u) => u.type === "agent_message_chunk")) await sleep(20)
    const asked = call("agents.consent", { chatId: "c1", action: "delete", title: "Delete old" })
    while (!updates.some((u) => u.type === "permission_request")) await sleep(20)
    const ask = updates.find((u) => u.type === "permission_request") as Extract<SessionUpdate, { type: "permission_request" }>
    expect(ask).toMatchObject({ title: "Delete old", kind: "delete" })
    await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "allow" })
    expect(await asked).toEqual({ allowed: true })
    await call("agents.cancel", { chatId: "c1" })
    await turn
  })

  it("keeps an agent's own agents apart: their steps, their questions and their reports", async () => {
    const { send, updates, call, text } = await setup()
    const turn = send("use agents")
    while (!updates.some((u) => u.type === "permission_request")) await sleep(20)
    const ask = updates.find((u) => u.type === "permission_request") as Extract<SessionUpdate, { type: "permission_request" }>
    // The question comes from the agent's own session, and says which agent asks
    expect(ask).toMatchObject({ toolCallId: "b1", agentId: "agent-b" })
    await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "yes" })
    expect(await turn).toEqual({ stopReason: "end_turn" })
    expect(text()).toBe("both agents are done")
    const saved = (await call("chats.get", { id: "c1" })).messages[1]
    const agents = saved.parts.filter((p: any) => p.type === "agent")
    expect(agents).toEqual([
      { type: "agent", agentId: "agent-a", title: "Read the notes", status: "done", report: "The notes say twelve chars." },
      { type: "agent", agentId: "agent-b", title: "Fix the title", status: "done", report: "The user chose yes." },
    ])
    // Each step is marked as its agent's
    const steps = saved.parts.filter((p: any) => p.type === "tool_call")
    expect(steps.map((p: any) => [p.toolCallId, p.agentId, p.status])).toEqual([
      ["a1", "agent-a", "completed"],
      ["a2", "agent-a", "pending"],
      ["b1", "agent-b", "completed"],
      ["b2", "agent-b", "pending"],
    ])
    expect(saved.parts.find((p: any) => p.type === "permission")).toMatchObject({ agentId: "agent-b", outcome: "allow_once" })
  })

  it("asks permission and passes on the answer; Reject reaches the agent", async () => {
    const { send, updates, call, text } = await setup()
    const turn = send("needs permission")
    while (!updates.some((u) => u.type === "permission_request")) await sleep(20)
    const ask = updates.find((u) => u.type === "permission_request") as Extract<SessionUpdate, { type: "permission_request" }>
    await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "no" })
    await turn
    expect(updates).toContainEqual({ type: "permission_resolved", requestId: ask.requestId, outcome: "reject_once" })
    expect(text()).toBe("you chose no")
    // Everything the agent said before it answered is in the saved message
    const saved = (await call("chats.get", { id: "c1" })).messages[1]
    expect(saved.parts.map((p: any) => p.type)).toEqual(["tool_call", "permission", "text"])
    expect(saved.parts[0].status).toBe("failed")
    // The agent's tool name and the inputs that name the step stay with it
    expect(saved.parts[0].tool).toEqual({ name: "Bash", command: "ls", description: "List the folder" })
  })

  it("shows a Write over a file as what it replaces, and a Write of a new file as new", async () => {
    const { send, updates, call } = await setup()
    const diffOf = async (text: string) => {
      updates.length = 0
      const turn = send(text)
      while (!updates.some((u) => u.type === "permission_request")) await sleep(20)
      const ask = updates.find((u) => u.type === "permission_request") as Extract<SessionUpdate, { type: "permission_request" }>
      const asked = updates.find((u) => u.type === "tool_call" && u.toolCallId === ask.toolCallId) as Extract<SessionUpdate, { type: "tool_call" }>
      await call("agents.respondPermission", { chatId: "c1", requestId: ask.requestId, optionId: "no" })
      await turn
      return asked.diff
    }
    expect(await diffOf("rewrite notes.md thirteen chars")).toEqual({ path: "notes.md", oldText: "twelve chars", newText: "thirteen chars" })
    expect(await diffOf("rewrite fresh.md new words")).toEqual({ path: "fresh.md", oldText: "", newText: "new words" })
  })

  it("shows the agent's questions and passes on the answer, or a skip", async () => {
    const { send, updates, call, text } = await setup()
    let turn = send("a question for you")
    while (!updates.some((u) => u.type === "question_request")) await sleep(20)
    const ask = updates.find((u) => u.type === "question_request") as Extract<SessionUpdate, { type: "question_request" }>
    expect(ask).toMatchObject({ toolCallId: "q1", questions: [{ id: "question_0", header: "Pick", question: "Which one?", options: [{ label: "A", description: "the first" }, { label: "B" }], allowsText: true }] })
    await call("agents.answerQuestion", { chatId: "c1", requestId: ask.requestId, answers: { question_0: { picks: ["B"], text: "but quickly" } } })
    await turn
    expect(text()).toBe(`answer {"action":"accept","content":{"question_0":"B","question_0_custom":"but quickly"}}`)
    expect(updates).toContainEqual({ type: "question_resolved", requestId: ask.requestId, outcome: "answered", answers: { question_0: { picks: ["B"], text: "but quickly" } } })

    updates.length = 0
    turn = send("another question")
    while (!updates.some((u) => u.type === "question_request")) await sleep(20)
    const again = updates.find((u) => u.type === "question_request") as Extract<SessionUpdate, { type: "question_request" }>
    await call("agents.answerQuestion", { chatId: "c1", requestId: again.requestId, answers: null })
    await turn
    expect(text()).toBe(`answer {"action":"decline"}`)
    const saved = (await call("chats.get", { id: "c1" })).messages[3]
    expect(saved.parts.find((p: any) => p.type === "question")).toMatchObject({ outcome: "skipped" })
  })

  it("closes a waiting question when the turn is stopped", async () => {
    const { send, updates, call } = await setup()
    const turn = send("question, then stop")
    while (!updates.some((u) => u.type === "question_request")) await sleep(20)
    await call("agents.cancel", { chatId: "c1" })
    expect(await turn).toEqual({ stopReason: "cancelled" })
    expect(updates.some((u) => u.type === "question_resolved" && u.outcome === "cancelled")).toBe(true)
  })

  it("keeps a refused request's error out of the answer, and doesn't call it a sign-in", async () => {
    const { send, call, agent } = await setup()
    await expect(send("refuse me please")).rejects.toThrow(/refused the request \(403\)/)
    const saved = (await call("chats.get", { id: "c1" })).messages[1]
    expect(saved).toMatchObject({ status: "error", errorDetail: "Failed to authenticate. API Error: 403 Request not allowed" })
    expect(saved.parts.filter((p: any) => p.type === "text")).toEqual([])
    const connectors = await call("agents.list")
    expect(connectors.find((c: any) => c.id === agent.id).authenticated).not.toBe(false)
  })

  it("cancels a turn quickly, closing it as cancelled", async () => {
    const { send, call } = await setup()
    const turn = send("slow please")
    await sleep(400)
    const t = Date.now()
    await call("agents.cancel", { chatId: "c1" })
    expect(await turn).toEqual({ stopReason: "cancelled" })
    expect(Date.now() - t).toBeLessThan(1000)
    expect((await call("chats.get", { id: "c1" })).messages[1].status).toBe("cancelled")
  })

  it("continues after the agent restarts, with the conversation as context", async () => {
    const { send, core, text, updates } = await setup()
    await send("remember 42")
    core.agents.dispose()
    updates.length = 0
    await send("what number")
    // The fake agent lost its sessions, so owlit started a new one and passed the conversation on
    expect(text()).toBe("echo: what number (small/ask/low) with history")
  })

  it("fails a turn whose agent crashes, and the next turn works", async () => {
    const { send, call } = await setup()
    const error = await send("crash now").catch((e) => e)
    // Said in owlit's words, not the library's "ACP connection closed"; how it ended is the detail
    expect(error.message).toBe("Fake quit unexpectedly. It starts again with the next message.")
    expect(error.data).toEqual({ detail: "Fake exited with code 3" })
    const reply = (await call("chats.get", { id: "c1" })).messages[1]
    expect(reply).toMatchObject({ status: "error", error: error.message, errorDetail: "Fake exited with code 3" })
    expect(reply.finishedAt).toBeGreaterThanOrEqual(reply.createdAt)
    expect(await send("again")).toEqual({ stopReason: "end_turn" })
  })

  it("says a turn cut off by owlit closing was closed, not that the agent broke", async () => {
    const { send, call, core, text } = await setup()
    const turn = send("slow please").catch((e) => e)
    // Wait for the agent to be talking, not for a set time: starting it can take longer under load
    while (!text()) await sleep(20)
    core.agents.dispose()
    const error = await turn
    expect(error.message).toBe("Owlit was closed before it could finish.")
    expect((await call("chats.get", { id: "c1" })).messages[1]).toMatchObject({ status: "error", error: error.message })
  })

  it("serves file reads inside the workspace and refuses the rest", async () => {
    const { send, text, updates } = await setup()
    await send("read notes.md")
    expect(text()).toBe("read 12 characters")
    updates.length = 0
    await send("read ../../../etc/passwd")
    expect(text()).toMatch(/could not read: .*outside the workspace/)
  })

  it("keeps what an agent overwrote when it writes the disk itself", async () => {
    const { send, root, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "agent.wrote" && wrote.push(n.params))
    await send("direct notes.md rewritten by the agent")
    for (let i = 0; i < 80 && !wrote.length; i++) await sleep(25)
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("rewritten by the agent")
    expect(wrote).toHaveLength(1)
    expect(wrote[0]).toMatchObject({ path: "notes.md", chatId: "c1" })
    expect(readFileSync(path.join(root, ".owlit/versions", wrote[0].versionId), "utf8")).toBe("twelve chars")
    await call("versions.restore", { id: wrote[0].versionId })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
  })

  it("saves each turn in its own answer and keeps its edits, while the session stays open", async () => {
    const { send, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "agent.wrote" && wrote.push(n.params))
    await send("direct notes.md first")
    for (let i = 0; i < 80 && wrote.length < 1; i++) await sleep(25)
    await send("direct notes.md second")
    for (let i = 0; i < 80 && wrote.length < 2; i++) await sleep(25)
    const [, first, , second] = (await call("chats.get", { id: "c1" })).messages
    expect(first.parts.filter((p: any) => p.type === "tool_call")).toHaveLength(1)
    expect(second.parts.filter((p: any) => p.type === "tool_call")).toHaveLength(1)
    expect(wrote).toHaveLength(2)
  })

  it("keeps a Co-author's change that no tool call names, and nobody else's", async () => {
    const { send, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "agent.wrote" && wrote.push(n.params))
    await send("silent notes.md by an assistant's shell", { role: "assistant" })
    await sleep(800)
    expect(wrote).toHaveLength(0)
    await send("silent notes.md by a co-author's shell", { role: "coauthor" })
    for (let i = 0; i < 80 && !wrote.length; i++) await sleep(25)
    expect(wrote).toMatchObject([{ path: "notes.md", chatId: "c1" }])
  })

  it("writes files for the agent and tells clients", async () => {
    const { send, root, core } = await setup()
    const heard: unknown[] = []
    core.onNotify((n) => n.method === "docs.changed" && heard.push(n.params))
    await send("write new.md hello")
    expect(readFileSync(path.join(root, "new.md"), "utf8")).toBe("hello")
    expect(heard).toHaveLength(1)
  })

  describe("a reply the agent takes up again after its turn", () => {
    async function watch(core: Core) {
      const late: any[] = []
      const ids: string[] = []
      core.onNotify((n: RpcNotification) => {
        if (n.method === "chat.lateReply") late.push((n.params as { message: unknown }).message)
        if (n.method === "chat.update") ids.push((n.params as { messageId: string }).messageId)
      })
      const until = async (ok: () => boolean) => {
        for (let i = 0; i < 200 && !ok(); i++) await sleep(25)
      }
      return { late, ids, until }
    }

    it("gets what the agent says after end_turn, is saved, and ends again", async () => {
      const { send, core, call, root } = await setup()
      const { late, ids, until } = await watch(core)
      expect(await send("answer after the turn")).toEqual({ stopReason: "end_turn" })
      await until(() => late.length >= 2)
      expect(late.map((m) => [m.id, m.status])).toEqual([["a1", "streaming"], ["a1", "done"]])
      const expected = [
        { type: "agent", agentId: "agent-l", title: "Count the words", status: "done" },
        { type: "text", text: "I'm waiting on the agent.", messageId: "m1" },
        { type: "text", text: "The file has two words.", messageId: "m2" },
      ]
      expect(late[1].parts).toMatchObject(expected)
      expect(late[1].finishedAt).toBeGreaterThan(0)
      expect(new Set(ids)).toEqual(new Set(["a1"]))
      const saved = JSON.parse(readFileSync(path.join(root, ".owlit/chats/c1.json"), "utf8")).messages
      expect(saved.map((m: any) => [m.id, m.status ?? null])).toEqual([["u1", null], ["a1", "done"]])
      expect(saved[1].parts).toMatchObject(expected)
      // The chat goes on as usual
      expect(await send("hello")).toEqual({ stopReason: "end_turn" })
      expect((await call("chats.get", { id: "c1" })).messages.map((m: any) => [m.id, m.status ?? null])).toEqual([
        ["u1", null],
        ["a1", "done"],
        ["u2", null],
        ["a2", "done"],
      ])
    })

    it("is stopped by Stop, which cancels the agent's work", async () => {
      const { send, core, call } = await setup()
      const { late, ids, until } = await watch(core)
      await send("answer after the turn, slowly")
      await until(() => late.length >= 1)
      await sleep(250)
      expect(await call("agents.cancel", { chatId: "c1" })).toBeNull()
      expect(late.map((m) => m.status)).toEqual(["streaming", "cancelled"])
      const heard = ids.length
      await sleep(400)
      // The agent stopped, and nothing more reaches the reply
      expect(ids.length).toBe(heard)
      const reply = (await call("chats.get", { id: "c1" })).messages[1]
      expect(reply.status).toBe("cancelled")
      expect(reply.parts.at(-1).text).toMatch(/^The file has 0 /)
    })

    it("gives way to the user's next message, whose turn gets what the agent still says", async () => {
      const { send, core, call } = await setup()
      const { late, until } = await watch(core)
      await send("answer after the turn, slowly")
      await until(() => late.length >= 1)
      expect(await send("hello")).toEqual({ stopReason: "end_turn" })
      expect(late[1]).toMatchObject({ id: "a1", status: "done" })
      const messages = (await call("chats.get", { id: "c1" })).messages
      expect(messages.map((m: any) => [m.id, m.status ?? null])).toEqual([
        ["u1", null],
        ["a1", "done"],
        ["u2", null],
        ["a2", "done"],
      ])
      expect(messages[3].parts.map((p: any) => p.text).join("")).toContain("echo: hello")
      await call("agents.cancel", { chatId: "c1" })
    })

    it("knows Claude Code's turn is over at the usage update that carries its cost", () => {
      const usage = { sessionUpdate: "usage_update", used: 1, size: 2 } as const
      expect(ownTurnOver("claude-code", { ...usage, cost: { amount: 0.1, currency: "USD" } })).toBe(true)
      expect(ownTurnOver("claude-code", usage)).toBe(false)
      expect(ownTurnOver("codex", { ...usage, cost: { amount: 0.1, currency: "USD" } })).toBe(false)
    })
  })
})
