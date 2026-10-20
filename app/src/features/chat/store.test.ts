import type { Chat, ChatMessage, SessionUpdate } from "@owlit/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The agent client as the store sees it: each prompt waits until the test ends it, and the test speaks
// for the client's onUpdate and onEnded
const client = vi.hoisted(() => {
  const updated = new Set<(chatId: string, messageId: string, update: SessionUpdate) => void>()
  const ended = new Set<(chatId: string, messageId: string, message: ChatMessage) => void>()
  const prompts: { chatId: string; text: string; messageId: string; resolve: (stop: "end_turn" | "cancelled") => void }[] = []
  const calls = { cancel: [] as string[], respond: [] as [string, string][] }
  return {
    prompts,
    calls,
    update: (chatId: string, messageId: string, update: SessionUpdate) => updated.forEach((l) => l(chatId, messageId, update)),
    end: (chatId: string, messageId: string, message: ChatMessage) => ended.forEach((l) => l(chatId, messageId, message)),
    agentClient: {
      check: async (c: unknown) => c,
      prompt: (req: { chatId: string; input: { text: string }; assistantMessageId: string }) =>
        new Promise((resolve) => prompts.push({ chatId: req.chatId, text: req.input.text, messageId: req.assistantMessageId, resolve })),
      cancel: (chatId: string) => calls.cancel.push(chatId),
      running: async () => [],
      onUpdate: (l: never) => (updated.add(l), () => updated.delete(l)),
      onEnded: (l: never) => (ended.add(l), () => ended.delete(l)),
      respondPermission: (_chatId: string, requestId: string, optionId: string) => calls.respond.push([requestId, optionId]),
      answerQuestion: () => {},
    },
  }
})
vi.mock("@/lib/rpc", () => ({ hasCore: false, rpc: {}, onNotify: () => () => {}, bridge: undefined }))
vi.mock("./agent", () => ({ agentClient: client.agentClient }))
vi.mock("@/app/seen", () => ({ markSeen: () => {} }))
const asked = vi.hoisted(() => ({ typed: [] as string[] }))
vi.mock("./ask-draft", () => ({ useAskDraft: { getState: () => ({ type: (_chatId: string, _ask: unknown, text: string) => asked.typed.push(text) }) } }))

const { adoptRunning, followUpdate, turnEnded, useChatStore, withHeld } = await import("./store.ts")
const { chatStatus } = await import("./status.ts")

const reply = (id: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", createdAt: 2, parts: [], status: "streaming", ...patch })
const question = (id: string, text = "hi"): ChatMessage => ({ id, role: "user", createdAt: 1, parts: [{ type: "text", text }] })
const chat = (id: string, messages: ChatMessage[]): Chat => ({ id, title: "t", createdAt: 1, updatedAt: 1, pinned: false, connectorId: "claude-code", messages })
const text = (m: ChatMessage | undefined) => m?.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
const messageOf = (chatId: string, id: string) => useChatStore.getState().chats[chatId]?.messages.find((m) => m.id === id)

beforeEach(() => {
  client.prompts.length = 0
  client.calls.cancel.length = 0
  client.calls.respond.length = 0
  asked.typed.length = 0
  useChatStore.setState({ chats: {}, streaming: {}, queued: {} })
})

const input = (text: string, extra: object = {}) => ({ text, mentions: [], attachments: [], ...extra })

// A chat whose turn runs, its reply waiting on what `parts` ask
async function running(parts: ChatMessage["parts"] = []) {
  useChatStore.setState({ chats: { c1: chat("c1", []) } })
  void useChatStore.getState().send("c1", input("one"))
  await vi.waitFor(() => expect(client.prompts).toHaveLength(1))
  const turn = client.prompts[0]!
  for (const p of parts) {
    if (p.type === "permission") client.update("c1", turn.messageId, { type: "permission_request", requestId: p.requestId, toolCallId: p.toolCallId, title: p.title, kind: p.kind, options: p.options })
    if (p.type === "question") client.update("c1", turn.messageId, { type: "question_request", requestId: p.requestId, questions: p.questions })
  }
  return turn
}

describe("the chat store mirrors the client's turns", () => {
  it("takes up a turn that was running when the window opened, follows it and ends it", () => {
    useChatStore.setState({ chats: { c1: chat("c1", [question("u1"), reply("a1", { parts: [{ type: "text", text: "He" }] })]) } })
    adoptRunning([{ chatId: "c1", messageId: "a1", message: reply("a1", { parts: [{ type: "text", text: "Hello" }] }) }])
    expect(useChatStore.getState().streaming).toEqual({ c1: "a1" })
    expect(chatStatus(useChatStore.getState().chats.c1!, true, false)).toBe("working")
    client.update("c1", "a1", { type: "agent_message_chunk", text: " world" })
    expect(text(messageOf("c1", "a1"))).toBe("Hello world")
    client.end("c1", "a1", reply("a1", { status: "done", parts: [{ type: "text", text: "Hello world." }] }))
    expect(useChatStore.getState().streaming).toEqual({})
    expect(messageOf("c1", "a1")).toMatchObject({ status: "done", parts: [{ type: "text", text: "Hello world." }] })
  })

  it("holds a running reply whose chat's messages aren't read yet, and puts it in when they are", () => {
    useChatStore.setState({ chats: { c1: chat("c1", []) } })
    adoptRunning([{ chatId: "c1", messageId: "a1", message: reply("a1", { parts: [{ type: "text", text: "Hello" }] }) }])
    followUpdate("c1", "a1", { type: "agent_message_chunk", text: " again" })
    // What was read from disk is older than the turn
    const read = withHeld("c1", [question("u1"), reply("a1")])
    expect(text(read[1])).toBe("Hello again")
    // Held once only
    expect(withHeld("c1", [question("u1"), reply("a1")])[1]?.parts).toEqual([])
  })

  it("leaves a turn the chat started later alone when an older one's end comes late", async () => {
    useChatStore.setState({ chats: { c1: chat("c1", []) } })
    void useChatStore.getState().send("c1", { text: "one", mentions: [], attachments: [] })
    await vi.waitFor(() => expect(client.prompts).toHaveLength(1))
    const first = client.prompts[0]!
    turnEnded("c1", "old-reply", reply("old-reply", { status: "done" }))
    expect(useChatStore.getState().streaming).toEqual({ c1: first.messageId })
  })

  it("ends a turn by what its call said when nothing else did", async () => {
    useChatStore.setState({ chats: { c1: chat("c1", []) } })
    const sent = useChatStore.getState().send("c1", { text: "one", mentions: [], attachments: [] })
    await vi.waitFor(() => expect(client.prompts).toHaveLength(1))
    client.prompts[0]!.resolve("cancelled")
    await sent
    expect(useChatStore.getState().streaming).toEqual({})
    expect(messageOf("c1", client.prompts[0]!.messageId)?.status).toBe("cancelled")
  })

  it("queues what is sent while Owlit works, joins a second message to it, and sends it when the turn ends", async () => {
    const turn = await running()
    await useChatStore.getState().send("c1", input("two"))
    await useChatStore.getState().send("c1", input("three"))
    expect(client.prompts).toHaveLength(1)
    expect(useChatStore.getState().queued.c1?.text).toBe("two\n\nthree")
    client.end("c1", turn.messageId, reply(turn.messageId, { status: "done" }))
    await vi.waitFor(() => expect(client.prompts).toHaveLength(2))
    expect(client.prompts[1]!.text).toBe("two\n\nthree")
    expect(useChatStore.getState().queued).toEqual({})
  })

  it("answers a waiting command with Don't allow and keeps the turn, the words going next", async () => {
    const options = [
      { optionId: "yes", name: "Allow", kind: "allow_once" as const },
      { optionId: "no", name: "Reject", kind: "reject_once" as const },
    ]
    const turn = await running([{ type: "permission", requestId: "r1", toolCallId: "t1", title: "Run pdftotext", kind: "execute", options }])
    await useChatStore.getState().send("c1", input("use library_read instead"))
    expect(client.calls.respond).toEqual([["r1", "no"]])
    expect(client.calls.cancel).toEqual([])
    expect(useChatStore.getState().streaming.c1).toBe(turn.messageId)
    expect(useChatStore.getState().queued.c1?.text).toBe("use library_read instead")
  })

  it("answers a waiting question with the words, and sends the files and mentions with the next message", async () => {
    await running([{ type: "question", requestId: "q1", questions: [{ id: "q", question: "Which?", options: [], allowsText: true }] }])
    const mention = { id: "d1", kind: "doc" as const, uri: "owlit://docs/rw.md", title: "rw.md" }
    const file = { id: "f1", name: "notes.pdf", size: 1, mimeType: "application/pdf" }
    await useChatStore.getState().send("c1", input("the second, see @[rw.md]", { mentions: [mention], attachments: [file] }))
    expect(asked.typed).toEqual(["the second, see rw.md"])
    expect(useChatStore.getState().queued.c1).toMatchObject({ text: "@[rw.md]", mentions: [mention], attachments: [file] })
  })

  it("stops through the client", () => {
    useChatStore.getState().cancel("c1")
    expect(client.calls.cancel).toEqual(["c1"])
  })
})
