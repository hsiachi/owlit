import type { TaskLane } from "@owlit/protocol"

// Every kind of work Owlit does in a background session has one shape: what it is told (instructions,
// with a format version so a change of wording is visible in what it wrote), the owlit tools it may use
// besides the read-only ones, what it may change through core, and the lane it runs in. A task runs a
// skill, and the user started the task: from a menu, a button or a chat. The owner rules for what it
// writes are core's, not the skill's: a skill only narrows the tools.

// What a run may change, always through core and signed as Owlit's
// record: a new doc of Owlit's own beside the material it went through (Go through)
export type SkillWrite = "thread" | "paper" | "comment" | "record"

export interface Skill<I> {
  id: string
  format: number
  lane: TaskLane
  // Owlit's tools it may use besides the read-only ones; none: those only
  tools?: RegExp
  writes: readonly SkillWrite[]
  instructions: (input: I) => string
}

export const defineSkill = <I>(skill: Skill<I>): Skill<I> => skill
