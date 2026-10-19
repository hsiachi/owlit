import type { TaskLane, Thread, ThreadColumn } from "@owlit/protocol"
import { DIGEST_FORMAT, digestPrompt } from "../library/digest/prompt.ts"
import { checkPrompt, fillPrompt, gatherPrompt, morePrompt, readPrompt, rereadPrompt, type GatherSize } from "../threads/prompts.ts"

// Every kind of work Owlit does in a background session has one shape: what it is told (instructions,
// with a format version so a change of wording is visible in what it wrote), the owlit tools it may use
// besides the read-only ones, what it may change through core, and the lane it runs in. A task runs a
// skill; a rule (rules.ts) queues the task, or the user asks for it, and it is the same session either way.
// The owner rules for what it writes are core's, not the skill's: a skill only narrows the tools.

// What a run may change, always through core and signed as Owlit's
// record: a new doc of Owlit's own beside the material it went through (Go through)
export type SkillWrite = "digest" | "thread" | "paper" | "comment" | "record"

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

type DigestInput = Parameters<typeof digestPrompt>[0]

// The digest of a paper: its answer is the note, which core writes
export const digestSkill = defineSkill<DigestInput>({ id: "paper.digest", format: DIGEST_FORMAT, lane: "agent", writes: ["digest"], instructions: digestPrompt })

// Thread work: everything it does goes through thread_write, so the thread shows it with Owlit's dots
const SEARCH = /^(library_(search|related|journal)|thread_write)$/
export const gatherSkill = defineSkill<{ thread: Thread; size: GatherSize }>({
  id: "threads.gather",
  format: 1,
  lane: "agent",
  tools: SEARCH,
  writes: ["thread"],
  instructions: ({ thread, size }) => gatherPrompt(thread, size),
})
export const moreSkill = defineSkill<{ thread: Thread }>({ id: "threads.more", format: 1, lane: "agent", tools: SEARCH, writes: ["thread"], instructions: ({ thread }) => morePrompt(thread) })
export const fillSkill = defineSkill<{ thread: Thread; column: ThreadColumn }>({
  id: "threads.fill",
  format: 1,
  lane: "agent",
  tools: /^thread_write$/,
  writes: ["thread"],
  instructions: ({ thread, column }) => fillPrompt(thread, column),
})
// Reading in full means the paper is used: it joins the library
export const readSkill = defineSkill<{ thread: Thread }>({
  id: "threads.read",
  format: 1,
  lane: "agent",
  tools: /^(library_add|thread_write)$/,
  writes: ["thread", "paper"],
  instructions: ({ thread }) => readPrompt(thread),
})
export const checkSkill = defineSkill<{ thread: Thread; since: number }>({
  id: "threads.check",
  format: 1,
  lane: "agent",
  tools: SEARCH,
  writes: ["thread"],
  instructions: ({ thread, since }) => checkPrompt(thread, since),
})

// The user read one of a thread's papers in full: its row is answered again from the whole text
export const rereadSkill = defineSkill<{ thread: Thread; paperId: string }>({
  id: "threads.reread",
  format: 1,
  lane: "agent",
  tools: /^thread_write$/,
  writes: ["thread"],
  instructions: ({ thread, paperId }) => rereadPrompt(thread, paperId),
})
