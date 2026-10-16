import { CORE_KINDS, dialAllows, JOURNALED_CORE_KINDS, type ActivityEvent, type EvaluationRecord, type JournaledCoreEvent, type LookedRecord, type RuleRead } from "@owlit/protocol"
import { Presence, TYPING_MS } from "./presence.ts"
import { readJournal } from "../activity/reading.ts"
import { messageOf } from "../util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { RULES, worldOf, type InitiativeEvent, type Rule, type World } from "./rules.ts"

// Runs the rules (rules.ts) over what happens in the open workspace: hears an event, lets each rule
// that listens to it decide, queues the runs they ask for on the workspace's scheduler, and records
// every decision in the journal. Evaluations run one at a time in the order heard, so the same events
// give the same decisions: a replay (replay.ts) feeds the journal back through the same rules, with what
// core saw (trace) and what each rule looked at (trace, rule.looked) as they were.

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export interface InitiativeOptions {
  workspace: () => Workspace | null
  record: (entry: EvaluationRecord) => void
  // What a replay needs besides the decisions: a star core saw, and what each evaluation that decided
  // something looked at (the activity is journaled already)
  trace?: (entry: JournaledCoreEvent | LookedRecord) => void
  // What the rules look at, for one evaluation; a replay answers from the journal
  world?: (ws: Workspace, take: { rule: Rule; event: InitiativeEvent; now: number }) => World
  rules?: readonly Rule[]
  clock?: Clock
  presence?: Presence
}

// Events core makes itself, which say nothing about where the user is
const CORE = new Set<string>(CORE_KINDS)
const TRACED = new Set<string>(JOURNALED_CORE_KINDS)

// The world as it answered: every look and its answer go into reads
function recorded(world: World, reads: RuleRead[]): World {
  const look =
    <A extends (string | number)[], R>(ask: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      const answer = await fn(...args)
      reads.push({ ask, args, answer })
      return answer
    }
  return {
    digestHeldBack: look("digestHeldBack", world.digestHeldBack),
    watched: look("watched", world.watched),
    doc: look("doc", world.doc),
    mtime: look("mtime", world.mtime),
    threads: look("threads", world.threads),
    rowsOf: look("rowsOf", world.rowsOf),
    leaning: look("leaning", world.leaning),
    lastScan: look("lastScan", world.lastScan),
  }
}

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
  private readonly trace: (entry: JournaledCoreEvent | LookedRecord) => void
  private readonly world: NonNullable<InitiativeOptions["world"]>
  private readonly clock: Clock
  // Settling evaluations by rule and key: the last event heard, and its timer
  private settling = new Map<string, { event: InitiativeEvent; timer: unknown }>()
  private chain: Promise<void> = Promise.resolve()
  // Runs started on Owlit's own initiative today (upkeep doesn't count), for the daily cap; read from
  // the journal the first time it is needed in a workspace
  private today: { root: string; day: string; count: number } | null = null
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
    this.trace = options.trace ?? (() => {})
    this.world = options.world ?? ((ws, { now }) => worldOf(ws, now))
    this.clock = options.clock ?? systemClock
    this.presence = options.presence ?? new Presence()
  }

  observe(event: InitiativeEvent) {
    if (this.disposed) return
    if (TRACED.has(event.kind)) this.trace(event as JournaledCoreEvent)
    if (!CORE.has(event.kind)) this.presence.hear(event as ActivityEvent)
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
    const reads: RuleRead[] = []
    const world = recorded(this.world(ws, { rule, event, now }), reads)
    const outcomes = await rule.when(event as never, { world, now, presence: this.presence })
    const cause = { cause: event.kind, causeAt: event.at }
    // A look that decided nothing isn't kept (the hourly look at watched threads, mostly): a replay of
    // the same rules decides nothing there either
    if (reads.length && outcomes.length) this.trace({ kind: "rule.looked", at: now, rule: rule.id, ...cause, reads })
    for (const outcome of outcomes) {
      const base = { kind: "evaluation" as const, at: now, rule: rule.id, subject: outcome.subject, ...cause }
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
