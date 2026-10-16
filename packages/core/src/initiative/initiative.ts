import { dialAllows, type ActivityEvent, type EvaluationRecord } from "@owlit/protocol"
import { Presence, TYPING_MS } from "./presence.ts"
import { readJournal } from "../activity/reading.ts"
import { messageOf } from "../util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { RULES, type InitiativeEvent, type Rule } from "./rules.ts"

// Runs the rules (rules.ts) over what happens in the open workspace: hears an event, lets each rule
// that listens to it decide, queues the runs they ask for on the workspace's scheduler, and records
// every decision in the journal. Evaluations run one at a time in the order heard, so the same events
// give the same decisions (a replay depends on it).

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export interface InitiativeOptions {
  workspace: () => Workspace | null
  record: (entry: EvaluationRecord) => void
  rules?: readonly Rule[]
  clock?: Clock
  presence?: Presence
}

// Events core makes itself, which say nothing about where the user is
const CORE_KINDS = new Set<string>(["paper.starred", "workspace.opened", "clock.hour"])

const dayOf = (at: number) => new Date(at).toDateString()

export class Initiative {
  private readonly rules: readonly Rule[]
  private readonly workspace: () => Workspace | null
  private readonly record: (entry: EvaluationRecord) => void
  private readonly clock: Clock
  // Settling evaluations by rule and key: the last event heard, and its timer
  private settling = new Map<string, { event: InitiativeEvent; timer: unknown }>()
  private chain: Promise<void> = Promise.resolve()
  // Runs started on Owlit's own initiative today (upkeep doesn't count), for the daily cap; read from
  // the journal the first time it is needed in a workspace
  private today: { root: string; day: string; count: number } | null = null
  // Decisions put off while the user writes in what they are about, by rule and subject
  private deferred = new Map<string, { rule: Rule; event: InitiativeEvent }>()
  private deferTimer: unknown
  private disposed = false
  readonly presence: Presence

  constructor(options: InitiativeOptions) {
    this.rules = options.rules ?? RULES
    this.workspace = options.workspace
    this.record = options.record
    this.clock = options.clock ?? systemClock
    this.presence = options.presence ?? new Presence()
  }

  observe(event: InitiativeEvent) {
    if (this.disposed) return
    if (!CORE_KINDS.has(event.kind)) this.presence.hear(event as ActivityEvent)
    // What waited for the user to stop or leave is looked at again when they do
    if (event.kind === "doc.closed" || event.kind === "idle") this.retryDeferred()
    for (const rule of this.rules) {
      if (!(rule.on as readonly string[]).includes(event.kind)) continue
      if (!rule.settleMs) {
        this.evaluate(rule, event)
        continue
      }
      const key = `${rule.id}\u0000${rule.key?.(event as never) ?? ""}`
      const pending = this.settling.get(key)
      if (pending) this.clock.clearTimeout(pending.timer)
      const timer = this.clock.setTimeout(() => {
        this.settling.delete(key)
        this.evaluate(rule, event)
      }, rule.settleMs)
      this.settling.set(key, { event, timer })
    }
  }

  // Resolves once every evaluation heard so far has been taken (settling ones aren't)
  idle() {
    return this.chain
  }

  dispose() {
    this.disposed = true
    for (const { timer } of this.settling.values()) this.clock.clearTimeout(timer)
    this.settling.clear()
    this.clock.clearTimeout(this.deferTimer)
    this.deferred.clear()
  }

  private retryDeferred() {
    this.clock.clearTimeout(this.deferTimer)
    this.deferTimer = undefined
    const waiting = [...this.deferred.values()]
    this.deferred.clear()
    for (const { rule, event } of waiting) this.evaluate(rule, event)
  }

  // A decision put off is taken again once the user may have stopped: when they leave the doc or the
  // window, or after a typing pause's length
  private defer(rule: Rule, event: InitiativeEvent, subject: string) {
    this.deferred.set(`${rule.id}\u0000${subject}`, { rule, event })
    if (this.deferTimer === undefined) this.deferTimer = this.clock.setTimeout(() => this.retryDeferred(), TYPING_MS)
  }

  private evaluate(rule: Rule, event: InitiativeEvent) {
    this.chain = this.chain.then(() => this.take(rule, event)).catch((error) => console.error(`[core] rule ${rule.id} failed`, error))
  }

  private async take(rule: Rule, event: InitiativeEvent) {
    const ws = this.workspace()
    if (!ws || this.disposed) return
    const settings = await ws.initiative()
    // Off for this rule: it doesn't run at all, so there is nothing to log
    if (!dialAllows(settings.mode, rule.needs)) return
    const now = this.clock.now()
    const outcomes = await rule.when(event as never, { ws, now, presence: this.presence })
    for (const outcome of outcomes) {
      const base = { kind: "evaluation" as const, at: now, rule: rule.id, subject: outcome.subject, cause: event.kind }
      if ("none" in outcome) {
        this.record({ ...base, decision: "none", reason: outcome.none })
        continue
      }
      if ("defer" in outcome) {
        this.record({ ...base, decision: "defer", reason: outcome.defer })
        this.defer(rule, event, outcome.subject)
        continue
      }
      const initiative = rule.needs !== "off"
      if (initiative && (await this.countToday(ws, now)) >= settings.dailyCap) {
        this.record({ ...base, decision: "none", reason: "cap" })
        continue
      }
      try {
        const task = ws.tasks.enqueue(outcome.job.kind, outcome.job.subject, outcome.job.priority)
        if (initiative && this.today) this.today.count++
        this.record({ ...base, decision: "job", taskId: task.id })
      } catch (error) {
        this.record({ ...base, decision: "none", reason: messageOf(error) })
      }
    }
  }

  private async countToday(ws: Workspace, now: number) {
    const day = dayOf(now)
    if (this.today?.root === ws.root && this.today.day === day) return this.today.count
    const initiative = new Set(this.rules.filter((r) => r.needs !== "off").map((r) => r.id))
    const entries = await readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])
    const count = entries.filter((e) => e.kind === "evaluation" && e.decision === "job" && initiative.has(e.rule) && dayOf(e.at) === day).length
    this.today = { root: ws.root, day, count }
    return count
  }
}
