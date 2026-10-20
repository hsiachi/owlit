import { answer } from "@/test/fake-bridge"
import type { Chat, ChatMessage, Connector, MessagePart } from "@owlit/protocol"
import { describe, expect, it } from "vitest"

// The chat store asks for the agents as it loads
answer("agents.list", () => [])
const { waitingItems } = await import("./waiting-on-you")
const { DAY } = await import("@/lib/time")

const NOW = 100 * DAY
const chat = (id: string, last: Partial<ChatMessage>): Chat => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  messages: [
    { id: `${id}-u`, role: "user", createdAt: NOW - DAY, parts: [{ type: "text", text: "hi" }] },
    { id: `${id}-a`, role: "assistant", createdAt: NOW - DAY, parts: [], ...last },
  ],
})
const permission: MessagePart = { type: "permission", requestId: "r1", toolCallId: "t1", title: "Run pdftotext", kind: "execute", options: [] }
const agent = (id: string, status: Connector["status"]) => ({ id, name: id, status, models: [], modes: [], builtIn: false }) as unknown as Connector
const none = { chats: [], streaming: {}, connectors: [], imports: [], siteWaits: [], finished: false, now: NOW }
const keys = (src: Partial<Parameters<typeof waitingItems>[0]>) => waitingItems({ ...none, ...src }, () => undefined).map((w) => w.key)

describe("waiting on you", () => {
  it("lists a chat's question while its turn runs, and lets it go once answered", () => {
    const asking = chat("c1", { status: "streaming", parts: [permission] })
    expect(keys({ chats: [asking], streaming: { c1: true } })).toEqual(["ask:c1"])
    const answered = chat("c1", { status: "streaming", parts: [{ ...permission, outcome: "allow_once" }] })
    expect(keys({ chats: [answered], streaming: { c1: true } })).toEqual([])
  })

  it("lists a broken reply for three days, with Retry and nothing to dismiss", () => {
    const broken = (age: number) => chat("c2", { status: "error", error: "Claude Code quit.", createdAt: NOW - age })
    const [row] = waitingItems({ ...none, chats: [broken(2 * DAY)] }, () => undefined)
    expect(row).toMatchObject({ key: "fail:c2", what: "Owlit stopped", detail: "Claude Code quit.", action: { label: "Retry" } })
    expect(row).not.toHaveProperty("dismiss")
    expect(keys({ chats: [broken(3 * DAY + 1)] })).toEqual([])
  })

  it("puts chats first, then the agents in use, then the finished mark for the rail", () => {
    const src = {
      chats: [chat("c3", { status: "error", createdAt: NOW - 1 })],
      connectors: [agent("claude", "error"), agent("codex", "not_installed")],
      selected: "claude",
      finished: true,
    }
    // Codex has a problem but runs nothing here
    expect(keys(src)).toEqual(["fail:c3", "agent:claude", "chat:finished"])
    expect(keys({ ...src, background: "codex" })).toEqual(["fail:c3", "agent:claude", "agent:codex", "chat:finished"])
  })
})
