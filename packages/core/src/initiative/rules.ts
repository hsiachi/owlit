import { isMarkdown, type ActivityEvent, type InitiativeMode, type TaskPriority } from "@owlit/protocol"
import { stat } from "node:fs/promises"
import path from "node:path"
import type { Workspace } from "../workspace/workspace.ts"
import type { Presence } from "./presence.ts"

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
  // The workspace has opened and its tasks run
  | { kind: "workspace.opened"; at: number }
  // Once an hour while the workspace is open
  | { kind: "clock.hour"; at: number }

export type InitiativeKind = InitiativeEvent["kind"]
type EventOf<K extends InitiativeKind> = Extract<InitiativeEvent, { kind: K }>

export interface Job {
  kind: string
  subject: string
  priority: TaskPriority
}

// One decision about one subject
export type Outcome = { subject: string } & ({ job: Job } | { none: string } | { defer: string })

export interface RuleContext {
  ws: Workspace
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
    if (!isMarkdown(subject)) return [{ subject, none: "not a Markdown doc" }]
    const owlit = await ws.docs.owlitOf(subject).catch(() => null)
    if (!owlit) return [{ subject, none: "not in the workspace" }]
    if (owlit.out) return [{ subject, none: "kept out" }]
    const info = await stat(path.join(ws.root, subject)).catch(() => null)
    if (!info) return [{ subject, none: "not on disk" }]
    if (owlit.looked && Math.round(info.mtimeMs) <= owlit.looked.mtime) return [{ subject, none: "unchanged since Owlit looked" }]
    if (presence.writingIn(subject, now)) return [{ subject, defer: "the user is writing in it" }]
    return [job(subject, "docs.review", "background")]
  },
})

export const RULES: readonly Rule[] = [digestOnOpen, digestOnStar, checkWatched, reviewOnOpen]
