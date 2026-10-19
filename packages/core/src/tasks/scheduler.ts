import { isTaskFinished, TASK_PRIORITIES, type ExternalJob, type Task, type TaskLane, type TaskPriority, type TaskWaiting } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import type { TaskStore } from "./store.ts"
import { clean, messageOf } from "../util.ts"

// How many tasks of each lane run at once. Hosts get their own limits in the HTTP client, inside network.
export const LANE_LIMITS: Record<TaskLane, number> = { network: 3, cpu: 2, parse: 1, agent: 1, index: 1 }

// How many finished tasks list() still shows
const KEEP_FINISHED = 200

export interface TaskContext {
  // The task as it was when this run started
  readonly task: Readonly<Task>
  // Aborted when the task is cancelled or owlit stops; hand it to fetch, child processes, sessions
  readonly signal: AbortSignal
  // The outside job a previous run recorded: look it up instead of starting another
  readonly external: ExternalJob | undefined
  // Shown beside the subject; not written to disk
  progress(done: number, total?: number, note?: string): void
  // Gives up the lane until the user has done what detail says; resolves once tasks.resume is called
  // and a lane is free again, rejects if the task is cancelled meanwhile
  waitForUser(reason: TaskWaiting["reason"], detail: string): Promise<void>
  // What this step needs is missing: queues the task that makes it and ends this run. The task runs
  // again from the start once that one is done.
  require(kind: string, subject: string): never
  // Records an outside job before waiting on it, so a restart checks it instead of submitting again
  externalJob(service: string, jobId: string): Promise<void>
  // Queues a task of this batch: it is cancelled with this one if it hasn't started
  enqueue(kind: string, subject: string, priority?: TaskPriority): Task
  // Not now: ends this run, and the task runs again from the start in ms. Not a try, and the lane is
  // free meanwhile.
  later(ms: number): never
  // The session an agent run keeps its steps in, and what it is doing in a sentence: shown beside the
  // subject and on the rail while the task is open
  describe(patch: Pick<Task, "chatId" | "doing">): void
}

export interface TaskDefinition {
  kind: string
  lane: TaskLane
  // Further runs after an error, waiting 2s, 8s, 32s… between them. Default 3.
  retries?: number
  // Steps are idempotent: a run checks what is already there and does only what is missing
  run(ctx: TaskContext): void | Promise<void>
}

export const defineTask = (kind: string, definition: Omit<TaskDefinition, "kind">): TaskDefinition => ({ kind, ...definition })

// Thrown by a run when the failure is a fact that another try won't change
export class TaskFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskFailure"
  }
}

// How ctx.later ends a run
class Later {
  readonly ms: number
  constructor(ms: number) {
    this.ms = ms
  }
}

// How ctx.require ends a run
class Blocked {
  readonly on: string
  constructor(on: string) {
    this.on = on
  }
}

export interface SchedulerOptions {
  store: TaskStore
  definitions: TaskDefinition[]
  limits?: Partial<Record<TaskLane, number>>
  // Every change of a task, progress included
  onChange?: (task: Task) => void
  // Milliseconds before the retry that follows the given run
  retryDelay?: (attempts: number) => number
}

interface Entry {
  task: Task
  // Set while a run is in flight
  controller?: AbortController
  running?: Promise<void>
  // Counted against the lane: running, and not waiting for the user
  holdsSlot: boolean
  // A run suspended in waitForUser
  suspended?: { resolve: () => void; reject: (reason: unknown) => void }
  waiters: ((task: Task) => void)[]
  // Prerequisites that already ran for this task: requiring one again means it can't be made
  satisfied: Set<string>
  // Stopped to make way for something more urgent: queued again, not counted as a try
  preempted?: boolean
}

const key = (kind: string, subject: string) => `${kind}\u0000${subject}`
const rank = (priority: TaskPriority) => TASK_PRIORITIES.indexOf(priority)
const higher = (a: TaskPriority, b: TaskPriority) => (rank(a) <= rank(b) ? a : b)

// Runs a workspace's tasks: a lane at a time up to its limit, most urgent first, then oldest. Tasks
// persist through the store; after a restart those that were running start again from the top.
export class Scheduler {
  private readonly store: TaskStore
  private readonly definitions = new Map<string, TaskDefinition>()
  private readonly limits: Record<TaskLane, number>
  private readonly onChange: (task: Task) => void
  private readonly retryDelay: (attempts: number) => number
  private entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private loaded = false
  private started = false
  private stopped = false
  private waking = false

  constructor(options: SchedulerOptions) {
    this.store = options.store
    for (const definition of options.definitions) this.definitions.set(definition.kind, definition)
    this.limits = { ...LANE_LIMITS, ...options.limits }
    this.onChange = options.onChange ?? (() => {})
    this.retryDelay = options.retryDelay ?? ((attempts) => 2000 * 4 ** (attempts - 1))
  }

  // Picks up what the last session left unfinished, without running anything yet: tasks queued from
  // now on wait for start()
  async load() {
    if (this.loaded) return
    this.loaded = true
    const now = Date.now()
    const loaded = await this.store.load()
    const open = new Set(loaded.map((task) => task.id))
    const changed: Task[] = []
    for (const stored of loaded) {
      let task: Task = stored
      // Interrupted runs start over; a step that was waiting for the user will ask again
      if (task.state === "running" || task.state === "waiting_for_you") {
        task = clean({ ...task, state: "queued", waiting: undefined, startedAt: undefined, progress: undefined })
      }
      // What it was waiting on finished while owlit was stopped: look again
      if (task.blockedOn && !open.has(task.blockedOn)) task = clean({ ...task, blockedOn: undefined })
      if (!this.definitions.has(task.kind)) {
        task = clean({ ...task, state: "failed", endedAt: now, error: `owlit no longer knows how to do ${task.kind}.` })
      }
      this.entries.set(task.id, { task, holdsSlot: false, waiters: [], satisfied: new Set() })
      if (task !== stored) changed.push(task)
    }
    changed.forEach((task, i) => this.store.record(task, i === changed.length - 1 ? this.openTasks() : undefined))
  }

  // Starts running, picking up the last session's tasks first if load() hasn't
  async start() {
    await this.load()
    this.started = true
    this.wake()
  }

  // Unfinished tasks, most urgent first, then finished ones, most recent first
  list(): Task[] {
    const tasks = [...this.entries.values()].map((entry) => entry.task)
    const open = tasks.filter((task) => !isTaskFinished(task)).sort(byUrgency)
    const finished = tasks.filter(isTaskFinished).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    return [...open, ...finished]
  }

  // Whether this scheduler can run a kind of task
  knows(kind: string) {
    return this.definitions.has(kind)
  }

  get(id: string): Task | undefined {
    return this.entries.get(id)?.task
  }

  // The unfinished task for (kind, subject), raised to priority if that is more urgent, or a new one
  enqueue(kind: string, subject: string, priority: TaskPriority = "background", parent?: string): Task {
    const existing = this.findOpen(kind, subject)
    if (existing) {
      if (higher(priority, existing.task.priority) !== existing.task.priority) {
        this.update(existing, { priority })
        this.wake()
      }
      return existing.task
    }
    return this.create(kind, subject, priority, parent)
  }

  // Runs (kind, subject) once things have been quiet for ms: each call pushes a queued run back. A
  // call while one is running queues another, since the running one may have missed the change.
  debounce(kind: string, subject: string, ms: number, priority: TaskPriority = "background"): Task {
    const notBefore = Date.now() + ms
    const queued = [...this.entries.values()].find(
      (entry) => entry.task.kind === kind && entry.task.subject === subject && entry.task.state === "queued" && !entry.suspended,
    )
    if (queued) {
      this.update(queued, { notBefore, priority: higher(priority, queued.task.priority) })
      this.wake()
      return queued.task
    }
    return this.create(kind, subject, priority, undefined, notBefore)
  }

  // Resolves with the task once it has finished, however it finished
  wait(id: string): Promise<Task> {
    const entry = this.entries.get(id)
    if (!entry) return Promise.reject(new Error(`There is no task ${id}.`))
    if (isTaskFinished(entry.task)) return Promise.resolve(entry.task)
    return new Promise((resolve) => entry.waiters.push(resolve))
  }

  // enqueue, then wait
  run(kind: string, subject: string, priority: TaskPriority = "asked") {
    return this.wait(this.enqueue(kind, subject, priority).id)
  }

  // Stops a task. Its batch's tasks that haven't started go with it; the ones running finish.
  cancel(id: string): Task | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    if (isTaskFinished(entry.task)) return entry.task
    for (const child of this.entries.values()) {
      if (child.task.parent === id && child.task.state === "queued") this.cancel(child.task.id)
    }
    const reason = new DOMException("The task was cancelled.", "AbortError")
    entry.controller?.abort(reason)
    entry.suspended?.reject(reason)
    entry.suspended = undefined
    this.finish(entry, "cancelled")
    this.wake()
    return entry.task
  }

  // Everything still to do about a subject (a paper being deleted), but what `spare` keeps (the task
  // doing the deleting)
  cancelSubject(subject: string, spare?: (task: Task) => boolean) {
    for (const entry of [...this.entries.values()]) {
      if (entry.task.subject === subject && !isTaskFinished(entry.task) && !spare?.(entry.task)) this.cancel(entry.task.id)
    }
  }

  // The user did what a waiting task asked; it continues once its lane has room
  resume(id: string): Task | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    if (entry.task.state !== "waiting_for_you") return entry.task
    this.update(entry, { state: "queued", waiting: undefined })
    this.wake()
    return entry.task
  }

  // Stops running without recording the interrupted runs as ended: the next start() runs them again
  // Resolves once every change so far is in the log
  flush() {
    return this.store.flush()
  }

  async dispose() {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.timer)
    const reason = new DOMException("owlit is closing the workspace.", "AbortError")
    const running: Promise<void>[] = []
    for (const entry of this.entries.values()) {
      entry.controller?.abort(reason)
      entry.suspended?.reject(reason)
      if (entry.running) running.push(entry.running)
    }
    // A run that ignores its signal doesn't hold the workspace open
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([Promise.allSettled(running), new Promise((resolve) => (timer = setTimeout(resolve, 2000)))])
    clearTimeout(timer)
    await this.store.flush()
  }

  // ---- inside ----

  private create(kind: string, subject: string, priority: TaskPriority, parent?: string, notBefore?: number) {
    const definition = this.definitions.get(kind)
    if (!definition) throw new Error(`owlit doesn't know how to do ${kind}.`)
    const task = clean({
      id: randomUUID(),
      kind,
      subject,
      parent,
      lane: definition.lane,
      priority,
      state: "queued",
      attempts: 0,
      createdAt: Date.now(),
      notBefore,
    } satisfies Task)
    const entry: Entry = { task, holdsSlot: false, waiters: [], satisfied: new Set() }
    this.entries.set(task.id, entry)
    this.changed(entry, true)
    this.wake()
    return task
  }

  private findOpen(kind: string, subject: string) {
    let found: Entry | undefined
    for (const entry of this.entries.values()) {
      if (entry.task.kind !== kind || entry.task.subject !== subject || isTaskFinished(entry.task)) continue
      // A queued one is the one that will see the latest state
      if (!found || entry.task.state === "queued") found = entry
    }
    return found
  }

  private openTasks() {
    return [...this.entries.values()].filter((entry) => !isTaskFinished(entry.task)).map((entry) => entry.task)
  }

  // Pumps once the current call is over: the caller gets its task back before anything runs
  private wake() {
    if (this.waking) return
    this.waking = true
    queueMicrotask(() => {
      this.waking = false
      this.pump()
    })
  }

  // Starts whatever may start now, and wakes up again when a delayed task becomes due
  private pump() {
    if (!this.started || this.stopped) return
    clearTimeout(this.timer)
    const now = Date.now()
    let nextDue = Infinity
    const ready: Entry[] = []
    for (const entry of this.entries.values()) {
      const { task } = entry
      if (task.state !== "queued" || task.blockedOn) continue
      if (task.notBefore && task.notBefore > now) nextDue = Math.min(nextDue, task.notBefore)
      else ready.push(entry)
    }
    ready.sort((a, b) => byUrgency(a.task, b.task))
    for (const entry of ready) {
      if (this.inUse(entry.task.lane) < this.limits[entry.task.lane]) this.startRun(entry)
      // Someone asked, or is waiting, and the agent is busy with work nobody asked for: that work steps
      // aside and runs again once there is room (its steps are idempotent). Only agent work: elsewhere a
      // run is short or costly to start over (parsing, indexing)
      else if (entry.task.priority !== "background" && entry.task.lane === "agent") this.preemptOne(entry.task.lane)
    }
    if (nextDue < Infinity) this.timer = setTimeout(() => this.pump(), nextDue - now)
  }

  // Stops the newest background run in a lane, to run again from the start later
  private preemptOne(lane: TaskLane) {
    const running = [...this.entries.values()]
      .filter((e) => e.holdsSlot && e.task.lane === lane && e.task.priority === "background" && !e.preempted)
      .sort((a, b) => (b.task.startedAt ?? 0) - (a.task.startedAt ?? 0))[0]
    if (!running) return
    running.preempted = true
    running.controller?.abort(new DOMException("Something more urgent needed the lane.", "AbortError"))
  }

  private inUse(lane: TaskLane) {
    let count = 0
    for (const entry of this.entries.values()) if (entry.holdsSlot && entry.task.lane === lane) count++
    return count
  }

  private startRun(entry: Entry) {
    entry.holdsSlot = true
    // A run that was waiting for the user picks up where it stopped
    if (entry.suspended) {
      const { resolve } = entry.suspended
      entry.suspended = undefined
      this.update(entry, { state: "running" })
      resolve()
      return
    }
    const definition = this.definitions.get(entry.task.kind)!
    const controller = new AbortController()
    entry.controller = controller
    this.update(entry, {
      state: "running",
      attempts: entry.task.attempts + 1,
      startedAt: Date.now(),
      notBefore: undefined,
      progress: undefined,
    })
    const ctx = this.context(entry, controller.signal)
    entry.running = (async () => definition.run(ctx))().then(
      () => this.settle(entry, definition, controller, null),
      (error: unknown) => this.settle(entry, definition, controller, error ?? new Error("The task failed.")),
    )
  }

  private context(entry: Entry, signal: AbortSignal): TaskContext {
    return {
      task: entry.task,
      signal,
      external: entry.task.external,
      progress: (done, total, note) => {
        if (entry.controller?.signal !== signal || entry.task.state !== "running") return
        this.update(entry, { progress: clean({ done, total, note }) }, false)
      },
      waitForUser: (reason, detail) => {
        if (signal.aborted) return Promise.reject(signal.reason)
        return new Promise<void>((resolve, reject) => {
          entry.suspended = { resolve, reject }
          entry.holdsSlot = false
          this.update(entry, { state: "waiting_for_you", waiting: { reason, detail } })
          this.wake()
        })
      },
      require: (kind, subject) => {
        if (entry.satisfied.has(key(kind, subject))) {
          throw new TaskFailure(`${kind} ran for ${subject} but didn't produce what ${entry.task.kind} needs.`)
        }
        throw new Blocked(this.enqueue(kind, subject, entry.task.priority).id)
      },
      externalJob: async (service, jobId) => {
        this.update(entry, { external: { service, jobId, at: Date.now() } })
        await this.store.flush()
      },
      enqueue: (kind, subject, priority) => this.enqueue(kind, subject, priority ?? entry.task.priority, entry.task.id),
      later: (ms) => {
        throw new Later(ms)
      },
      describe: (patch) => {
        if (entry.controller?.signal !== signal || isTaskFinished(entry.task)) return
        this.update(entry, patch)
      },
    }
  }

  private settle(entry: Entry, definition: TaskDefinition, controller: AbortController, error: unknown) {
    entry.holdsSlot = false
    entry.running = undefined
    entry.controller = undefined
    entry.suspended = undefined
    // Closing: what was running stays recorded as running, to run again next time
    if (this.stopped) return
    const preempted = entry.preempted
    entry.preempted = undefined
    if (isTaskFinished(entry.task)) {
      // Cancelled while it ran; its lane is free only now
    } else if (preempted && error !== null) {
      // Made way for something more urgent: not a try
      this.update(entry, { state: "queued", attempts: entry.task.attempts - 1, progress: undefined })
    } else if (error instanceof Blocked) {
      // Waiting on another task is not a try
      this.update(entry, { state: "queued", attempts: entry.task.attempts - 1, blockedOn: error.on })
      const prerequisite = this.entries.get(error.on)?.task
      // It may have finished before this run did
      if (prerequisite && isTaskFinished(prerequisite)) this.afterPrerequisite(entry, prerequisite)
    } else if (error instanceof Later) {
      this.update(entry, { state: "queued", attempts: entry.task.attempts - 1, notBefore: Date.now() + error.ms, progress: undefined })
    } else if (error === null) {
      this.finish(entry, "done")
    } else if (controller.signal.aborted) {
      this.finish(entry, "cancelled")
    } else {
      const message = messageOf(error)
      const retries = definition.retries ?? 3
      if (error instanceof TaskFailure || entry.task.attempts > retries) this.finish(entry, "failed", message)
      else this.update(entry, { state: "queued", error: message, notBefore: Date.now() + this.retryDelay(entry.task.attempts) })
    }
    this.wake()
  }

  private finish(entry: Entry, state: "done" | "failed" | "cancelled", error?: string) {
    this.update(entry, {
      state,
      endedAt: Date.now(),
      error: state === "done" ? undefined : error,
      waiting: undefined,
      blockedOn: undefined,
      notBefore: undefined,
    })
    for (const resolve of entry.waiters.splice(0)) resolve(entry.task)
    for (const dependent of [...this.entries.values()]) {
      if (dependent.task.blockedOn === entry.task.id && !isTaskFinished(dependent.task)) this.afterPrerequisite(dependent, entry.task)
    }
    this.forgetOldFinished()
  }

  // A task queued behind another goes on once that one is done, or ends the way it ended
  private afterPrerequisite(dependent: Entry, prerequisite: Task) {
    if (prerequisite.state === "done") {
      dependent.satisfied.add(key(prerequisite.kind, prerequisite.subject))
      this.update(dependent, { blockedOn: undefined })
    } else if (prerequisite.state === "cancelled") {
      this.cancel(dependent.task.id)
    } else {
      this.finish(dependent, "failed", `${prerequisite.kind} for ${prerequisite.subject} failed: ${prerequisite.error}`)
    }
  }

  private forgetOldFinished() {
    const finished = [...this.entries.values()].filter((entry) => isTaskFinished(entry.task) && !entry.running)
    if (finished.length <= KEEP_FINISHED) return
    finished.sort((a, b) => (a.task.endedAt ?? 0) - (b.task.endedAt ?? 0))
    for (const entry of finished.slice(0, finished.length - KEEP_FINISHED)) this.entries.delete(entry.task.id)
  }

  private update(entry: Entry, patch: Partial<Task>, persist = true) {
    entry.task = clean({ ...entry.task, ...patch })
    this.changed(entry, persist)
  }

  private changed(entry: Entry, persist: boolean) {
    if (persist && !this.stopped) this.store.record(entry.task, this.openTasks())
    try {
      this.onChange(entry.task)
    } catch (error) {
      console.error("[core] a task listener threw", error)
    }
  }
}

function byUrgency(a: Task, b: Task) {
  return rank(a.priority) - rank(b.priority) || a.createdAt - b.createdAt
}
