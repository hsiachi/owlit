import { answer, callsTo, calls, deferred, notify, menuSwitch, openedWorkspace, pageHide } from "@/test/fake-bridge"
import type { Paper, PaperNote, ResultOf } from "@owlit/protocol"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { rpc } from "@/lib/rpc"
import { startWorkspace, switchWorkspace } from "@/lib/workspace"
import { useLibraryStore } from "./store"
import "./disk"

const paper = (id: string, title = id) => ({ id, title, authors: [], ids: {}, kind: "article", tags: [], status: "unread", addedAt: 0 }) as unknown as Paper
const listed = (papers: Paper[], notes: PaperNote[] = []): ResultOf<"library.list"> => ({ papers, highlights: [], notes, aliases: {} })

// Kept before any test fakes timers, to let the queue run without firing the rest timers
const realSetTimeout = globalThis.setTimeout

let workspaces = 0
// Opens a fresh workspace whose library is `papers`, and waits until the store has it
async function openWith(papers: Paper[]) {
  answer("library.list", () => listed(papers))
  openedWorkspace(`/w${++workspaces}`)
  await vi.waitFor(() => expect(Object.keys(useLibraryStore.getState().papers)).toEqual(papers.map((p) => p.id)))
}

const setNote = (paperId: string, content: string) =>
  useLibraryStore.setState((s) => ({ notes: { ...s.notes, [paperId]: { paperId, content } as PaperNote } }))

beforeAll(() => {
  answer("workspace.state", () => ({ current: null, opening: false }))
  startWorkspace()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("library sync", () => {
  it("keeps a library.changed heard while the list is read", async () => {
    const list = deferred<ResultOf<"library.list">>()
    answer("library.list", () => list.promise)
    const before = callsTo("library.list").length
    openedWorkspace(`/w${++workspaces}`)
    await vi.waitFor(() => expect(callsTo("library.list").length).toBe(before + 1))

    notify("library.changed", { papers: [paper("b", "B, from core")], removed: [] })
    list.resolve(listed([paper("a")]))

    await vi.waitFor(() => expect(useLibraryStore.getState().papers.a).toBeDefined())
    expect(useLibraryStore.getState().papers.b?.title).toBe("B, from core")
  })

  it("keeps a library.noteChanged heard while the list is read", async () => {
    const list = deferred<ResultOf<"library.list">>()
    answer("library.list", () => list.promise)
    const before = callsTo("library.list").length
    openedWorkspace(`/w${++workspaces}`)
    await vi.waitFor(() => expect(callsTo("library.list").length).toBe(before + 1))

    notify("library.noteChanged", { paperId: "a", note: { paperId: "a", content: "an agent's note" } as PaperNote })
    list.resolve(listed([paper("a")], [{ paperId: "a", content: "older" } as PaperNote]))

    await vi.waitFor(() => expect(useLibraryStore.getState().papers.a).toBeDefined())
    expect(useLibraryStore.getState().notes.a?.content).toBe("an agent's note")
  })

  it("sends a resting note on pagehide, before its rest is over", async () => {
    await openWith([paper("a")])
    // The rest timer never fires: what reaches core came from pagehide
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    setNote("a", "the last words")
    pageHide()
    // Not vi.waitFor: under fake timers it advances them, and the rest timer would send the note itself
    await new Promise((resolve) => realSetTimeout(resolve, 0))
    expect(callsTo("library.setNote").map((c) => c.params)).toContainEqual({ paperId: "a", content: "the last words" })
  })

  it("sends a resting note before the window opens another workspace", async () => {
    await openWith([paper("a")])
    setNote("a", "typed just before the switch")
    answer("workspace.open", ({ path }) => {
      openedWorkspace(path)
      return { path, name: "next" } as ResultOf<"workspace.open">
    })
    answer("library.list", () => listed([]))
    await switchWorkspace(() => rpc.workspace.open({ path: `/w${++workspaces}` }))

    const sent = calls.findIndex((c) => c.method === "library.setNote" && (c.params as { content: string }).content === "typed just before the switch")
    const opened = calls.findLastIndex((c) => c.method === "workspace.open")
    expect(sent).toBeGreaterThanOrEqual(0)
    expect(sent).toBeLessThan(opened)
  })

  it("sends a resting note when the File menu opens another workspace", async () => {
    await openWith([paper("a")])
    setNote("a", "typed just before File › Open")
    await menuSwitch()
    expect(callsTo("library.setNote").map((c) => c.params)).toContainEqual({ paperId: "a", content: "typed just before File › Open" })
  })

  it("keeps a paper put back by Undo when the removal's library.changed comes late", async () => {
    await openWith([paper("a")])
    const restore = deferred<Paper[]>()
    answer("library.restore", () => restore.promise)

    const removed = useLibraryStore.getState().removePapers(["a"])
    useLibraryStore.getState().restorePapers(removed)
    await vi.waitFor(() => expect(callsTo("library.restore").at(-1)?.params).toEqual({ ids: ["a"] }))
    notify("library.changed", { papers: [], removed: ["a"] })
    expect(useLibraryStore.getState().papers.a).toBeUndefined()

    restore.resolve([paper("a")])
    await vi.waitFor(() => expect(useLibraryStore.getState().papers.a).toBeDefined())
  })
})
