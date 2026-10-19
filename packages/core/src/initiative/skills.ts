import type { TaskLane, Thread, ThreadColumn } from "@owlit/protocol"
import { fillPrompt, gatherPrompt, morePrompt, readPrompt, type GatherSize } from "../threads/prompts.ts"

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

// Thread work: everything it does goes through thread_write, so the thread shows it with Owlit's dots
const SEARCH = /^(library_(search|related|journal)|thread_write)$/
export const gatherSkill = defineSkill<{ thread: Thread; size: GatherSize; withText: string[] }>({
  id: "threads.gather",
  format: 2,
  lane: "agent",
  tools: SEARCH,
  writes: ["thread"],
  instructions: ({ thread, size, withText }) => gatherPrompt(thread, size, withText),
})
export const moreSkill = defineSkill<{ thread: Thread; withText: string[]; lookFor?: string }>({
  id: "threads.more",
  format: 3,
  lane: "agent",
  tools: SEARCH,
  writes: ["thread"],
  instructions: ({ thread, withText, lookFor }) => morePrompt(thread, withText, lookFor),
})
export const fillSkill = defineSkill<{ thread: Thread; column: ThreadColumn; withText: string[] }>({
  id: "threads.fill",
  format: 2,
  lane: "agent",
  tools: /^thread_write$/,
  writes: ["thread"],
  instructions: ({ thread, column, withText }) => fillPrompt(thread, column, withText),
})
// Reading in full means the paper is used: it joins the library
export const readSkill = defineSkill<{ thread: Thread; toRead: string[] }>({
  id: "threads.read",
  format: 3,
  lane: "agent",
  tools: /^(library_add|thread_write)$/,
  writes: ["thread", "paper"],
  instructions: ({ thread, toRead }) => readPrompt(thread, toRead),
})
