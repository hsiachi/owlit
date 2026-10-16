import { isMarkdown, type ActivityEvent, type CoreEvent, type InitiativeMode, type TaskPriority } from "@owlit/protocol"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { Workspace } from "../workspace/workspace.ts"
import type { Presence } from "./presence.ts"
import { leaningOn } from "./reviews.ts"
import { GO_THROUGH_RUN, RECHECK_RUN, REVIEW_RUN, SCAN_RUN, SETTLED_REVIEW_RUN } from "./runs.ts"
import { MATERIAL, MEETINGS, RECORD } from "./go-through.ts"

// When Owlit does something nobody asked for: every rule is here, and only here. A rule hears events
// (what the user does, what core sees, the clock), looks at the workspace, and decides one thing per
// subject: queue a run (job), do nothing and say why (none), or not now (defer). It never writes
// anything itself; the run it queues does, through core, under core's owner rules. Every decision is
// logged, with or without an action (Initiative), so what Owlit held back can be read and replayed.
//
// The shape follows continuo's agent (events with a cause, subscriptions, debounce keys, no-action as
// a result) without depending on it: see docs/decisions/0008.

// What the rules hear: the user's activity, and what core sees on its own
export type InitiativeEvent = ActivityEvent | CoreEvent

export type InitiativeKind = InitiativeEvent["kind"]
type EventOf<K extends InitiativeKind> = Extract<InitiativeEvent, { kind: K }>

export interface Job {
  kind: string
  subject: string
  priority: TaskPriority
}

// One decision about one subject. A deferral is looked at again once the user may have stopped (they
// leave the doc or the window, or pause their typing), or, until "away", only once they are away.
export type Outcome = { subject: string } & ({ job: Job } | { none: string } | { defer: string; until?: "away" })

// All a rule may look at in the workspace. Each look is journaled with its answer (initiative.ts), so a
// replay answers the same questions the same way after the workspace has moved on; a rule that needs
// something else adds it here.
export interface World {
  // Why no digest would be written for a paper now, or null when one would
  digestHeldBack(paperId: string): Promise<string | null>
  // The threads Owlit watches, and whether a day has passed since each was checked
  watched(): Promise<{ id: string; due: boolean }[]>
  // A doc's Owlit state: kept out, and the modification time Owlit last read; null when it isn't one
  // of the workspace's docs
  doc(path: string): Promise<{ out: boolean; looked?: number; wentThrough?: number } | null>
  // When a file was last changed (ms), or null when it isn't on disk
  mtime(path: string): Promise<number | null>
  // How many threads have papers in them
  threads(): Promise<number>
  // The threads that have this paper as a row, and whether some of its answers there rest only on its
  // abstract
  rowsOf(paperId: string): Promise<{ thread: string; fromAbstract: boolean }[]>
  // Owlit's standing comments that cite this paper, as "<doc path>#<comment id>", in docs Owlit isn't
  // kept out of
  leaning(paperId: string): Promise<string[]>
  // When Owlit last looked over the docs (the daily look), or null when it never has
  lastScan(): Promise<number | null>
}

export const worldOf = (ws: Workspace, now: number): World => ({
  digestHeldBack: (paperId) => ws.library.digestHeldBack(paperId),
  watched: () => ws.threads.watched(now),
  doc: async (rel) => {
    const owlit = await ws.docs.owlitOf(rel).catch(() => null)
    return owlit ? { out: !!owlit.out, ...(owlit.looked ? { looked: owlit.looked.mtime } : {}), ...(owlit.wentThrough ? { wentThrough: owlit.wentThrough.at } : {}) } : null
  },
  mtime: async (rel) => {
    const info = await stat(path.join(ws.root, rel)).catch(() => null)
    return info ? Math.round(info.mtimeMs) : null
  },
  threads: async () => (await ws.threads.list()).filter((c) => c.papers > 0).length,
  rowsOf: (paperId) => ws.threads.rowsOf(paperId),
  leaning: async (paperId) => {
    const out: string[] = []
    for (const [rel, comments] of Object.entries(await ws.docs.commentsAll())) {
      if (!isMarkdown(rel) || (await ws.docs.owlitOf(rel).catch(() => null))?.out) continue
      for (const c of leaningOn(comments, paperId)) out.push(`${rel}#${c.id}`)
    }
    return out
  },
  lastScan: () => ws.docs.scannedAt(),
})

export interface RuleContext {
  world: World
  now: number
  presence: Presence
}

export interface Rule<K extends InitiativeKind = InitiativeKind> {
  id: string
  on: readonly K[]
  // The lowest position of the dial it runs at. "off": upkeep of what Owlit already keeps (digests,
  // watched threads), which runs at every position; "onOpen", "away": initiative, which the user turns on
  needs: InitiativeMode
  // Events about the same key within settleMs make one evaluation, after the last of them
  key?: (event: EventOf<K>) => string
  settleMs?: number
  when: (event: EventOf<K>, ctx: RuleContext) => Promise<Outcome[]>
}

// Typed by the events it hears while it is written; one list of rules holds them all
export const defineRule = <K extends InitiativeKind>(rule: Rule<K>): Rule => rule as unknown as Rule

const job = (subject: string, kind: string, priority: TaskPriority): Outcome => ({ subject, job: { kind, subject, priority } })

// Opening a paper's page says the user is about to read it: its digest comes first, ahead of everything
export const digestOnOpen = defineRule({
  id: "digest.onOpen",
  on: ["paper.opened"],
  needs: "off",
  when: async (event, { world }) => {
    const held = await world.digestHeldBack(event.paperId)
    return [held ? { subject: event.paperId, none: held } : job(event.paperId, "paper.digest", "waiting")]
  },
})

// Starring a paper says it is worth reading: a digest gets written in the background
export const digestOnStar = defineRule({
  id: "digest.onStar",
  on: ["paper.starred"],
  needs: "off",
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
  needs: "off",
  // The hourly look says only what became due, so the log doesn't fill with the same "not yet"
  when: async (event, { world }) =>
    (await world.watched())
      .filter(({ due }) => due || event.kind === "workspace.opened")
      .map(({ id, due }) => (due ? job(id, "threads.check", "background") : { subject: id, none: "checked within a day" })),
})

// Why a doc isn't one to review, or null if it changed since Owlit last looked
async function unreviewable(world: World, subject: string) {
  if (!isMarkdown(subject)) return "not a Markdown doc"
  const owlit = await world.doc(subject)
  if (!owlit) return "not in the workspace"
  if (owlit.out) return "kept out"
  const mtime = await world.mtime(subject)
  if (mtime === null) return "not on disk"
  if (owlit.looked !== undefined && mtime <= owlit.looked) return "unchanged since Owlit looked"
  return null
}

// A doc the user opens that changed since Owlit last looked at it: Owlit reads the changed paragraphs in
// the background and comments where it has something to say. Never while the user is writing in it.
export const reviewOnOpen = defineRule({
  id: "docs.reviewOnOpen",
  on: ["doc.opened"],
  needs: "onOpen",
  key: (event) => event.path,
  // Flicking through docs isn't opening one to read
  settleMs: 3000,
  when: async (event, { world, now, presence }) => {
    const subject = event.path
    const not = await unreviewable(world, subject)
    if (not) return [{ subject, none: not }]
    if (presence.writingIn(subject, now)) return [{ subject, defer: "the user is writing in it" }]
    return [job(subject, REVIEW_RUN, "background")]
  },
})

// ---- While the user is away (the night shift). These rules act only while the user is away, and wait
// for that when they are here; what they make lands where the user isn't, and nothing they do notifies.

// Not now: the user is here. One deferral about the event's subject, looked at again when they go away
const untilAway = (subject: string): Outcome[] => [{ subject, defer: "waiting for the user to be away", until: "away" }]

// The user stopped editing a doc a while ago: once they are away, Owlit reads what changed and leaves its
// comments for when they are back
export const reviewSettled = defineRule({
  id: "docs.reviewSettled",
  on: ["doc.edited"],
  needs: "away",
  key: (event) => event.path,
  // An edit is settled once the doc has had no typing for this long
  settleMs: 10 * 60_000,
  when: async (event, { world, presence }) => {
    const subject = event.path
    const not = await unreviewable(world, subject)
    if (not) return [{ subject, none: not }]
    if (!presence.isAway) return [{ subject, defer: presence.openDoc === subject ? "the user is in it" : "waiting for the user to be away", until: "away" }]
    return [job(subject, SETTLED_REVIEW_RUN, "background")]
  },
})

// A paper that came into the library one at a time, not by an agent and not in a batch import (the user
// added it, or it arrived from outside the app): its digest, and whether it answers one of the threads'
// questions, ready for when the user is back
export const paperLanded = defineRule({
  id: "paper.landed",
  on: ["paper.landed"],
  needs: "away",
  when: async (event, { world, presence }) => {
    if (!presence.isAway) return untilAway(event.paperId)
    const held = await world.digestHeldBack(event.paperId)
    return [
      held ? { subject: event.paperId, none: held } : job(event.paperId, "paper.digest", "background"),
      (await world.threads()) ? job(event.paperId, "paper.relate", "background") : { subject: event.paperId, none: "no threads to bring it to" },
    ]
  },
})

// The user read a paper in full: what Owlit wrote leaning on it (a thread's answers from its abstract,
// Owlit's comments that cite it) is looked at again, from the whole text and what the user marked in it
export const paperRead = defineRule({
  id: "paper.readInFull",
  on: ["paper.read"],
  needs: "away",
  when: async (event, { world, presence }) => {
    if (!presence.isAway) return untilAway(event.paperId)
    const outcomes: Outcome[] = (await world.rowsOf(event.paperId)).map(({ thread, fromAbstract }) => {
      const subject = `${thread}:${event.paperId}`
      return fromAbstract ? job(subject, "threads.reread", "background") : { subject, none: "answered from the full text already" }
    })
    for (const comment of await world.leaning(event.paperId)) outcomes.push(job(`${comment}|${event.paperId}`, RECHECK_RUN, "background"))
    return outcomes.length ? outcomes : [{ subject: event.paperId, none: "nothing of Owlit's leans on it" }]
  },
})

const DAY_MS = 24 * 3_600_000

// Once a day, while the user is away: a look over the docs for sections left half done for a week and
// Owlit's comments left behind (reviews.ts › scan)
export const dailyScan = defineRule({
  id: "docs.dailyScan",
  on: ["workspace.opened", "clock.hour"],
  needs: "away",
  when: async (event, { world, now, presence }) => {
    const last = await world.lastScan()
    // The hourly look says only what became due
    if (last !== null && now - last < DAY_MS) return event.kind === "workspace.opened" ? [{ subject: "workspace", none: "looked within a day" }] : []
    if (!presence.isAway) return untilAway("workspace")
    return [job("workspace", SCAN_RUN, "background")]
  },
})

// Meetings: a transcript, minutes or reviews that appear in a Meetings folder (at the top of the workspace
// or in a project), put there by the user or another program, are gone through against the docs while
// the user is away: a record beside them, the points carried to where they belong (go-through.ts).
// Anywhere else, and at any position of the dial, the user asks for it from the doc's menu.
export const goThroughMeetings = defineRule({
  id: "meetings.goThrough",
  on: ["docs.appeared"],
  needs: "away",
  when: async (event, { world, presence }) => {
    const subject = event.path
    if (!MEETINGS.test(subject)) return [{ subject, none: "not in a Meetings folder" }]
    if (!MATERIAL.test(subject)) return [{ subject, none: "not text" }]
    if (RECORD.test(subject)) return [{ subject, none: "a record of Owlit's" }]
    const doc = await world.doc(subject)
    if (!doc) return [{ subject, none: "not in the workspace" }]
    if (doc.wentThrough) return [{ subject, none: "gone through already" }]
    if (!presence.isAway) return untilAway(subject)
    return [job(subject, GO_THROUGH_RUN, "background")]
  },
})

export const RULES: readonly Rule[] = [digestOnOpen, digestOnStar, checkWatched, reviewOnOpen, reviewSettled, paperLanded, paperRead, dailyScan, goThroughMeetings]
