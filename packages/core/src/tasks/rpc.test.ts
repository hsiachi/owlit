import { RpcErrorCode, type RpcNotification, type Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { until } from "../test-util.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-tasks-rpc-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const open = async (debug = true) => {
    const core = new Core({ userDataDir: path.join(base, "userData"), debug })
    cores.push(core)
    const heard: Task[] = []
    const heardAt: number[] = []
    core.onNotify((n: RpcNotification) => {
      if (n.method !== "tasks.changed") return
      heard.push((n.params as { task: Task }).task)
      heardAt.push(performance.now())
    })
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    const state = async (id: string) => (await call("tasks.list")).find((t: Task) => t.id === id)?.state
    return { core, call, heard, heardAt, state }
  }
  return { open }
}

describe("tasks over RPC", () => {
  it("needs a workspace", async () => {
    const core = new Core({ userDataDir: mkdtempSync(path.join(tmpdir(), "owlit-tasks-rpc-")) })
    cores.push(core)
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "tasks.list" })
    expect(response).toMatchObject({ error: { code: RpcErrorCode.NoWorkspace } })
  })

  it("offers debugEnqueue only to a development build", async () => {
    const { call } = await setup().open(false)
    await expect(call("tasks.debugEnqueue", { subject: "x" })).rejects.toMatchObject({ code: RpcErrorCode.MethodNotFound })
  })

  it("sends tasks.changed as a debug task runs, throttled, ending with its last state", async () => {
    const { call, heard, heardAt } = await setup().open()
    const task = await call("tasks.debugEnqueue", { subject: "demo", lane: "cpu", ms: 300, steps: 30 })
    await until(() => heard.some((t) => t.id === task.id && t.state === "done"), { what: "the task's done notification" })
    const mine = heard.flatMap((t, i) => (t.id === task.id ? [{ task: t, at: heardAt[i]! }] : []))
    expect(mine.at(-1)!.task).toMatchObject({ state: "done", progress: { done: 30, total: 30 } })
    // 30 progress steps, sent at most every 200ms: fewer notifications than steps, and none closer together
    // than the window, however long the run took (a timer can fire a millisecond early, hence 195)
    expect(mine.length).toBeLessThan(30)
    for (let i = 1; i < mine.length; i++) expect(mine[i]!.at - mine[i - 1]!.at).toBeGreaterThanOrEqual(195)
    expect((await call("tasks.list")).find((t: Task) => t.id === task.id)).toMatchObject({ state: "done" })
  })

  it("waits for the user, resumes, and cancels", async () => {
    const { call, state } = await setup().open()
    const waiting = await call("tasks.debugEnqueue", { subject: "a", ms: 20, steps: 2, waitForYou: true })
    const doomed = await call("tasks.debugEnqueue", { subject: "b", ms: 5000 })
    await until(async () => (await state(waiting.id)) === "waiting_for_you", { what: "the task to wait for the user" })
    expect((await call("tasks.list")).find((t: Task) => t.id === waiting.id)).toMatchObject({
      state: "waiting_for_you",
      waiting: { reason: "confirm_spend" },
    })
    await call("tasks.resume", { id: waiting.id })
    expect(await call("tasks.cancel", { id: doomed.id })).toMatchObject({ state: "cancelled" })
    await until(async () => (await state(waiting.id)) === "done", { what: "the resumed task to finish" })
  })

  it("runs again after a restart what was running when owlit closed", async () => {
    const { open } = setup()
    const first = await open()
    const task = await first.call("tasks.debugEnqueue", { subject: "long", lane: "index", ms: 5000 })
    await until(async () => (await first.state(task.id)) === "running", { what: "the task to start" })
    await first.core.dispose()
    const second = await open()
    const again = (await second.call("tasks.list")).find((t: Task) => t.id === task.id)
    expect(again).toMatchObject({ id: task.id, kind: "debug.index", state: "running", attempts: 2 })
  })
})
