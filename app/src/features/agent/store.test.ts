import type { Chat, QuotedSelection } from "@owlit/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rpc", () => ({ rpc: {}, onNotify: () => () => {}, bridge: undefined }))
vi.mock("@/features/chat/agent", () => ({ agentClient: { check: async (c: unknown) => c, onUpdate: () => () => {}, onEnded: () => () => {} } }))
vi.mock("@/app/seen", () => ({ markSeen: () => {}, useSeen: { getState: () => ({ unseen: { chats: [] } }) } }))
// The page the window is over, set per test
const page = { uri: null as string | null }
vi.mock("./page-uri", () => ({ currentPageUri: () => page.uri }))

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
  page.uri = null
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

  it("goes on in the latest chat about what the passage is from, in the panel", () => {
    useChatStore.setState({ chats: { c1: chatAbout("c1", paperA), c2: { ...chatAbout("c2", paperB), updatedAt: 2 }, c3: { ...chatAbout("c3", paperB), updatedAt: 3 } } })
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().open(passage(paperB))
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: "c3", selection: passage(paperB) })
  })

  it("asks in the empty chat the person just opened, whatever the passage is from", () => {
    useChatStore.setState({ chats: { c1: chatAbout("c1", paperA), c2: chatAbout("c2", paperB) } })
    useAgentWindow.getState().newChat()
    useAgentWindow.getState().open(passage(paperB))
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null, selection: passage(paperB) })
  })

  it("opens the bar for a new chat when no chat is about it and the panel is closed", () => {
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().open(passage(paperB))
    expect(useAgentWindow.getState()).toMatchObject({ stage: "bar", chatId: "c1", selection: passage(paperB) })
  })
})

describe("The panel beside a page", () => {
  it("opens on the current chat when that is about the page", () => {
    page.uri = paperA.uri
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().togglePanel()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: "c1" })
  })

  it("opens on the latest chat about the page rather than one from elsewhere", () => {
    page.uri = paperB.uri
    useChatStore.setState({ chats: { c1: chatAbout("c1", paperA), c2: { ...chatAbout("c2", paperB), updatedAt: 2 }, c3: { ...chatAbout("c3", paperB), updatedAt: 3 } } })
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().togglePanel()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: "c3" })
  })

  it("opens on a new chat when none is about the page", () => {
    page.uri = paperB.uri
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().togglePanel()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null })
  })

  it("opens on the current chat away from any page, unless the person left it a while ago", () => {
    useAgentWindow.setState({ stage: "closed" })
    useAgentWindow.getState().togglePanel()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null })
    useChatStore.setState({ chats: { c1: { ...chatAbout("c1", paperA), updatedAt: Date.now() } } })
    useAgentWindow.setState({ stage: "closed", chatId: "c1" })
    useAgentWindow.getState().togglePanel()
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: "c1" })
  })

  it("opens a new chat with the question a page handed over", () => {
    useAgentWindow.getState().askWith(["Go through ", { id: "d", kind: "doc", uri: "owlit://docs/Weekly.md", title: "Weekly", label: "Weekly" }])
    expect(useAgentWindow.getState()).toMatchObject({ stage: "open", chatId: null })
    expect(useAgentWindow.getState().prefill).toHaveLength(2)
  })
})
