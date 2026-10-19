import type { Chat, ChatMessage, MessagePart } from "@owlit/protocol"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/seen", () => ({ markSeen: () => {} }))
vi.mock("./store", () => ({ useChatStore: { getState: () => ({ chats: {} }), subscribe: () => () => {} } }))

const { brokenReply, chatStatus, chatWait, pendingAsk } = await import("./status.ts")

const chat = (last: Partial<ChatMessage>): Chat => ({
  id: "c1",
  title: "t",
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  connectorId: "claude-code",
  messages: [
    { id: "u1", role: "user", createdAt: 1, parts: [{ type: "text", text: "hi" }] },
    { id: "a1", role: "assistant", createdAt: 2, parts: [], ...last },
  ],
})
const permission: MessagePart = { type: "permission", requestId: "r1", toolCallId: "t1", title: "Run pdftotext", kind: "execute", options: [] }

describe("where a chat stands", () => {
  it("works while its turn runs, and waits while that turn asks the person", () => {
    expect(chatStatus(chat({ status: "streaming" }), true, false, undefined)).toBe("working")
    const asking = chat({ status: "streaming", parts: [permission] })
    expect(chatStatus(asking, true, false, undefined)).toBe("waiting")
    expect(chatWait(asking, true, undefined)?.ask?.requestId).toBe("r1")
    // Answered, it works again
    expect(pendingAsk(chat({ status: "streaming", parts: [{ ...permission, outcome: "reject_once" }] }))).toBeUndefined()
  })

  it("goes by the running turns, not by a reply's own status", () => {
    // A reply still saved as streaming with no turn running is not at work
    expect(chatStatus(chat({ status: "streaming" }), false, false, undefined)).toBe("idle")
  })

  it("asks for the person when a reply broke, until they dismiss it", () => {
    const broken = chat({ status: "error", error: "Claude Code quit unexpectedly." })
    expect(chatStatus(broken, false, false, undefined)).toBe("failed")
    expect(chatWait(broken, false, undefined)?.broken?.id).toBe("a1")
    expect(chatStatus(broken, false, false, "a1")).toBe("idle")
  })

  it("doesn't call a reply owlit cut off by closing or switching broken", () => {
    const cut = chat({ status: "error", error: "Owlit was closed before it finished.", cutOff: "closed" })
    expect(brokenReply(cut, undefined)).toBeUndefined()
    expect(chatStatus(cut, false, false, undefined)).toBe("idle")
    expect(chatWait(cut, false, undefined)).toBeUndefined()
  })

  it("is finished when a reply ended while the person was elsewhere", () => {
    expect(chatStatus(chat({ status: "done" }), false, true, undefined)).toBe("finished")
  })
})
