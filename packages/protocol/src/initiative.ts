// Owlit on its own: the dial that says how far it may go without being asked, and what it records about
// each decision it takes and what the user does with its work. The policy itself is core's
// (core/src/initiative/rules.ts); what is here is what the journal and the window share.

// Settings › Owlit › On its own, per workspace (.owlit/workspace.json): off, Owlit only keeps up what it
// already keeps (digests, watched threads); onOpen, it also looks at what the user opens; away, it also
// works while the user is away
export type InitiativeMode = "off" | "onOpen" | "away"

export const INITIATIVE_MODES: readonly InitiativeMode[] = ["off", "onOpen", "away"]

export interface InitiativeSettings {
  mode: InitiativeMode
  // The most runs Owlit starts on its own in a day; past it, a rule's decision is "none" (cap)
  dailyCap: number
}

export const INITIATIVE_DEFAULTS: InitiativeSettings = { mode: "off", dailyCap: 20 }

// Whether a rule that needs `needs` may run with the dial at `mode`
export const dialAllows = (mode: InitiativeMode, needs: InitiativeMode) => INITIATIVE_MODES.indexOf(mode) >= INITIATIVE_MODES.indexOf(needs)

// One decision of a rule, with or without an action: a run queued (job), nothing (none, and why), or
// not now (defer: the user is on that page; it is looked at again later)
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
  // What it heard, by kind ("paper.opened", "workspace.opened")
  cause: string
}

// What the user did with Owlit's work, and the dial itself: the policy's labels
export type FeedbackWhat = "seen" | "reply" | "apply" | "dismiss" | "undo" | "dialChanged"

export interface FeedbackRecord {
  kind: `feedback.${FeedbackWhat}`
  at: number
  // A doc path, a comment id, "workspace" for the dial
  subject: string
  // The comment it is about, the dial's old and new positions
  detail?: Record<string, string | number | boolean>
}
