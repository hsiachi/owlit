import { CORE_KINDS, JOURNALED_CORE_KINDS, type ActivityEvent, type EvaluationRecord, type JournaledCoreEvent, type LookedRecord, type RuleRead } from "@owlit/protocol"
import { Presence } from "./presence.ts"
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
}

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

// The most runs the capped rules start in a day; past it, a rule's decision is "none" (cap). A paper
// read in full can fan out to every thread row and comment that leans on it.
export const DAILY_CAP = 20

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
    rowsOf: look("rowsOf", world.rowsOf),
    leaning: look("leaning", world.leaning),
  }
}

const dayOf = (at: number) => new Date(at).toDateString()

export class Initiative {
  private readonly rules: readonly Rule[]
  private readonly workspace: () => Workspace | null
  private readonly record: (entry: EvaluationRecord) => void
  private readonly trace: (entry: JournaledCoreEvent | LookedRecord) => void
  private readonly world: NonNullable<InitiativeOptions["world"]>
  private readonly clock: Clock
  private chain: Promise<void> = Promise.resolve()
  // Capped runs started today, for the daily cap; read from the journal the first time it is needed in
  // a workspace
  private today: { day: string; count: number } | null = null
  // Counts reset(): an evaluation queued before one is about a workspace that has closed
  private epoch = 0
  private disposed = false
  // Where the user is, as their activity says; Owlit's comments wait on it (reviews.ts)
  readonly presence: Presence

  constructor(options: InitiativeOptions) {
    this.rules = options.rules ?? RULES
    this.workspace = options.workspace
    this.record = options.record
    this.trace = options.trace ?? (() => {})
    this.world = options.world ?? ((ws, { now }) => worldOf(ws, now))
    this.clock = options.clock ?? { now: () => Date.now() }
    this.presence = options.presence ?? new Presence()
  }

  observe(event: InitiativeEvent) {
    if (this.disposed) return
    if (TRACED.has(event.kind)) this.trace(event as JournaledCoreEvent)
    if (!CORE.has(event.kind)) this.presence.hear(event as ActivityEvent)
    for (const rule of this.rules) if ((rule.on as readonly string[]).includes(event.kind)) this.evaluate(rule, event)
  }

  // Resolves once every evaluation heard so far has been taken
  idle() {
    return this.chain
  }

  // The workspace is closing: what was queued was about it, and the next one starts afresh
  reset() {
    this.epoch++
    this.today = null
  }

  dispose() {
    this.disposed = true
    this.reset()
  }

  private evaluate(rule: Rule, event: InitiativeEvent) {
    const epoch = this.epoch
    this.chain = this.chain.then(async () => {
      if (epoch === this.epoch) await this.take(rule, event)
    }).catch((error) => console.error(`[core] rule ${rule.id} failed`, error))
  }

  private async take(rule: Rule, event: InitiativeEvent) {
    const ws = this.workspace()
    if (!ws || this.disposed) return
    const now = this.clock.now()
    const reads: RuleRead[] = []
    const world = recorded(this.world(ws, { rule, event, now }), reads)
    const outcomes = await rule.when(event as never, { world, now })
    const cause = { cause: event.kind, causeAt: event.at }
    // A look that decided nothing isn't kept (the hourly look at watched threads, mostly): a replay of
    // the same rules decides nothing there either
    if (reads.length && outcomes.length) this.trace({ kind: "rule.looked", at: now, rule: rule.id, ...cause, reads })
    for (const outcome of outcomes) {
      const base = { kind: "evaluation" as const, at: now, rule: rule.id, subject: outcome.subject, ...cause }
      if ("none" in outcome) {
        this.record({ ...base, decision: "none", reason: outcome.none })
        continue
      }
      if (rule.capped && (await this.countToday(ws, now)) >= DAILY_CAP) {
        this.record({ ...base, decision: "none", reason: "cap" })
        continue
      }
      try {
        const task = ws.tasks.enqueue(outcome.job.kind, outcome.job.subject, outcome.job.priority)
        if (rule.capped && this.today) this.today.count++
        this.record({ ...base, decision: "job", taskId: task.id })
      } catch (error) {
        this.record({ ...base, decision: "none", reason: messageOf(error) })
      }
    }
  }

  private async countToday(ws: Workspace, now: number) {
    const day = dayOf(now)
    if (this.today?.day === day) return this.today.count
    const capped = new Set(this.rules.filter((r) => r.capped).map((r) => r.id))
    const entries = await readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])
    const count = entries.filter((e) => e.kind === "evaluation" && e.decision === "job" && capped.has(e.rule) && dayOf(e.at) === day).length
    this.today = { day, count }
    return count
  }
}
