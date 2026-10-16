import { isMarkdown, type ActivityEvent, type InitiativeMode, type TaskPriority } from "@owlit/protocol"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { Workspace } from "../workspace/workspace.ts"
import type { Presence } from "./presence.ts"
import { leaningOn } from "./reviews.ts"
import { RECHECK_RUN, REVIEW_RUN, SCAN_RUN, SETTLED_REVIEW_RUN } from "./runs.ts"

// When Owlit does something nobody asked for: every rule is here, and only here. A rule hears events
// (what the user does, what core sees, the clock), looks at the workspace, and decides one thing per
// subject: queue a run (job), do nothing and say why (none), or not now (defer). It never writes
// anything itself; the run it queues does, through core, under core's owner rules. Every decision is
// logged, with or without an action (Initiative), so what Owlit held back can be read and replayed.
//
// The shape follows continuo's agent (events with a cause, subscriptions, debounce keys, no-action as
// a result) without depending on it: see docs/decisions/0008.

// What the rules hear: the user's activity, and what core sees on its own
export type InitiativeEvent =
  | ActivityEvent
  // The user starred a paper (core sees it whether or not activity is recorded)
  | { kind: "paper.starred"; at: number; paperId: string }
  // A paper joined the library one at a time, not by an agent or a batch import: the user added it in
  // the app (user), or another program put it in the library folder (outside: Finder, a sync)
  | { kind: "paper.landed"; at: number; paperId: string; by: "user" | "outside" }
  // The user's reading of a paper reached the whole of it (reading.ts › readInFull), once per paper
  | { kind: "paper.read"; at: number; paperId: string }
  // The workspace has opened and its tasks run
  | { kind: "workspace.opened"; at: number }
  // Once an hour while the workspace is open
  | { kind: "clock.hour"; at: number }
  // A file appeared in the workspace that neither the user nor an agent wrote there in the app (Finder,
  // a sync): workspace-relative path
  | { kind: "docs.appeared"; at: number; path: string }

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

export interface RuleContext {
  ws: Workspace
  now: number
  presence: Presence
  // When this rule last queued a run about this subject, from the journal's evaluations
  lastJob: (subject: string) => Promise<number | null>
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
  when: async (event, { ws }) => {
    const held = await ws.library.digestHeldBack(event.paperId)
    return [held ? { subject: event.paperId, none: held } : job(event.paperId, "paper.digest", "waiting")]
  },
})

// Starring a paper says it is worth reading: a digest gets written in the background
export const digestOnStar = defineRule({
  id: "digest.onStar",
  on: ["paper.starred"],
  needs: "off",
  when: async (event, { ws }) => {
    const held = await ws.library.digestHeldBack(event.paperId)
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
  when: async (event, { ws, now }) =>
    (await ws.threads.watched(now))
      .filter(({ due }) => due || event.kind === "workspace.opened")
      .map(({ id, due }) => (due ? job(id, "threads.check", "background") : { subject: id, none: "checked within a day" })),
})

// Why a doc isn't one to review, or null if it changed since Owlit last looked
async function unreviewable(ws: Workspace, subject: string) {
  if (!isMarkdown(subject)) return "not a Markdown doc"
  const owlit = await ws.docs.owlitOf(subject).catch(() => null)
  if (!owlit) return "not in the workspace"
  if (owlit.out) return "kept out"
  const info = await stat(path.join(ws.root, subject)).catch(() => null)
  if (!info) return "not on disk"
  if (owlit.looked && Math.round(info.mtimeMs) <= owlit.looked.mtime) return "unchanged since Owlit looked"
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
  when: async (event, { ws, now, presence }) => {
    const subject = event.path
    const not = await unreviewable(ws, subject)
    if (not) return [{ subject, none: not }]
    if (presence.writingIn(subject, now)) return [{ subject, defer: "the user is writing in it" }]
    return [job(subject, REVIEW_RUN, "background")]
  },
})

// ---- While the user is away (the night shift). These rules act only while the user is away, and wait
// for that when they are here; what they make lands where the user isn't, and nothing they do notifies.

// The user stopped editing a doc a while ago: once they are away, Owlit reads what changed and leaves its
// comments for when they are back
export const reviewSettled = defineRule({
  id: "docs.reviewSettled",
  on: ["doc.edited"],
  needs: "away",
  key: (event) => event.path,
  // An edit is settled once the doc has had no typing for this long
  settleMs: 10 * 60_000,
  when: async (event, { ws, presence }) => {
    const subject = event.path
    const not = await unreviewable(ws, subject)
    if (not) return [{ subject, none: not }]
    if (!presence.isAway) return [{ subject, defer: presence.openDoc === subject ? "the user is in it" : "waiting for the user to be away", until: "away" }]
    return [job(subject, SETTLED_REVIEW_RUN, "background")]
  },
})

// Not now: the user is here. One deferral about the event's subject, looked at again when they go away
const untilAway = (subject: string): Outcome[] => [{ subject, defer: "waiting for the user to be away", until: "away" }]

// A paper that came into the library one at a time, not by an agent and not in a batch import (the user
// added it, or it arrived from outside the app): its digest, and whether it answers one of the threads'
// questions, ready for when the user is back
export const paperLanded = defineRule({
  id: "paper.landed",
  on: ["paper.landed"],
  needs: "away",
  when: async (event, { ws, presence }) => {
    if (!presence.isAway) return untilAway(event.paperId)
    const held = await ws.library.digestHeldBack(event.paperId)
    const threads = (await ws.threads.list()).filter((c) => c.papers > 0)
    return [
      held ? { subject: event.paperId, none: held } : job(event.paperId, "paper.digest", "background"),
      threads.length ? job(event.paperId, "paper.relate", "background") : { subject: event.paperId, none: "no threads to bring it to" },
    ]
  },
})

// The user read a paper in full: what Owlit wrote leaning on it (a thread's answers from its abstract,
// Owlit's comments that cite it) is looked at again, from the whole text and what the user marked in it
export const paperRead = defineRule({
  id: "paper.readInFull",
  on: ["paper.read"],
  needs: "away",
  when: async (event, { ws, presence }) => {
    if (!presence.isAway) return untilAway(event.paperId)
    const rows = await ws.threads.rowsOf(event.paperId)
    const outcomes: Outcome[] = rows.map(({ thread, fromAbstract }) => {
      const subject = `${thread}:${event.paperId}`
      return fromAbstract ? job(subject, "threads.reread", "background") : { subject, none: "answered from the full text already" }
    })
    for (const [rel, comments] of Object.entries(await ws.docs.commentsAll())) {
      if (!isMarkdown(rel) || (await ws.docs.owlitOf(rel).catch(() => null))?.out) continue
      for (const c of leaningOn(comments, event.paperId)) outcomes.push(job(`${rel}#${c.id}|${event.paperId}`, RECHECK_RUN, "background"))
    }
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
  when: async (event, { now, presence, lastJob }) => {
    const last = await lastJob("workspace")
    if (last !== null && now - last < DAY_MS) return event.kind === "workspace.opened" ? [{ subject: "workspace", none: "looked within a day" }] : []
    if (!presence.isAway) return untilAway("workspace")
    return [job("workspace", SCAN_RUN, "background")]
  },
})

// Meetings: a transcript or reviews that land in a Meetings folder (at the top of the workspace or in a
// project) are gone through, the points carried to where they belong. Waits for the Go through skill
// (its own task); not among RULES until then.
export const MEETINGS = /(^|\/)Meetings\//
export const goThroughMeetings = defineRule({
  id: "meetings.goThrough",
  on: ["docs.appeared"],
  needs: "away",
  when: async (event) => [{ subject: event.path, none: MEETINGS.test(event.path) ? "Go through isn't built yet" : "not in a Meetings folder" }],
})

export const RULES: readonly Rule[] = [digestOnOpen, digestOnStar, checkWatched, reviewOnOpen, reviewSettled, paperLanded, paperRead, dailyScan]
