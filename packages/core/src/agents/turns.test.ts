import type { RpcNotification, SessionUpdate } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import type { Caller } from "../rpc/index.ts"
import { until, testSearchPath } from "../test-util.ts"
import { cannotRead, sendsPictures } from "./profiles.ts"
import { RULES_VERSION } from "./rules.ts"
import { attachmentBlocks, promptBlocks, SILENT_MS } from "./turns.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-turns-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  writeFileSync(path.join(root, "notes.md"), "twelve chars")
  const core = new Core({ userDataDir: path.join(base, "userData"), searchPath: testSearchPath })
  cores.push(core)
  const updates: SessionUpdate[] = []
  core.onNotify((n: RpcNotification) => {
    if (n.method === "chat.update") updates.push((n.params as { update: SessionUpdate }).update)
  })
  const call = async (method: string, params?: unknown, caller?: Caller): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params }, caller)
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
  it("writes into the answer what it was built from: the papers the chat's agent read, and those it cites", async () => {
    const { send, call, root } = await setup()
    for (const id of ["doi-10.1-read", "doi-10.1-c"]) await call("library.add", { paper: { id, title: `Paper ${id}`, authors: ["A. Author"], ids: { doi: `10.1/${id.slice(9)}` } } })
    writeFileSync(path.join(root, "library/papers/doi-10.1-read/text.md"), "<!-- page 1 -->\n\nThe paper's text.\n")
    // As owlit-mcp reads for this chat's agent, and for another chat's
    await call("library.read", { id: "doi-10.1-read", part: "text", asker: "chat:c1" })
    await call("library.read", { id: "doi-10.1-read", part: "text", asker: "chat:c9" })
    // The fake agent says back the first words of the prompt: a citation, short enough
    await send("[A](owlit://library/doi-10.1-c)")
    const chat = await call("chats.get", { id: "c1" })
    expect(chat.messages[1].readFrom).toEqual([
      { paperId: "doi-10.1-read", depth: "full" },
      { paperId: "doi-10.1-c", depth: "none" },
    ])
  })

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
    expect(await call("agents.rules")).toMatch(new RegExp(`^owlit agent rules, version ${RULES_VERSION}\n`))
  })

  it("tells a session owlit's memory when it is new to it, and again only when it changed", async () => {
    const { send, updates, call } = await setup()
    const said = () => updates.filter((u) => u.type === "agent_message_chunk").map((u) => (u as { text: string }).text)
    // Nothing kept yet: nothing said
    await send("memory?")
    await call("memory.write", { op: "add", kind: "work", text: "Cite as (Author, Year).", chatId: "c1" })
    await send("memory?")
    await send("memory?")
    await call("memory.put", { id: "m1", kind: "work", text: "Cite in APA 7." })
    await send("memory?")
    const [none, first, again, changed] = said()
    expect(none).toBe("no memory")
    expect(first).toMatch(/changed; this is the whole list now\.\nHow they want you to work:\n- \[m1\] Cite as \(Author, Year\)\.\nAbout their work:\n\(nothing yet\)/)
    expect(again).toBe("no memory")
    expect(changed).toContain("- [m1] Cite in APA 7.")
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

  it("gives the agent the comment Ask Owlit was pressed on, beside the passage it is on", () => {
    const source = { kind: "doc" as const, id: "d1", uri: "owlit://docs/Draft.md", title: "Draft" }
    const comment = { entries: [{ who: "Owlit", text: "This overstates it." }, { who: "You", text: "How so?" }] }
    const text = promptBlocks({ text: "Draft the change", mentions: [], attachments: [], selection: { text: "a claim", source, comment } }, "/ws", null)
      .map((b) => (b as { text?: string }).text ?? "")
      .find((t) => t.startsWith("The user is asking about a comment"))
    expect(text).toBe("The user is asking about a comment on this passage in Draft:\n> a claim\n\nThe comment, beside the doc (not in its text):\nOwlit: This overstates it.\nYou: How so?")
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

  it("refuses a Reviewer's agent a delete, a move or a paper, before the handler runs", async () => {
    const { call, root } = await setup()
    const mcp: Caller = { kind: "socket", chatId: "c1" }
    await call("chats.update", { id: "c1", patch: { role: "reviewer" } })
    await expect(call("agents.deleteDocs", { paths: ["notes.md"] }, mcp)).rejects.toThrow(/Not done: Owlit works as Reviewer/)
    await expect(call("agents.moveDoc", { path: "notes.md", to: "kept.md" }, mcp)).rejects.toThrow(/Not done: Owlit works as Reviewer/)
    await call("library.add", { paper: { id: "doi-10.1-x", title: "x", authors: [], ids: { doi: "10.1/x" } } })
    await expect(call("library.update", { id: "doi-10.1-x", patch: { starred: true } }, mcp)).rejects.toThrow(/Not done: Owlit works as Reviewer/)
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    expect((await call("library.list")).papers[0].starred).toBe(false)
  })

  it("lands an Assistant's delete at once, with Undo, in a turn or between turns", async () => {
    const { send, updates, call, root } = await setup()
    const mcp: Caller = { kind: "socket", chatId: "c1" }
    await call("chats.update", { id: "c1", patch: { role: "assistant" } })
    expect(await call("agents.deleteDocs", { paths: ["notes.md"] }, mcp)).toEqual({ deleted: ["notes.md"] })
    expect(existsSync(path.join(root, "notes.md"))).toBe(false)
    const deleted = (await call("changes.list", { chatId: "c1" }))[0]
    expect(deleted).toMatchObject({ actor: expect.stringMatching(/^o_/), action: "delete", target: { kind: "doc", path: "notes.md" } })
    await call("changes.undo", { id: deleted.id })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    // During a turn too, with no card
    const turn = send("slow please", { role: "assistant" })
    await until(() => updates.some((u) => u.type === "agent_message_chunk"), { what: "a agent_message_chunk" })
    expect(await call("agents.moveDoc", { path: "notes.md", to: "kept.md" }, mcp)).toEqual({ path: "kept.md" })
    expect(updates.some((u) => u.type === "permission_request")).toBe(false)
    await call("agents.cancel", { chatId: "c1" })
    await turn
  })

  it("keeps an agent's own agents apart: their steps, their questions and their reports", async () => {
    const { send, updates, call, text } = await setup()
    const turn = send("use agents", { role: "coauthor" })
    await until(() => updates.some((u) => u.type === "permission_request"), { what: "a permission_request" })
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
      ["b1", "agent-b", "completed"],
    ])
    expect(saved.parts.find((p: any) => p.type === "permission")).toMatchObject({ agentId: "agent-b", outcome: "allow_once" })
  })

  it("asks permission and passes on the answer; Reject reaches the agent", async () => {
    const { send, updates, call, text } = await setup()
    // A Co-author may run commands, each still the user's to allow when the agent asks
    const turn = send("needs permission", { role: "coauthor" })
    await until(() => updates.some((u) => u.type === "permission_request"), { what: "a permission_request" })
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
    const { send, updates } = await setup()
    const diffOf = async (text: string) => {
      updates.length = 0
      await send(text, { role: "assistant" })
      const asked = updates.find((u) => u.type === "tool_call" && u.toolCallId === "w1") as Extract<SessionUpdate, { type: "tool_call" }>
      return asked.diff
    }
    expect(await diffOf("rewrite notes.md thirteen chars")).toEqual({ path: "notes.md", oldText: "twelve chars", newText: "thirteen chars" })
    expect(await diffOf("rewrite fresh.md new words")).toEqual({ path: "fresh.md", oldText: "", newText: "new words" })
  })

  it("shows a Write made without asking as what it replaces, in every update of its call", async () => {
    const { send, call } = await setup()
    await call("docs.list")
    await send("overwrite notes.md thirteen chars", { role: "coauthor" })
    const step = (await call("chats.get", { id: "c1" })).messages[1].parts.find((p: any) => p.type === "tool_call")
    expect(step).toMatchObject({ status: "completed", diff: { path: "notes.md", oldText: "twelve chars", newText: "thirteen chars" } })
  })

  it("shows the agent's questions and passes on the answer, or a skip", async () => {
    const { send, updates, call, text } = await setup()
    let turn = send("a question for you")
    await until(() => updates.some((u) => u.type === "question_request"), { what: "a question_request" })
    const ask = updates.find((u) => u.type === "question_request") as Extract<SessionUpdate, { type: "question_request" }>
    expect(ask).toMatchObject({ toolCallId: "q1", questions: [{ id: "question_0", header: "Pick", question: "Which one?", options: [{ label: "A", description: "the first" }, { label: "B" }], allowsText: true }] })
    await call("agents.answerQuestion", { chatId: "c1", requestId: ask.requestId, answers: { question_0: { picks: ["B"], text: "but quickly" } } })
    await turn
    expect(text()).toBe(`answer {"action":"accept","content":{"question_0":"B","question_0_custom":"but quickly"}}`)
    expect(updates).toContainEqual({ type: "question_resolved", requestId: ask.requestId, outcome: "answered", answers: { question_0: { picks: ["B"], text: "but quickly" } } })

    updates.length = 0
    turn = send("another question")
    await until(() => updates.some((u) => u.type === "question_request"), { what: "a question_request" })
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
    await until(() => updates.some((u) => u.type === "question_request"), { what: "a question_request" })
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

  it("lists the turns running, for a window that opens meanwhile, and says when one ends", async () => {
    const { send, call, core, text } = await setup()
    const ended: any[] = []
    core.onNotify((n) => n.method === "chat.ended" && ended.push(n.params))
    expect(await call("agents.running")).toEqual([])
    const turn = send("slow please")
    await until(() => text(), { what: "the agent to start talking" })
    const [running] = await call("agents.running")
    expect(running).toMatchObject({ chatId: "c1", messageId: "a1", message: { id: "a1", status: "streaming", parts: [{ type: "text" }] } })
    await call("agents.cancel", { chatId: "c1" })
    await turn
    expect(await call("agents.running")).toEqual([])
    expect(ended).toMatchObject([{ chatId: "c1", messageId: "a1", message: { id: "a1", status: "cancelled" } }])
  })

  it("cancels a turn, closing it as cancelled", async () => {
    const { send, call, text } = await setup()
    const turn = send("slow please")
    await until(() => text(), { what: "the agent to start talking" })
    await call("agents.cancel", { chatId: "c1" })
    // The slow turn streams for seconds and then ends as end_turn: only a cancel that landed ends it cancelled
    expect(await turn).toEqual({ stopReason: "cancelled" })
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

  it("says a turn cut off by owlit closing was closed, not that the agent broke or the person stopped it", async () => {
    const { send, core, text, root } = await setup()
    const turn = send("slow please").catch((e) => e)
    // Wait for the agent to be talking, not for a set time: starting it can take longer under load
    await until(() => text(), { what: "the agent to start talking" })
    // As quitting does: the workspace's turns are reset, then the agents close
    await core.dispose()
    const error = await turn
    expect(error.message).toBe("Owlit was closed before it finished.")
    // The reply says so when the chat is read again, whether it was saved before the workspace let go or
    // is found still streaming
    const next = new Core({ userDataDir: path.join(path.dirname(root), "userData"), searchPath: testSearchPath })
    cores.push(next)
    await next.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    const chat = await next.handle({ jsonrpc: "2.0", id: 2, method: "chats.get", params: { id: "c1" } })
    expect((chat as { result: { messages: unknown[] } }).result.messages[1]).toMatchObject({ status: "error", error: "Owlit was closed before it finished.", cutOff: "closed" })
  })

  it("says a turn cut off by opening another workspace was cut off by that", async () => {
    const { send, call, text, root } = await setup()
    const turn = send("slow please").catch((e) => e)
    await until(() => text(), { what: "the agent to start talking" })
    const other = path.join(path.dirname(root), "other")
    mkdirSync(other)
    await call("workspace.open", { path: other })
    expect((await turn).message).toBe("Owlit was closed before it finished, when you opened another workspace.")
  })

  it("stops a turn whose agent never finishes starting", async () => {
    const { send, call } = await setup()
    process.env.FAKE_ACP_HANG = "session"
    try {
      const turn = send("hello")
      // The turn is there to stop as soon as it is asked for
      await until(async () => (await call("agents.running")).length, { what: "the turn to start" })
      await call("agents.cancel", { chatId: "c1" })
      expect(await turn).toEqual({ stopReason: "cancelled" })
      expect((await call("chats.get", { id: "c1" })).messages[1]).toMatchObject({ status: "cancelled" })
      expect(await call("agents.running")).toEqual([])
    } finally {
      delete process.env.FAKE_ACP_HANG
    }
  })

  it("says when the agent has sent nothing for a while, and leaves it out of the reply once it ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const { send, call, text, updates } = await setup()
      const notices = () => updates.filter((u) => u.type === "notice")
      const turn = send("quiet please")
      await until(() => text(), { what: "the agent's first word" })
      await vi.advanceTimersByTimeAsync(SILENT_MS - 1000)
      expect(notices()).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(notices()).toEqual([{ type: "notice", notice: "silent", since: expect.any(Number) }])
      expect((await call("agents.running"))[0].message.parts.at(-1)).toMatchObject({ type: "notice" })
      await call("agents.cancel", { chatId: "c1" })
      await turn
      // Not kept in the reply once it ended
      expect((await call("chats.get", { id: "c1" })).messages[1].parts).toEqual([{ type: "text", text: "Hm." }])
    } finally {
      vi.useRealTimers()
    }
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
    core.onNotify((n) => n.method === "changes.added" && wrote.push((n.params as any).change))
    await send("direct notes.md rewritten by the agent")
    await until(() => wrote.length, { what: "the change" })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("rewritten by the agent")
    expect(wrote).toHaveLength(1)
    expect(wrote[0]).toMatchObject({ actor: expect.stringMatching(/^o_/), target: { path: "notes.md" }, origin: { via: "watcher", chatId: "c1", replyId: "a1", toolCallId: "e1" } })
    expect(readFileSync(path.join(root, ".owlit/versions", wrote[0].id), "utf8")).toBe("twelve chars")
    await call("changes.undo", { id: wrote[0].id })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
  })

  it("saves each turn in its own answer and keeps its edits, while the session stays open", async () => {
    const { send, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "changes.added" && wrote.push((n.params as any).change))
    await send("direct notes.md first")
    await until(() => wrote.length >= 1, { what: "the first change" })
    await send("direct notes.md second")
    await until(() => wrote.length >= 2, { what: "the second change" })
    const [, first, , second] = (await call("chats.get", { id: "c1" })).messages
    expect(first.parts.filter((p: any) => p.type === "tool_call")).toHaveLength(1)
    expect(second.parts.filter((p: any) => p.type === "tool_call")).toHaveLength(1)
    expect(wrote).toHaveLength(2)
    // Each change names the reply whose turn made it, for that reply's result card
    expect(wrote.map((c) => c.origin.replyId)).toEqual([first.id, second.id])
  })

  it("records a change no tool call names as outside owlit, with the Co-author turn it came during as the only hint", async () => {
    const { send, core, call } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "changes.added" && wrote.push((n.params as any).change))
    await send("silent notes.md by an assistant's shell", { role: "assistant" })
    await until(() => wrote.length, { what: "the assistant's change" })
    await send("silent notes.md by a co-author's shell", { role: "coauthor" })
    await until(() => wrote.length >= 2, { what: "the co-author's change" })
    expect(wrote[0]).toMatchObject({ actor: "other", target: { path: "notes.md" }, origin: { via: "watcher" } })
    expect(wrote[0].origin.chatId).toBeUndefined()
    // Never Owlit's: nothing says it wrote that, only that it was at work then
    expect(wrote[1]).toMatchObject({ actor: "other", origin: { via: "watcher", chatId: "c1" } })
    expect(wrote[1].origin.toolCallId).toBeUndefined()
  })

  it("lands a Co-author's edit at once, signed as Owlit's with its tool call", async () => {
    const { send, core, call, updates, root } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "changes.added" && wrote.push((n.params as any).change))
    await send("rewrite notes.md thirteen chars", { role: "coauthor" })
    expect(updates.some((u) => u.type === "permission_request")).toBe(false)
    await until(() => wrote.length, { what: "the landed change" })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("thirteen chars")
    expect(wrote).toMatchObject([{ actor: expect.stringMatching(/^o_/), target: { path: "notes.md" }, origin: { via: "apply", chatId: "c1", toolCallId: "w1" } }])
  })

  it("lands an Assistant's edit as a proposal: allowed before any card, signed Owlit's with its tool call, its passages for the doc to mark", async () => {
    const { send, core, call, updates, root, text } = await setup()
    await call("docs.list")
    const wrote: any[] = []
    core.onNotify((n) => n.method === "changes.added" && wrote.push((n.params as any).change))
    await send("rewrite notes.md thirteen chars", { role: "assistant" })
    expect(text()).toBe("you chose yes")
    expect(updates.some((u) => u.type === "permission_request")).toBe(false)
    // The step is in the chat with what it changed
    expect(updates.find((u) => u.type === "tool_call" && u.toolCallId === "w1")).toMatchObject({ kind: "edit", diff: { path: "notes.md", oldText: "twelve chars", newText: "thirteen chars" } })
    await until(() => wrote.length, { what: "the landed change" })
    expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("thirteen chars")
    expect(wrote).toMatchObject([{ actor: expect.stringMatching(/^o_/), target: { path: "notes.md" }, origin: { via: "apply", chatId: "c1", toolCallId: "w1" } }])
    const proposals = await call("changes.proposals", { path: "notes.md", text: "thirteen chars", since: 0 })
    expect(proposals).toMatchObject([{ id: wrote[0].id, hunks: [{ insert: "thirteen", removed: "twelve", before: "", after: " chars" }] }])
  })

  it("refuses an edit outside the user's docs before any card, whatever the role", async () => {
    const { send, updates, text, root } = await setup()
    for (const file of ["../x.md", ".owlit/x.json", ".git/x.md"]) {
      updates.length = 0
      await send(`rewrite ${file} words`, { role: "coauthor" })
      expect(text(), file).toBe("you chose no")
      expect(updates.some((u) => u.type === "permission_request")).toBe(false)
      expect(existsSync(path.join(root, file))).toBe(false)
    }
  })

  describe("a doc the user keeps Owlit out of", () => {
    const KEPT_OUT = "The user keeps Owlit out of this doc: read it if you need to, but don't change it or comment on it."
    const kept = async () => {
      const turns = await setup()
      await turns.call("docs.setOwlitOut", { path: "notes.md", out: true })
      return turns
    }

    it("refuses an engine's edit before any card", async () => {
      const { send, updates, text, root } = await kept()
      await send("rewrite notes.md thirteen chars", { role: "coauthor" })
      expect(text()).toBe("you chose no")
      expect(updates.some((u) => u.type === "permission_request")).toBe(false)
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    })

    it("refuses an agent's write, delete and move", async () => {
      const { send, call, root } = await kept()
      await expect(send("write notes.md other words", { role: "coauthor" })).rejects.toThrow(KEPT_OUT)
      const mcp: Caller = { kind: "socket", chatId: "c1" }
      await call("chats.update", { id: "c1", patch: { role: "coauthor" } })
      await expect(call("agents.deleteDocs", { paths: ["notes.md"] }, mcp)).rejects.toThrow(`Not done: ${KEPT_OUT}`)
      await expect(call("agents.moveDoc", { path: "notes.md", to: "kept.md" }, mcp)).rejects.toThrow(`Not done: ${KEPT_OUT}`)
      expect(readFileSync(path.join(root, "notes.md"), "utf8")).toBe("twelve chars")
    })

    it("refuses Owlit's comments there, and leaves the person's own", async () => {
      const { call } = await kept()
      const comment = (id: string) => ({ id, quote: "twelve", prefix: "", suffix: "", entries: [{ id: `${id}-e`, text: "A word.", at: 1 }], createdAt: 1 })
      await expect(call("comments.add", { path: "notes.md", comment: comment("o1") }, { kind: "socket", chatId: "c1" })).rejects.toThrow(`Not done: ${KEPT_OUT}`)
      await call("comments.add", { path: "notes.md", comment: comment("p1") })
      expect((await call("comments.all"))["notes.md"].map((c: { id: string }) => c.id)).toEqual(["p1"])
    })
  })

  it("writes files for the agent and tells clients", async () => {
    const { send, root, core } = await setup()
    const heard: unknown[] = []
    core.onNotify((n) => n.method === "docs.changed" && heard.push(n.params))
    await send("write new.md hello")
    expect(readFileSync(path.join(root, "new.md"), "utf8")).toBe("hello")
    expect(heard).toHaveLength(1)
  })
})
