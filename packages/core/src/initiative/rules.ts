import { isMarkdown, type ActivityEvent, type CoreEvent, type TaskPriority } from "@owlit/protocol"
import type { Workspace } from "../workspace/workspace.ts"
import { leaningOn } from "./reviews.ts"
import { RECHECK_RUN } from "./runs.ts"

// When Owlit does something nobody asked for at that moment: every rule is here, and only here. Owlit
// works on its own only to keep up with the user: it finishes or updates what they already asked for,
// and nothing starts from its own observation. A rule hears events (what the user does, what core sees,
// the clock), looks at the workspace, and decides one thing per subject: queue a run (job), or do nothing
// and say why (none). It never writes anything itself; the run it queues does, through core, under
// core's owner rules. Every decision is logged, with or without an action (Initiative), so what Owlit
// held back can be read and replayed.
//
// The shape follows continuo's agent (events with a cause, subscriptions, no-action as a result) without
// depending on it.

// What the rules hear: the user's activity, and what core sees on its own
export type InitiativeEvent = ActivityEvent | CoreEvent

export type InitiativeKind = InitiativeEvent["kind"]
type EventOf<K extends InitiativeKind> = Extract<InitiativeEvent, { kind: K }>

export interface Job {
  kind: string
  subject: string
  priority: TaskPriority
}

// One decision about one subject
export type Outcome = { subject: string } & ({ job: Job } | { none: string })

// All a rule may look at in the workspace. Each look is journaled with its answer (initiative.ts), so a
// replay answers the same questions the same way after the workspace has moved on; a rule that needs
// something else adds it here.
export interface World {
  // Why no digest would be written for a paper now, or null when one would
  digestHeldBack(paperId: string): Promise<string | null>
  // The threads Owlit watches, and whether a day has passed since each was checked
  watched(): Promise<{ id: string; due: boolean }[]>
  // The threads that have this paper as a row, and whether some of its answers there rest only on its
  // abstract
  rowsOf(paperId: string): Promise<{ thread: string; row?: string; fromAbstract: boolean }[]>
  // Owlit's standing comments that cite this paper, as "<doc path>#<comment id>", in docs Owlit isn't
  // kept out of
  leaning(paperId: string): Promise<string[]>
}

export const worldOf = (ws: Workspace, now: number): World => ({
  digestHeldBack: (paperId) => ws.library.digestHeldBack(paperId),
  watched: () => ws.threads.watched(now),
  rowsOf: (paperId) => ws.threads.rowsOf(paperId),
  leaning: async (paperId) => {
    const out: string[] = []
    for (const [rel, comments] of Object.entries(await ws.docs.commentsAll())) {
      if (!isMarkdown(rel) || (await ws.docs.owlitOf(rel).catch(() => null))?.out) continue
      for (const c of leaningOn(comments, paperId)) out.push(`${rel}#${c.id}`)
    }
    return out
  },
})

export interface RuleContext {
  world: World
  now: number
}

export interface Rule<K extends InitiativeKind = InitiativeKind> {
  id: string
  on: readonly K[]
  // Whether its runs count toward the daily cap (Initiative). A rule that answers one act of the user's
  // with one run isn't capped; one whose runs fan out from a single event is.
  capped: boolean
  when: (event: EventOf<K>, ctx: RuleContext) => Promise<Outcome[]>
}

// Typed by the events it hears while it is written; one list of rules holds them all
export const defineRule = <K extends InitiativeKind>(rule: Rule<K>): Rule => rule as unknown as Rule

const job = (subject: string, kind: string, priority: TaskPriority): Outcome => ({ subject, job: { kind, subject, priority } })

// Starring a paper says it is worth reading: a digest gets written in the background. Opening a paper
// asks for nothing: a digest is asked for from the paper's page or menu, a chat, or an agent.
export const digestOnStar = defineRule({
  id: "digest.onStar",
  on: ["paper.starred"],
  capped: false,
  when: async (event, { world }) => {
    const held = await world.digestHeldBack(event.paperId)
    return [held ? { subject: event.paperId, none: held } : job(event.paperId, "paper.digest", "background")]
  },
})

// Threads the user asked Owlit to watch get a check once a day: looked at when the workspace opens and
// every hour after, so a workspace left open for days still gets its checks
export const checkWatched = defineRule({
  id: "threads.checkWatched",
  on: ["workspace.opened", "clock.hour"],
  capped: false,
  // The hourly look says only what became due, so the log doesn't fill with the same "not yet"
  when: async (event, { world }) =>
    (await world.watched())
      .filter(({ due }) => due || event.kind === "workspace.opened")
      .map(({ id, due }) => (due ? job(id, "threads.check", "background") : { subject: id, none: "checked within a day" })),
})

// The user read a paper in full: Owlit's reading of it never lags behind theirs, so what it wrote leaning
// on the paper (a thread's answers from its abstract, Owlit's comments that cite it) is looked at again,
// from the whole text and what the user marked in it
export const paperRead = defineRule({
  id: "paper.readInFull",
  on: ["paper.read"],
  capped: true,
  when: async (event, { world }) => {
    const outcomes: Outcome[] = (await world.rowsOf(event.paperId)).map(({ thread, row, fromAbstract }) => {
      // The row's own id, which a search gave and may not be the library's; a journal from before rows
      // were named has none
      const subject = `${thread}:${row ?? event.paperId}`
      return fromAbstract ? job(subject, "threads.reread", "background") : { subject, none: "answered from the full text already" }
    })
    for (const comment of await world.leaning(event.paperId)) outcomes.push(job(`${comment}|${event.paperId}`, RECHECK_RUN, "background"))
    return outcomes.length ? outcomes : [{ subject: event.paperId, none: "nothing of Owlit's leans on it" }]
  },
})

export const RULES: readonly Rule[] = [digestOnStar, checkWatched, paperRead]
