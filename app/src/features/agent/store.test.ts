import type { Chat, QuotedSelection } from "@owlit/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rpc", () => ({ hasCore: false, rpc: {}, onNotify: () => () => {}, bridge: undefined }))
vi.mock("@/features/chat/agent", () => ({ agentClient: { check: async (c: unknown) => c, onUpdate: () => () => {}, onEnded: () => () => {} } }))
vi.mock("@/app/seen", () => ({ markSeen: () => {}, useSeen: { getState: () => ({ unseen: { chats: [] } }) } }))

const { useChatStore } = await import("@/features/chat/store")
const { useAgentWindow } = await import("./store.ts")

const paperA = { id: "a", kind: "paper" as const, uri: "owlit://library/a", title: "Paper A" }
const paperB = { id: "b", kind: "paper" as const, uri: "owlit://library/b", title: "Paper B" }
const passage = (source: typeof paperA): QuotedSelection => ({ text: "a passage", source })
const chatAbout = (id: string, source: typeof paperA): Chat => ({
  id,
  title: "t",
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  connectorId: "claude-code",
  messages: [{ id: `${id}-q`, role: "user", createdAt: 1, parts: [{ type: "text", text: "hi" }], selection: passage(source) }],
})

beforeEach(() => {
  useChatStore.setState({ chats: { c1: chatAbout("c1", paperA) }, streaming: {}, queued: {} })
  useAgentWindow.setState({ stage: "open", chatId: "c1", selection: null })
})

describe("Ask Owlit on a selection", () => {
  it("asks in the docked chat when the passage is from what it is about", () => {
    useAgentWindow.getState().open(passage(paperA))
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: "c1", selection: passage(paperA) })
  })

  it("starts an empty chat in the panel when the docked chat is about something else", () => {
    useAgentWindow.getState().open(passage(paperB))
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null, selection: passage(paperB) })
  })

  it("keeps the passage when the person starts a new chat themselves", () => {
    useAgentWindow.getState().open(passage(paperA))
    useAgentWindow.getState().newChat()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null, selection: passage(paperA) })
  })
})
