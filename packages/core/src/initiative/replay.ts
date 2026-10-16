import { CORE_KINDS, JOURNALED_KINDS, type EvaluationRecord, type InitiativeSettings, type RuleRead, type Task } from "@owlit/protocol"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Workspace } from "../workspace/workspace.ts"
import type { ArchiveEvent, ArchiveManifest } from "./archive.ts"
import { Initiative, type Clock } from "./initiative.ts"
import { RULES, type InitiativeEvent, type Rule, type World } from "./rules.ts"

// An archive (archive.ts) fed back through the rules: the same events in the same order, on a clock that
// moves only to each event's time, with the dial as the archive says and every look at the workspace
// answered as it was answered then. The same rules give the same decisions; a changed rule shows what it
// would have decided. Nothing runs: a job is only a task id.

// A clock that moves only when told
export class ManualClock implements Clock {
  private timers: { due: number; fn: () => void; id: number }[] = []
  private next = 0
  at: number
  constructor(at: number) {
    this.at = at
  }
  now() {
    return this.at
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.next
    this.timers.push({ due: this.at + ms, fn, id })
    return id
  }
  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((t) => t.id !== handle)
  }
  // Moves to the earliest timer due by upTo and runs it; false when there is none
  fireNext(upTo: number) {
    const due = this.timers.filter((t) => t.due <= upTo).sort((a, b) => a.due - b.due || a.id - b.id)[0]
    if (!due) return false
    this.timers = this.timers.filter((t) => t !== due)
    this.at = Math.max(this.at, due.due)
    due.fn()
    return true
  }
}

// A decision as the archive and the replay can both state it (task ids and times aside)
export interface Decision {
  rule: string
  subject: string
  decision: EvaluationRecord["decision"]
  reason?: string
  cause: string
}

export interface ReplayResult {
  // The rules' decisions in the archive, and the replay's
  recorded: Decision[]
  replayed: Decision[]
  // Looks the replay asked that the archive has no answer for (a changed rule asking something new)
  unanswered: string[]
}

const INPUTS = new Set<string>([...JOURNALED_KINDS, ...CORE_KINDS])
const decisionOf = (e: { rule: string; subject: string; decision: Decision["decision"]; reason?: string; cause: string }): Decision => ({
  rule: e.rule,
  subject: e.subject,
  decision: e.decision,
  ...(e.reason !== undefined ? { reason: e.reason } : {}),
  cause: e.cause,
})
const takeKey = (rule: string, cause: string, causeAt: unknown) => `${rule}\u0000${cause}\u0000${causeAt}`

export async function replay(archive: { manifest: ArchiveManifest; events: ArchiveEvent[] }, rules: readonly Rule[] = RULES): Promise<ReplayResult> {
  const { events, manifest } = archive
  // Only the engine's own decisions: a comment held back as it came to land (Reviews) heard nothing
  const recorded = events.filter((e) => e.type === "evaluation" && e.payload.causeAt !== undefined).map((e) => decisionOf(e.payload as never))

  // What each evaluation looked at, by rule and the event it heard, in the order they were taken (one
  // event is taken again after a defer)
  const looks = new Map<string, RuleRead[][]>()
  for (const e of events) {
    if (e.type !== "rule.looked") continue
    const key = takeKey(e.payload.rule as string, e.payload.cause as string, e.payload.causeAt)
    looks.set(key, [...(looks.get(key) ?? []), e.payload.reads as RuleRead[]])
  }
  const unanswered: string[] = []
  const world = (_ws: Workspace, { rule, event }: { rule: Rule; event: InitiativeEvent }): World => {
    let reads: { read: RuleRead; used: boolean }[] | undefined
    const answer =
      (ask: string) =>
      async (...args: (string | number)[]) => {
        reads ??= (looks.get(takeKey(rule.id, event.kind, event.at))?.shift() ?? []).map((read) => ({ read, used: false }))
        const found = reads.find((r) => !r.used && r.read.ask === ask && JSON.stringify(r.read.args) === JSON.stringify(args))
        if (!found) {
          unanswered.push(`${rule.id} asked ${ask}(${args.join(", ")}) on ${event.kind} at ${new Date(event.at).toISOString()}`)
          throw new Error("The archive has no answer for this look.")
        }
        found.used = true
        return found.read.answer as never
      }
    return { digestHeldBack: answer("digestHeldBack"), watched: answer("watched"), doc: answer("doc"), mtime: answer("mtime") }
  }

  const settings: InitiativeSettings = { ...manifest.safeConfig.owlit.initiative }
  let tasks = 0
  const dir = await mkdtemp(path.join(tmpdir(), "owlit-replay-"))
  // What the engine asks of a workspace itself: the dial, where today's count of runs would be read
  // (nowhere: the count starts at the archive's start), and somewhere to queue
  const ws = {
    root: dir,
    owlitPath: (...parts: string[]) => path.join(dir, ...parts),
    initiative: async () => settings,
    tasks: { enqueue: () => ({ id: `replay-${++tasks}` }) as Task },
  } as unknown as Workspace

  const replayed: Decision[] = []
  const clock = new ManualClock(events[0]?.at ?? 0)
  const engine = new Initiative({ workspace: () => ws, record: (r) => replayed.push(decisionOf(r)), rules, clock, world })
  // Runs everything due by then, one timer at a time, each evaluation taken before the next timer
  const until = async (at: number) => {
    do await engine.idle()
    while (clock.fireNext(at))
    clock.at = Math.max(clock.at, at)
  }
  for (const e of events) {
    if (e.type === "feedback.dialChanged") {
      await until(e.at)
      settings.mode = (e.payload.detail as { to: InitiativeSettings["mode"] }).to
    } else if (INPUTS.has(e.type)) {
      await until(e.at)
      engine.observe({ kind: e.type, at: e.at, ...e.payload } as InitiativeEvent)
    }
  }
  await until(events.reduce((last, e) => Math.max(last, e.at), clock.at))
  engine.dispose()
  return { recorded, replayed, unanswered }
}

// Where two decision lists part, position by position
export function differences(a: Decision[], b: Decision[]) {
  const out: { at: number; recorded?: Decision; replayed?: Decision }[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) out.push({ at: i, recorded: a[i], replayed: b[i] })
  return out
}
