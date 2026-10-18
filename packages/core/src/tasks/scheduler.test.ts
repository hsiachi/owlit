import type { Task } from "@owlit/protocol"
import { mkdtempSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { defineTask, Scheduler, TaskFailure, TaskStore, TaskThrottle, type TaskDefinition } from "./index.ts"

const dirs: string[] = []
const schedulers: Scheduler[] = []

afterEach(async () => {
  await Promise.all(schedulers.splice(0).map((s) => s.dispose()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-tasks-"))
  dirs.push(dir)
  return dir
}

async function newScheduler(definitions: TaskDefinition[], dir = tempDir(), onChange?: (task: Task) => void, { start = true } = {}) {
  const scheduler = new Scheduler({ store: new TaskStore(dir), definitions, onChange, retryDelay: () => 5 })
  schedulers.push(scheduler)
  await (start ? scheduler.start() : scheduler.load())
  return { scheduler, dir }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

// Never resolves; rejects when the task is cancelled or the scheduler closes
const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))

describe("Scheduler", () => {
  it("runs at most three network tasks at once", async () => {
    let running = 0
    let most = 0
    const fetch = defineTask("fake.fetch", {
      lane: "network",
      async run() {
        most = Math.max(most, ++running)
        await tick(1)
        running--
      },
    })
    const { scheduler } = await newScheduler([fetch])
    const tasks = Array.from({ length: 100 }, (_, i) => scheduler.enqueue("fake.fetch", `paper-${i}`))
    const finished = await Promise.all(tasks.map((t) => scheduler.wait(t.id)))
    expect(finished.every((t) => t.state === "done")).toBe(true)
    expect(most).toBe(3)
  })

  it("runs nothing, the last session's tasks or new ones, until started", async () => {
    const ran: string[] = []
    const work = defineTask("fake.work", {
      lane: "network",
      async run(ctx) {
        ran.push(ctx.task.subject)
      },
    })
    const dir = tempDir()
    const before = await newScheduler([work], dir, undefined, { start: false })
    before.scheduler.enqueue("fake.work", "left")
    await before.scheduler.dispose()

    const { scheduler } = await newScheduler([work], dir, undefined, { start: false })
    const queued = scheduler.enqueue("fake.work", "new")
    await tick(20)
    expect(ran).toEqual([])
    expect(scheduler.list().map((t) => [t.subject, t.state])).toEqual([
      ["left", "queued"],
      ["new", "queued"],
    ])
    await scheduler.start()
    await scheduler.wait(queued.id)
    expect(ran.sort()).toEqual(["left", "new"])
  })

  it("lets a task someone is waiting for go first", async () => {
    const order: string[] = []
    const gate = deferred()
    const step = defineTask("fake.step", {
      lane: "index",
      async run(ctx) {
        if (ctx.task.subject === "first") await gate.promise
        order.push(ctx.task.subject)
      },
    })
    const { scheduler } = await newScheduler([step])
    scheduler.enqueue("fake.step", "first")
    await tick(0)
    scheduler.enqueue("fake.step", "background-1")
    scheduler.enqueue("fake.step", "background-2", "asked")
    const urgent = scheduler.enqueue("fake.step", "urgent", "waiting")
    gate.resolve()
    await scheduler.wait(urgent.id)
    await tick(5)
    expect(order).toEqual(["first", "urgent", "background-2", "background-1"])
  })

  it("runs the same (kind, subject) once and raises its priority", async () => {
    const run = vi.fn(async () => {
      await tick(1)
    })
    const { scheduler } = await newScheduler([defineTask("fake.once", { lane: "cpu", run })])
    const first = scheduler.enqueue("fake.once", "paper")
    const second = scheduler.enqueue("fake.once", "paper", "waiting")
    expect(second.id).toBe(first.id)
    expect(second.priority).toBe("waiting")
    await scheduler.wait(first.id)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("aborts the signal of a cancelled task", async () => {
    let signal: AbortSignal | undefined
    const started = deferred()
    const hang = defineTask("fake.hang", {
      lane: "network",
      run: (ctx) =>
        new Promise<void>((_, reject) => {
          signal = ctx.signal
          started.resolve()
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason))
        }),
    })
    const { scheduler } = await newScheduler([hang])
    const task = scheduler.enqueue("fake.hang", "paper")
    await started.promise
    expect(scheduler.cancel(task.id)?.state).toBe("cancelled")
    expect(signal?.aborted).toBe(true)
    expect((await scheduler.wait(task.id)).state).toBe("cancelled")
  })

  it("queues what a step needs and runs the step again once it is there", async () => {
    const made = new Set<string>()
    const text = defineTask("fake.text", {
      lane: "cpu",
      run(ctx) {
        if (!made.has(`pdf:${ctx.task.subject}`)) ctx.require("fake.pdf", ctx.task.subject)
        made.add(`text:${ctx.task.subject}`)
      },
    })
    const pdf = defineTask("fake.pdf", {
      lane: "network",
      async run(ctx) {
        await tick(2)
        made.add(`pdf:${ctx.task.subject}`)
      },
    })
    const { scheduler } = await newScheduler([text, pdf])
    const task = scheduler.enqueue("fake.text", "paper", "asked")
    await tick(0)
    expect(scheduler.get(task.id)).toMatchObject({ state: "queued" })
    expect(scheduler.get(task.id)?.blockedOn).toBeDefined()
    const prerequisite = scheduler.get(scheduler.get(task.id)!.blockedOn!)!
    expect(prerequisite).toMatchObject({ kind: "fake.pdf", subject: "paper", priority: "asked" })
    const done = await scheduler.wait(task.id)
    expect(done).toMatchObject({ state: "done", attempts: 1 })
    expect(made.has("text:paper")).toBe(true)
  })

  it("fails a step whose prerequisite ran without producing what it needs", async () => {
    const text = defineTask("fake.text", { lane: "cpu", run: (ctx) => ctx.require("fake.nopdf", ctx.task.subject) })
    const nopdf = defineTask("fake.nopdf", { lane: "network", run: () => {} })
    const { scheduler } = await newScheduler([text, nopdf])
    const done = await scheduler.run("fake.text", "paper")
    expect(done.state).toBe("failed")
    expect(done.error).toMatch(/didn't produce/)
  })

  it("ends a step the way its prerequisite failed", async () => {
    const text = defineTask("fake.text", { lane: "cpu", run: (ctx) => ctx.require("fake.broken", ctx.task.subject) })
    const broken = defineTask("fake.broken", {
      lane: "network",
      run() {
        throw new TaskFailure("No route worked.")
      },
    })
    const { scheduler } = await newScheduler([text, broken])
    const done = await scheduler.run("fake.text", "paper")
    expect(done).toMatchObject({ state: "failed", error: "fake.broken for paper failed: No route worked." })
  })

  it("retries an error three times, then fails", async () => {
    const run = vi.fn(() => {
      throw new Error("Connection reset.")
    })
    const { scheduler } = await newScheduler([defineTask("fake.flaky", { lane: "network", run })])
    const done = await scheduler.run("fake.flaky", "paper")
    expect(run).toHaveBeenCalledTimes(4)
    expect(done).toMatchObject({ state: "failed", attempts: 4, error: "Connection reset." })
  })

  it("doesn't retry a TaskFailure", async () => {
    const run = vi.fn(() => {
      throw new TaskFailure("Not a PDF.")
    })
    const { scheduler } = await newScheduler([defineTask("fake.fact", { lane: "network", run })])
    expect(await scheduler.run("fake.fact", "paper")).toMatchObject({ state: "failed", error: "Not a PDF." })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("gives the lane up while waiting for the user and continues after resume", async () => {
    const log: string[] = []
    const login = defineTask("fake.login", {
      lane: "agent",
      async run(ctx) {
        log.push(`${ctx.task.subject} start`)
        if (ctx.task.subject === "a") await ctx.waitForUser("login", "Sign in to the library proxy.")
        log.push(`${ctx.task.subject} end`)
      },
    })
    const { scheduler } = await newScheduler([login])
    const a = scheduler.enqueue("fake.login", "a")
    const b = scheduler.enqueue("fake.login", "b")
    await scheduler.wait(b.id)
    expect(scheduler.get(a.id)).toMatchObject({ state: "waiting_for_you", waiting: { reason: "login" } })
    expect(scheduler.resume(a.id)?.state).not.toBe("waiting_for_you")
    expect(await scheduler.wait(a.id)).toMatchObject({ state: "done", attempts: 1 })
    expect(log).toEqual(["a start", "b start", "b end", "a end"])
  })

  it("cancels a batch's unstarted tasks with it and lets running ones finish", async () => {
    const gate = deferred()
    const child = defineTask("fake.child", { lane: "agent", run: () => gate.promise })
    const batch = defineTask("fake.batch", {
      lane: "cpu",
      async run(ctx) {
        ctx.enqueue("fake.child", "one")
        ctx.enqueue("fake.child", "two")
        await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason)))
      },
    })
    const { scheduler } = await newScheduler([batch, child])
    const parent = scheduler.enqueue("fake.batch", "import-1")
    await tick(0)
    const [one, two] = scheduler.list().filter((t) => t.kind === "fake.child")
    expect(one).toMatchObject({ parent: parent.id })
    scheduler.cancel(parent.id)
    const running = one.state === "running" ? one : two
    const waiting = running === one ? two : one
    expect(scheduler.get(waiting.id)?.state).toBe("cancelled")
    expect(scheduler.get(running.id)?.state).toBe("running")
    gate.resolve()
    expect((await scheduler.wait(running.id)).state).toBe("done")
  })

  it("cancels everything about a subject", async () => {
    const gate = deferred()
    const step = (kind: string) => defineTask(kind, { lane: "cpu", run: (ctx) => gate.promise.then(() => ctx.signal.throwIfAborted()) })
    const { scheduler } = await newScheduler([step("fake.a"), step("fake.b")])
    const a = scheduler.enqueue("fake.a", "paper")
    const b = scheduler.enqueue("fake.b", "paper")
    const other = scheduler.enqueue("fake.a", "other")
    scheduler.cancelSubject("paper")
    gate.resolve()
    expect((await scheduler.wait(a.id)).state).toBe("cancelled")
    expect((await scheduler.wait(b.id)).state).toBe("cancelled")
    expect((await scheduler.wait(other.id)).state).toBe("done")
  })

  it("debounces: each call pushes a queued run back", async () => {
    const run = vi.fn()
    const { scheduler } = await newScheduler([defineTask("fake.debounced", { lane: "agent", run })])
    const first = scheduler.debounce("fake.debounced", "workspace", 30)
    await tick(15)
    const second = scheduler.debounce("fake.debounced", "workspace", 30)
    expect(second.id).toBe(first.id)
    await tick(20)
    expect(run).not.toHaveBeenCalled()
    await scheduler.wait(first.id)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("starts interrupted tasks again after a restart", async () => {
    const started = deferred()
    const hang = defineTask("fake.hang", {
      lane: "network",
      run: (ctx) =>
        new Promise<void>((_, reject) => {
          started.resolve()
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason))
        }),
    })
    const { scheduler, dir } = await newScheduler([hang])
    const task = scheduler.enqueue("fake.hang", "paper")
    await started.promise
    await scheduler.dispose()
    const open = JSON.parse(await readFile(path.join(dir, "open.json"), "utf8"))
    expect(open.tasks).toMatchObject([{ id: task.id, state: "running" }])

    const run = vi.fn()
    const { scheduler: again } = await newScheduler([defineTask("fake.hang", { lane: "network", run })], dir)
    expect(await again.wait(task.id)).toMatchObject({ state: "done", attempts: 2 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("checks a recorded outside job after a restart instead of submitting another", async () => {
    const submit = vi.fn(async () => "job-42")
    const check = vi.fn(async (_jobId: string) => {})
    const started = deferred()
    const parse = (hang: boolean) =>
      defineTask("fake.parse", {
        lane: "parse",
        async run(ctx) {
          if (ctx.external) return check(ctx.external.jobId)
          await ctx.externalJob("mineru", await submit())
          started.resolve()
          if (hang) await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason)))
        },
      })
    const { scheduler, dir } = await newScheduler([parse(true)])
    const task = scheduler.enqueue("fake.parse", "paper")
    await started.promise
    await scheduler.dispose()

    const { scheduler: again } = await newScheduler([parse(false)], dir)
    expect(await again.wait(task.id)).toMatchObject({ state: "done", external: { service: "mineru", jobId: "job-42" } })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith("job-42")
  })

  it("recovers unfinished tasks from the log when open.json is gone", async () => {
    const { scheduler, dir } = await newScheduler([defineTask("fake.slow", { lane: "index", run: (ctx) => untilAborted(ctx.signal) })])
    const running = scheduler.enqueue("fake.slow", "a")
    const queued = scheduler.enqueue("fake.slow", "b")
    const finished = scheduler.enqueue("fake.slow", "c")
    scheduler.cancel(finished.id)
    await scheduler.dispose()
    await rm(path.join(dir, "open.json"))

    const store = new TaskStore(dir)
    const ids = (await store.load()).map((t) => t.id).sort()
    expect(ids).toEqual([running.id, queued.id].sort())
  })

  it("fails tasks of a kind it no longer knows", async () => {
    const { scheduler, dir } = await newScheduler([defineTask("fake.old", { lane: "cpu", run: (ctx) => untilAborted(ctx.signal) })])
    const task = scheduler.enqueue("fake.old", "paper")
    await scheduler.dispose()
    const { scheduler: again } = await newScheduler([], dir)
    expect(again.get(task.id)).toMatchObject({ state: "failed", error: "owlit no longer knows how to do fake.old." })
  })

  it("stops a background run for an asked one in the same lane, and runs it again after, not as a try", async () => {
    const order: string[] = []
    let firstRun = true
    const work = defineTask("fake.agent", {
      lane: "agent",
      async run(ctx) {
        order.push(`start ${ctx.task.subject}`)
        if (ctx.task.subject === "review" && firstRun) {
          firstRun = false
          await untilAborted(ctx.signal)
        }
        await tick(5)
        order.push(`end ${ctx.task.subject}`)
      },
    })
    const { scheduler } = await newScheduler([work])
    const review = scheduler.enqueue("fake.agent", "review", "background")
    await tick(5)
    expect(scheduler.get(review.id)).toMatchObject({ state: "running", attempts: 1 })
    const asked = scheduler.enqueue("fake.agent", "digest", "asked")
    expect(await scheduler.wait(asked.id)).toMatchObject({ state: "done" })
    expect(await scheduler.wait(review.id)).toMatchObject({ state: "done", attempts: 1 })
    expect(order).toEqual(["start review", "start digest", "end digest", "start review", "end review"])
  })

  it("lets background runs of a kind step aside for a while (a chat being answered)", async () => {
    let runs = 0
    const work = defineTask("fake.review", { lane: "agent", run: (ctx) => (++runs === 1 ? untilAborted(ctx.signal) : undefined) })
    const { scheduler } = await newScheduler([work])
    const review = scheduler.enqueue("fake.review", "a.md", "background")
    await tick(5)
    scheduler.yieldTo("agent", (task) => task.kind === "fake.review", 30)
    await tick(5)
    expect(scheduler.get(review.id)).toMatchObject({ state: "queued", attempts: 0, notBefore: expect.any(Number) })
    expect(await scheduler.wait(review.id)).toMatchObject({ state: "done", attempts: 1 })
  })
})

describe("TaskThrottle", () => {
  it("sends the first change at once and the latest at the end of the window", async () => {
    const sent: Task[] = []
    const throttle = new TaskThrottle(20, (task) => sent.push(task))
    const base = { id: "t", kind: "k", subject: "s", lane: "cpu", priority: "background", attempts: 1, createdAt: 0 } as const
    throttle.push({ ...base, state: "running", progress: { done: 1 } })
    throttle.push({ ...base, state: "running", progress: { done: 2 } })
    throttle.push({ ...base, state: "done" })
    expect(sent.map((t) => t.state)).toEqual(["running"])
    await tick(30)
    expect(sent.map((t) => t.state)).toEqual(["running", "done"])
  })
})
