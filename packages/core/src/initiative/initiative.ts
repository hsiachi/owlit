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
const CORE_KINDS = new Set<string>(["paper.starred", "paper.landed", "paper.read", "docs.appeared", "workspace.opened", "clock.hour"])

const dayOf = (at: number) => new Date(at).toDateString()

interface Deferred {
  rule: Rule
  event: InitiativeEvent
  until?: "away"
}

export class Initiative {
  private readonly rules: readonly Rule[]
  private readonly workspace: () => Workspace | null
  private readonly record: (entry: EvaluationRecord) => void
  private readonly clock: Clock
  // Settling evaluations by rule and key: the last event heard, and its timer
  private settling = new Map<string, { event: InitiativeEvent; timer: unknown }>()
  private chain: Promise<void> = Promise.resolve()
  // The runs the rules queued in this workspace (rule, subject, when), read from the journal the first
  // time they are needed and kept up from then on: for the daily cap and a rule's last run
  private jobs: { root: string; list: { rule: string; subject: string; at: number }[] } | null = null
  // Decisions put off, by rule and subject: while the user writes in what they are about, or until away
  private deferred = new Map<string, Deferred>()
  // The deferral last logged for each rule and subject, so waiting on goes into the journal once
  private deferLogged = new Map<string, string>()
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
    // What waited for the user to stop or leave is looked at again when they do; what waited for them to
    // be away, once they are
    if (event.kind === "doc.closed") this.retryDeferred(false)
    if (event.kind === "idle" && this.presence.isAway) this.retryDeferred(true)
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

  // away: the user has just gone away, and everything waiting is looked at again; otherwise only what
  // waited for a pause
  private retryDeferred(away: boolean) {
    const waiting = [...this.deferred.entries()].filter(([, d]) => away || !d.until)
    for (const [key] of waiting) this.deferred.delete(key)
    if (![...this.deferred.values()].some((d) => !d.until)) {
      this.clock.clearTimeout(this.deferTimer)
      this.deferTimer = undefined
    }
    // A rule that put off several subjects of one event looks at the event once
    const again = new Map<Rule, Set<InitiativeEvent>>()
    for (const [, { rule, event }] of waiting) {
      const events = again.get(rule) ?? new Set()
      if (events.has(event)) continue
      again.set(rule, events.add(event))
      this.evaluate(rule, event)
    }
  }

  // A decision put off is taken again once the user may have stopped: when they leave the doc or the
  // window, or after a typing pause's length; one that waits for them to be away, when they go
  private defer(rule: Rule, event: InitiativeEvent, subject: string, until: "away" | undefined) {
    this.deferred.set(`${rule.id}\u0000${subject}`, { rule, event, until })
    if (!until && this.deferTimer === undefined)
      this.deferTimer = this.clock.setTimeout(() => {
        this.deferTimer = undefined
        this.retryDeferred(false)
      }, TYPING_MS)
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
    const lastJob = async (subject: string) => {
      const list = await this.jobsOf(ws)
      for (let i = list.length - 1; i >= 0; i--) if (list[i]!.rule === rule.id && list[i]!.subject === subject) return list[i]!.at
      return null
    }
    const outcomes = await rule.when(event as never, { ws, now, presence: this.presence, lastJob })
    for (const outcome of outcomes) {
      const base = { kind: "evaluation" as const, at: now, rule: rule.id, subject: outcome.subject, cause: event.kind }
      const key = `${rule.id}\u0000${outcome.subject}`
      if ("defer" in outcome) {
        if (this.deferLogged.get(key) !== outcome.defer) this.record({ ...base, decision: "defer", reason: outcome.defer })
        this.deferLogged.set(key, outcome.defer)
        this.defer(rule, event, outcome.subject, outcome.until)
        continue
      }
      this.deferLogged.delete(key)
      if ("none" in outcome) {
        this.record({ ...base, decision: "none", reason: outcome.none })
        continue
      }
      const initiative = rule.needs !== "off"
      if (initiative && (await this.countToday(ws, now)) >= settings.dailyCap) {
        this.record({ ...base, decision: "none", reason: "cap" })
        continue
      }
      try {
        const task = ws.tasks.enqueue(outcome.job.kind, outcome.job.subject, outcome.job.priority)
        ;(await this.jobsOf(ws)).push({ rule: rule.id, subject: outcome.subject, at: now })
        this.record({ ...base, decision: "job", taskId: task.id })
      } catch (error) {
        this.record({ ...base, decision: "none", reason: messageOf(error) })
      }
    }
  }

  private async jobsOf(ws: Workspace) {
    if (this.jobs?.root === ws.root) return this.jobs.list
    const entries = await readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])
    const list = entries.flatMap((e) => (e.kind === "evaluation" && e.decision === "job" ? [{ rule: e.rule, subject: e.subject, at: e.at }] : []))
    // Another workspace may have opened while the journal was read
    if (this.jobs?.root !== ws.root) this.jobs = { root: ws.root, list }
    return this.jobs.list
  }

  // Runs started on Owlit's own initiative today; upkeep doesn't count
  private async countToday(ws: Workspace, now: number) {
    const day = dayOf(now)
    const initiative = new Set(this.rules.filter((r) => r.needs !== "off").map((r) => r.id))
    return (await this.jobsOf(ws)).filter((j) => initiative.has(j.rule) && dayOf(j.at) === day).length
  }
}
