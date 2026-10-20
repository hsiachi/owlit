import type { SeenMarks, Unseen } from "@owlit/protocol"
import { describe, expect, it, vi } from "vitest"

// Core as the window's rpc sees it: each seen.get / changes.unseen answers when the test says so
const core = vi.hoisted(() => {
  const answers: { resolve: () => void }[] = []
  let marked = false
  const marks = (): SeenMarks => ({ since: 0, docs: {}, threads: {}, chats: marked ? { c1: { message: "m2", at: 2 } } : {}, comments: {}, digests: {} })
  // Each answer says what core had when it was asked
  const asked = <T>(value: () => T) => {
    const now = value()
    return new Promise<T>((resolve) => answers.push({ resolve: () => resolve(now) }))
  }
  return {
    answers,
    rpc: {
      seen: {
        get: () => asked(marks),
        mark: () => {
          marked = true
          return Promise.resolve(marks())
        },
      },
      changes: { unseen: () => asked((): Unseen => ({ changes: [], chats: marked ? [] : ["c1"], digests: [] })) },
    },
  }
})
vi.mock("@/lib/rpc", () => ({ rpc: core.rpc, onNotify: () => () => {} }))
vi.mock("@/lib/actors", () => ({ me: () => "p_1", myOwlit: () => "o_1" }))
vi.mock("@/lib/workspace", () => ({ onWorkspaceOpened: () => {} }))
vi.mock("@/features/chat/store", () => ({ useChatStore: { getState: () => ({ chats: {} }), subscribe: () => {} } }))
vi.mock("@/features/library/store", () => ({ useLibraryStore: { getState: () => ({ papers: {} }), subscribe: () => {} } }))

const { markSeen, refresh, useSeen } = await import("./seen.ts")

describe("seen marks", () => {
  it("keeps a chat seen when core's answer to an ask from before the mark comes after it", async () => {
    refresh()
    markSeen({ kind: "chat", id: "c1", message: "m2" })
    expect(useSeen.getState().unseen.chats).toEqual([])
    // The ask from before the mark answers with the chat still unseen
    while (core.answers.length < 2) await Promise.resolve()
    core.answers.splice(0).forEach((a) => a.resolve())
    await vi.waitFor(() => expect(useSeen.getState().loaded).toBe(true))
    expect(useSeen.getState().unseen.chats).toEqual([])
    // The ask after core took the mark agrees, and the mark is no longer held
    await vi.waitFor(() => expect(core.answers.length).toBe(2))
    core.answers.splice(0).forEach((a) => a.resolve())
    await vi.waitFor(() => expect(useSeen.getState().marks.chats.c1).toBeDefined())
    expect(useSeen.getState().unseen.chats).toEqual([])
  })
})
