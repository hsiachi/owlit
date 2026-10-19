// Owlit on its own: what it records about each decision it takes and what the user does with its work.
// The policy itself is core's (core/src/initiative/rules.ts); what is here is what the journal and the
// window share.

// One decision of a rule, with or without an action: a run queued (job), or nothing (none, and why).
// Journals written before the dial went also hold "defer" (not now: the user was on that page).
export interface EvaluationRecord {
  kind: "evaluation"
  at: number
  rule: string
  // What it is about: a paper id, a doc path, a thread id, "workspace"
  subject: string
  decision: "job" | "none" | "defer"
  reason?: string
  // The task a job queued
  taskId?: string
  // What it heard, by kind ("paper.opened", "workspace.opened"), and that event's time: the two find
  // the event in the journal (a replay, an archive's cause). A comment held back when it came to land
  // has cause "landing" and no time.
  cause: string
  causeAt?: number
}

// What core sees on its own that the rules hear
export type CoreEvent =
  // A paper got its star (core sees it whether or not activity is recorded)
  | { kind: "paper.starred"; at: number; paperId: string }
  // The workspace has opened and its tasks run
  | { kind: "workspace.opened"; at: number }
  // Once an hour while the workspace is open
  | { kind: "clock.hour"; at: number }
  // The user's reading of a paper reached the whole of it (core's reading.ts › readInFull), once per paper
  | { kind: "paper.read"; at: number; paperId: string }

export type CoreKind = CoreEvent["kind"]

export const CORE_KINDS: readonly CoreKind[] = ["paper.starred", "workspace.opened", "clock.hour", "paper.read"]

// The ones a replay can't tell from the decisions they led to (they name a paper or a doc), journaled as
// Owlit's. The opening and the hourly tick carry nothing: an archive has them where a rule decided
// something on them.
export const JOURNALED_CORE_KINDS = ["paper.starred", "paper.read"] as const satisfies readonly CoreKind[]

export type JournaledCoreEvent = Extract<CoreEvent, { kind: (typeof JOURNALED_CORE_KINDS)[number] }>

// One thing a rule looked at in the workspace while it decided (a paper's digest, a doc's last change),
// and what it found
export interface RuleRead {
  ask: string
  args: (string | number)[]
  answer: unknown
}

// Everything a rule looked at in one evaluation, journaled before its decisions (when it took any): what
// a replay answers the same questions with, since the workspace has moved on by then
export interface LookedRecord {
  kind: "rule.looked"
  at: number
  rule: string
  cause: string
  causeAt: number
  reads: RuleRead[]
}

// What the user did with Owlit's work: the policy's labels
export type FeedbackWhat = "seen" | "reply" | "apply" | "dismiss" | "undo"

export interface FeedbackRecord {
  kind: `feedback.${FeedbackWhat}`
  at: number
  // A doc path, a comment id
  subject: string
  // The comment it is about
  detail?: Record<string, string | number | boolean>
}

// What `owlit archive export` wrote: a continuo session archive (core/src/initiative/archive.ts)
export interface ArchiveSummary {
  // The archive's folder
  to: string
  events: number
  // The time range it covers (ms); absent when it is empty
  from?: number
  until?: number
  // Why it is empty, when it is
  note?: string
}
