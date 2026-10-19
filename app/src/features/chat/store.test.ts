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
vi.mock("@/lib/rpc", () => ({ isDesktop: false, rpc: {}, onNotify: () => () => {}, bridge: undefined }))
vi.mock("./agent", () => ({ agentClient: client.agentClient }))
vi.mock("./mocks/chats", () => ({ seedChats: [] }))
vi.mock("@/app/seen", () => ({ markSeen: () => {} }))

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
  useChatStore.setState({ chats: {}, streaming: {} })
})

describe("the chat store mirrors the client's turns", () => {
  it("takes up a turn that was running when the window opened, follows it and ends it", () => {
    useChatStore.setState({ chats: { c1: chat("c1", [question("u1"), reply("a1", { parts: [{ type: "text", text: "He" }] })]) } })
    adoptRunning([{ chatId: "c1", messageId: "a1", message: reply("a1", { parts: [{ type: "text", text: "Hello" }] }) }])
    expect(useChatStore.getState().streaming).toEqual({ c1: "a1" })
    expect(chatStatus(useChatStore.getState().chats.c1!, true, false, undefined)).toBe("working")
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

  it("stops through the client", () => {
    useChatStore.getState().cancel("c1")
    expect(client.calls.cancel).toEqual(["c1"])
  })
})
