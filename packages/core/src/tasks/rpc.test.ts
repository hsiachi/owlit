import { RpcErrorCode, type RpcNotification, type Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-tasks-rpc-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const open = async (debug = true) => {
    const core = new Core({ userDataDir: path.join(base, "userData"), debug })
    cores.push(core)
    const heard: Task[] = []
    core.onNotify((n: RpcNotification) => {
      if (n.method === "tasks.changed") heard.push((n.params as { task: Task }).task)
    })
    const call = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await call("workspace.open", { path: root })
    return { core, call, heard }
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
    const { call, heard } = await setup().open()
    const task = await call("tasks.debugEnqueue", { subject: "demo", lane: "cpu", ms: 300, steps: 30 })
    await sleep(700)
    const mine = heard.filter((t) => t.id === task.id)
    expect(mine.at(-1)).toMatchObject({ state: "done", progress: { done: 30, total: 30 } })
    // 30 progress steps over 300ms, sent at most every 200ms
    expect(mine.length).toBeLessThan(6)
    expect((await call("tasks.list"))[0]).toMatchObject({ id: task.id, state: "done" })
  })

  it("waits for the user, resumes, and cancels", async () => {
    const { call } = await setup().open()
    const waiting = await call("tasks.debugEnqueue", { subject: "a", ms: 20, steps: 2, waitForYou: true })
    const doomed = await call("tasks.debugEnqueue", { subject: "b", ms: 5000 })
    await sleep(50)
    expect((await call("tasks.list")).find((t: Task) => t.id === waiting.id)).toMatchObject({
      state: "waiting_for_you",
      waiting: { reason: "confirm_spend" },
    })
    await call("tasks.resume", { id: waiting.id })
    expect(await call("tasks.cancel", { id: doomed.id })).toMatchObject({ state: "cancelled" })
    await sleep(50)
    expect((await call("tasks.list")).find((t: Task) => t.id === waiting.id)).toMatchObject({ state: "done" })
  })

  it("runs again after a restart what was running when owlit closed", async () => {
    const { open } = setup()
    const first = await open()
    const task = await first.call("tasks.debugEnqueue", { subject: "long", lane: "index", ms: 5000 })
    await sleep(20)
    await first.core.dispose()
    const second = await open()
    const [again] = await second.call("tasks.list")
    expect(again).toMatchObject({ id: task.id, kind: "debug.index", state: "running", attempts: 2 })
  })
})
