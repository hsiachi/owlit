import { answer, callsTo, deferred, notify, openedWorkspace } from "@/test/fake-bridge"
import type { Thread, ThreadSummary } from "@owlit/protocol"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { startWorkspace } from "@/lib/workspace"
import { useThreadsStore } from "./store"
import "./disk"

const thread = (id: string, title = id) => ({ id, title }) as unknown as Thread

beforeAll(() => {
  answer("workspace.state", () => ({ current: null, opening: false }))
  startWorkspace()
})

describe("threads sync", () => {
  it("keeps a threads.changed heard while the threads are read", async () => {
    const list = deferred<ThreadSummary[]>()
    answer("threads.list", () => list.promise)
    answer("threads.get", ({ id }) => thread(id, `${id}, as listed`))
    openedWorkspace("/w1")
    await vi.waitFor(() => expect(callsTo("threads.list")).toHaveLength(1))

    // An agent writes one thread and deletes another while the list is on its way
    notify("threads.changed", { id: "a", thread: thread("a", "a, as the agent left it") })
    notify("threads.changed", { id: "gone", thread: null })
    list.resolve([{ id: "a" }, { id: "gone" }] as ThreadSummary[])

    await vi.waitFor(() => expect(useThreadsStore.getState().loaded).toBe(true))
    const { threads } = useThreadsStore.getState()
    expect(threads.a?.title).toBe("a, as the agent left it")
    expect(threads.gone).toBeUndefined()
  })
})
