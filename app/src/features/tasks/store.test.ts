import { answer, callsTo, deferred, notify, openedWorkspace } from "@/test/fake-bridge"
import type { Task } from "@owlit/protocol"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { startWorkspace } from "@/lib/workspace"
import { startTasks, useTasksStore } from "./store"

const task = (id: string, state: string) => ({ id, state, subject: "paper:a", kind: "pdf" }) as unknown as Task

beforeAll(() => {
  answer("workspace.state", () => ({ current: null, opening: false }))
  startWorkspace()
  startTasks()
})

describe("tasks store", () => {
  it("keeps a tasks.changed heard while the list is read", async () => {
    const list = deferred<Task[]>()
    answer("tasks.list", () => list.promise)
    openedWorkspace("/w1")
    await vi.waitFor(() => expect(callsTo("tasks.list")).toHaveLength(1))

    notify("tasks.changed", { task: task("t1", "done") })
    list.resolve([task("t1", "running"), task("t2", "queued")])

    await vi.waitFor(() => expect(useTasksStore.getState().byId.t2).toBeDefined())
    expect(useTasksStore.getState().byId.t1?.state).toBe("done")
  })
})
