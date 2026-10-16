import { CORE_KINDS, JOURNALED_CORE_KINDS, type ArchiveSummary, type InitiativeSettings, type JournalEntry, type Task } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { readJsonl, writeJsonAtomic } from "../fs-util.ts"

// Everything Owlit did on its own in a workspace, as one archive: what it heard (the journal's activity
// and what core saw), what each rule looked at and decided, what the user did with its work, and its
// runs (the tasks its rules queued, from the tasks log). It is a continuo session archive (version 1,
// events only), so continuo's tools read it as they read their own; replay.ts feeds it back through the
// rules.
//
//   <to>/manifest.json       continuo's manifest; what is owlit's is under safeConfig.owlit
//   <to>/events.jsonl        { archiveSequence, recordedAt, event }, event an ArchiveEvent
//   <to>/observations.jsonl  empty (continuo keeps media there)
//   <to>/audio/              empty

export const ARCHIVE_FORMAT = 1

export interface ArchiveEvent {
  // From 1 with no gaps, the same as the line's archiveSequence
  seq: number
  // ms since the epoch
  at: number
  // A journal line's kind ("doc.opened", "evaluation", "rule.looked", "feedback.dismiss", "clock.hour"),
  // or run.<state> for a run's task changing state (run.queued, run.running, run.waiting, run.done, …)
  type: string
  actor: "user" | "agent" | "owlit"
  // continuo's classes: what a person did, what was noticed about them, Owlit's own bookkeeping
  class: "interaction" | "observation" | "internal"
  // The seq of the event this one follows from: an evaluation's (and its rule.looked's) heard event, a
  // run's evaluation or its previous state, an agent's write's run, feedback's run on the same subject
  cause?: number
  // The journal line without kind, at and actor (an evaluation's own cause is the kind of the event it
  // heard and causeAt that event's time), or a run's task: taskId, kind, subject, chatId, doing, error,
  // waiting
  payload: Record<string, unknown>
}

export interface OwlitArchiveConfig {
  format: typeof ARCHIVE_FORMAT
  // A hash of the workspace's path, never the path
  workspace: string
  from?: number
  until?: number
  // The dial when the archive starts, and the daily cap: a replay starts from them
  initiative: InitiativeSettings
  recording: boolean
  note?: string
}

export interface ArchiveManifest {
  schema: "continuo.session-archive"
  version: 1
  sessionId: string
  application: { name: "owlit"; version: string }
  safeConfig: { owlit: OwlitArchiveConfig }
  status: "completed"
  startedAt: string
  updatedAt: string
  endedAt: string
  durableWatermark: number
}

export interface ExportOptions {
  root: string
  // .owlit/journal.jsonl, and tasks/log.jsonl in the workspace's data folder
  journal: string
  tasksLog: string
  to: string
  since?: number
  settings: InitiativeSettings
  // Activity recording (Settings): off, nothing is exported
  recording: boolean
  version: string
  now: number
}

const UNJOURNALED = new Set<string>(CORE_KINDS.filter((k) => !(JOURNALED_CORE_KINDS as readonly string[]).includes(k)))
const OBSERVATIONS = new Set(["paper.focus", "paper.dwell", "idle"])
const INTERNAL = new Set<string>(["evaluation", "rule.looked", "agent.wrote", ...CORE_KINDS])
const classOf = (type: string): ArchiveEvent["class"] => (type.startsWith("run.") || INTERNAL.has(type) ? "internal" : OBSERVATIONS.has(type) ? "observation" : "interaction")

export const workspaceHash = (root: string) => createHash("sha256").update(`owlit-archive\u0000${root}`).digest("hex").slice(0, 16)

type Draft = Pick<ArchiveEvent, "at" | "type" | "actor" | "payload">

export async function exportArchive(o: ExportOptions): Promise<ArchiveSummary> {
  const to = path.resolve(o.to)
  const inside = path.relative(o.root, to)
  if (!inside.startsWith("..") && !path.isAbsolute(inside)) throw new Error("The archive goes in a folder outside the workspace.")
  if ((await readdir(to).catch(() => []))?.length) throw new Error(`${to} isn't empty; the archive needs a new folder.`)

  const workspace = workspaceHash(o.root)
  const iso = (ms: number) => new Date(ms).toISOString()
  const write = async (events: ArchiveEvent[], config: Pick<OwlitArchiveConfig, "initiative" | "from" | "until" | "note">): Promise<ArchiveSummary> => {
    await mkdir(path.join(to, "audio"), { recursive: true })
    await writeFile(path.join(to, "events.jsonl"), events.map((event) => JSON.stringify({ archiveSequence: event.seq, recordedAt: iso(event.at), event }) + "\n").join(""))
    await writeFile(path.join(to, "observations.jsonl"), "")
    const manifest: ArchiveManifest = {
      schema: "continuo.session-archive",
      version: 1,
      sessionId: `owlit-${workspace}-${config.from ?? o.now}`,
      application: { name: "owlit", version: o.version },
      safeConfig: { owlit: { format: ARCHIVE_FORMAT, workspace, recording: o.recording, ...config } },
      status: "completed",
      startedAt: iso(config.from ?? o.now),
      updatedAt: iso(o.now),
      endedAt: iso(config.until ?? o.now),
      durableWatermark: events.length,
    }
    await writeJsonAtomic(path.join(to, "manifest.json"), manifest)
    return { to, events: events.length, ...(config.from !== undefined ? { from: config.from, until: config.until } : {}), ...(config.note ? { note: config.note } : {}) }
  }

  // Recording is off: what the user did isn't Owlit's to hand out, and its decisions make no sense
  // without it
  if (!o.recording) return write([], { initiative: o.settings, note: "Activity recording is off, so there is nothing to export." })

  const since = o.since ?? 0
  const journal = (await readJsonl<JournalEntry>(o.journal).catch(() => [])).filter((e) => typeof e?.at === "number")
  const queued = new Set(journal.flatMap((e) => (e.kind === "evaluation" && e.taskId ? [e.taskId] : [])))
  const lines = (await readJsonl<{ at: number; task: Task }>(o.tasksLog).catch(() => [])).filter((l) => l?.task && queued.has(l.task.id))

  // A run's states, one event per change (progress within a state is the run's own business)
  const runs: Draft[] = []
  const state = new Map<string, string>()
  const taskOfChat = new Map<string, string>()
  for (const { at, task } of lines) {
    if (task.chatId) taskOfChat.set(task.chatId, task.id)
    if (state.get(task.id) === task.state) continue
    state.set(task.id, task.state)
    if (at < since) continue
    const { id: taskId, kind, subject, chatId, doing, error, waiting } = task
    const payload = { taskId, kind, subject, ...(chatId ? { chatId } : {}), ...(doing ? { doing } : {}), ...(error ? { error } : {}), ...(waiting ? { waiting: waiting.reason } : {}) }
    runs.push({ at, type: `run.${task.state === "waiting_for_you" ? "waiting" : task.state}`, actor: "owlit", payload })
  }

  // The opening and the hourly tick aren't journaled (they carry nothing): they go in just before the
  // first decision that heard them
  const heard: Draft[] = []
  const seen = new Set<string>()
  for (const { kind, at, actor, ...payload } of journal) {
    if (at < since) continue
    const p = payload as { cause?: string; causeAt?: number }
    if ((kind === "evaluation" || kind === "rule.looked") && p.causeAt !== undefined && UNJOURNALED.has(p.cause!) && !seen.has(`${p.cause}\u0000${p.causeAt}`)) {
      seen.add(`${p.cause}\u0000${p.causeAt}`)
      heard.push({ at: p.causeAt, type: p.cause!, actor: "owlit", payload: {} })
    }
    heard.push({ at, type: kind, actor, payload })
  }

  // In the journal's order (the order the rules heard things in), runs merged in by time
  const drafts: Draft[] = []
  for (let i = 0, j = 0; i < heard.length || j < runs.length; ) {
    if (j < runs.length && (i >= heard.length || runs[j].at < heard[i].at)) drafts.push(runs[j++])
    else drafts.push(heard[i++])
  }

  const heardAt = new Map<string, number>()
  const lastHeard = new Map<string, number>()
  const evaluationOf = new Map<string, number>()
  const lastRun = new Map<string, number>()
  const doneOn = new Map<string, number>()
  const events = drafts.map((d, i): ArchiveEvent => {
    const seq = i + 1
    const p = d.payload as Record<string, string | number | undefined>
    let cause: number | undefined
    // Journals from before causeAt (2026-10-16) name only the kind: the last one heard is the one
    if (d.type === "evaluation" || d.type === "rule.looked") cause = p.causeAt !== undefined ? heardAt.get(`${p.cause}\u0000${p.causeAt}`) : lastHeard.get(p.cause as string)
    else if (d.type.startsWith("run.")) cause = lastRun.get(p.taskId as string) ?? evaluationOf.get(p.taskId as string)
    else if (d.type === "agent.wrote") cause = p.chatId ? lastRun.get(taskOfChat.get(p.chatId as string) ?? "") : undefined
    else if (d.type.startsWith("feedback.")) cause = doneOn.get(p.subject as string)
    else {
      heardAt.set(`${d.type}\u0000${d.at}`, seq)
      lastHeard.set(d.type, seq)
    }
    if (d.type === "evaluation" && p.taskId) evaluationOf.set(p.taskId as string, seq)
    if (d.type.startsWith("run.")) lastRun.set(p.taskId as string, seq)
    if (d.type === "run.done") doneOn.set(p.subject as string, seq)
    return { seq, at: d.at, type: d.type, actor: d.actor, class: classOf(d.type), ...(cause !== undefined ? { cause } : {}), payload: d.payload }
  })

  // The dial as it was when the archive starts: what its first move moved from, else as it is now
  const firstMove = events.find((e) => e.type === "feedback.dialChanged")?.payload.detail as { from?: InitiativeSettings["mode"] } | undefined
  const initiative = { ...o.settings, mode: firstMove?.from ?? o.settings.mode }
  if (!events.length) return write([], { initiative, note: "Nothing was recorded in this time." })
  const from = o.since ?? events.reduce((first, e) => Math.min(first, e.at), Infinity)
  return write(events, { initiative, from, until: events.reduce((last, e) => Math.max(last, e.at), 0) })
}

export async function readArchive(dir: string): Promise<{ manifest: ArchiveManifest; events: ArchiveEvent[] }> {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as ArchiveManifest
  if (manifest.schema !== "continuo.session-archive" || manifest.safeConfig?.owlit?.format !== ARCHIVE_FORMAT) throw new Error(`${dir} isn't an owlit archive.`)
  const lines = await readJsonl<{ archiveSequence: number; event: ArchiveEvent }>(path.join(dir, "events.jsonl"))
  return { manifest, events: lines.map((l) => l.event) }
}
