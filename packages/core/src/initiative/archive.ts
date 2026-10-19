import { CORE_KINDS, JOURNALED_CORE_KINDS, type ArchiveSummary, type JournalEntry, type Task } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { readJsonl, writeJsonAtomic } from "../fs-util.ts"

// Everything Owlit did on its own in a workspace, as one archive: what it heard (the journal's activity
// and what core saw), what each rule looked at and decided, what the user did with its work, and its
// runs (the tasks its rules queued, from the tasks log). It is a continuo session archive (version 1,
// events only) whose lines hold continuo's event envelopes, so continuo's tools read and replay it as
// they do their own (envelopeOf says how owlit's events map onto continuo's); replay.ts reads it back
// and feeds it through the rules.
//
//   <to>/manifest.json       continuo's manifest; what is owlit's is under safeConfig.owlit
//   <to>/events.jsonl        { archiveSequence, recordedAt, event }, event a continuo EventEnvelope
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
  // continuo's classes: what a person did, what was noticed (about them, or by core), Owlit's own
  // bookkeeping
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
  // Activity recording (Settings): off, nothing is exported
  recording: boolean
  version: string
  now: number
}

const UNJOURNALED = new Set<string>(CORE_KINDS.filter((k) => !(JOURNALED_CORE_KINDS as readonly string[]).includes(k)))
const OBSERVATIONS = new Set<string>(["paper.focus", "paper.dwell", "idle", ...CORE_KINDS])
const INTERNAL = new Set<string>(["evaluation", "rule.looked", "agent.wrote"])
const classOf = (type: string): ArchiveEvent["class"] => (type.startsWith("run.") || INTERNAL.has(type) ? "internal" : OBSERVATIONS.has(type) ? "observation" : "interaction")

export const workspaceHash = (root: string) => createHash("sha256").update(`owlit-archive\u0000${root}`).digest("hex").slice(0, 16)

type Draft = Pick<ArchiveEvent, "at" | "type" | "actor" | "payload">

export async function exportArchive(o: ExportOptions): Promise<ArchiveSummary> {
  const to = path.resolve(o.to)
  const inside = path.relative(o.root, to)
  if (!inside.startsWith("..") && !path.isAbsolute(inside)) throw new Error("The archive goes in a folder outside the workspace.")
  if ((await readdir(to).catch(() => []))?.length) throw new Error(`${to} isn't empty; the archive needs a new folder.`)

  const workspace = workspaceHash(o.root)
  const write = async (events: ArchiveEvent[], config: Pick<OwlitArchiveConfig, "from" | "until" | "note">): Promise<ArchiveSummary> => {
    const sessionId = `owlit-${workspace}-${config.from ?? o.now}`
    const envelopes = toEnvelopes(events, sessionId)
    await mkdir(path.join(to, "audio"), { recursive: true })
    await writeFile(path.join(to, "events.jsonl"), envelopes.map((event) => JSON.stringify({ archiveSequence: event.sequence, recordedAt: event.recordedAt, event }) + "\n").join(""))
    await writeFile(path.join(to, "observations.jsonl"), "")
    const manifest: ArchiveManifest = {
      schema: "continuo.session-archive",
      version: 1,
      sessionId,
      application: { name: "owlit", version: o.version },
      safeConfig: { owlit: { format: ARCHIVE_FORMAT, workspace, recording: o.recording, ...config } },
      status: "completed",
      startedAt: iso(config.from ?? o.now),
      updatedAt: iso(o.now),
      endedAt: iso(config.until ?? o.now),
      durableWatermark: envelopes.length,
    }
    await writeJsonAtomic(path.join(to, "manifest.json"), manifest)
    return { to, events: envelopes.length, ...(config.from !== undefined ? { from: config.from, until: config.until } : {}), ...(config.note ? { note: config.note } : {}) }
  }

  // Recording is off: what the user did isn't Owlit's to hand out, and its decisions make no sense
  // without it
  if (!o.recording) return write([], { note: "Activity recording is off, so there is nothing to export." })

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
    // Older journals have no causeAt and name only the kind: the last one heard is the one
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

  if (!events.length) return write([], { note: "Nothing was recorded in this time." })
  const from = o.since ?? events.reduce((first, e) => Math.min(first, e.at), Infinity)
  return write(events, { from, until: events.reduce((last, e) => Math.max(last, e.at), 0) })
}

// continuo's event envelope (@continuo/protocol's EventEnvelope), as much of it as an archive writes.
// owlit's own event (its kind, actor and, where continuo's payload says it differently, payload) rides
// in extensions.owlit, so readArchive gets back exactly what was exported.
export interface Envelope {
  schemaVersion: 1
  id: string
  sessionId: string
  sequence: number
  recordedAt: string
  occurredAt: string
  class: ArchiveEvent["class"]
  source: { kind: "adapter" | "agent" | "runtime"; id: string }
  type: string
  payload: Record<string, unknown>
  causationId?: string
  taskId?: string
  extensions?: { owlit: { kind: string; actor: ArchiveEvent["actor"]; payload?: Record<string, unknown> } }
}

const iso = (ms: number) => new Date(ms).toISOString()
const RUN_TO_JOB: Record<string, string> = { "run.queued": "job.queued", "run.running": "job.started", "run.waiting": "job.waiting", "run.done": "job.done", "run.failed": "job.failed", "run.cancelled": "job.cancelled" }
const DECISION_KIND = { job: "work", none: "no-action", defer: "defer" } as const

// owlit's events as continuo's envelopes. What came from outside the rules is an adapter's input, the
// thing continuo replays: the user's activity and their reactions to Owlit's work (source "owlit"), and
// what core saw (source "owlit-core"). Each time a rule takes up an event is one of continuo's
// evaluation tasks: a task.started caused by that event, the rule's look at the workspace, and one
// evaluation.decided per subject it decided on, all with the task's id. A run the rules queued is
// continuo's delegated job, its states job.*. Names continuo reserves are renamed: idle is app.idle (as
// in continuo's own tests), agent.wrote is owlit.wrote.
export function toEnvelopes(events: ArchiveEvent[], sessionId: string): Envelope[] {
  const out: Envelope[] = []
  const idOf = new Map<number, string>()
  const taskOfRun = new Map<string, string>()
  let tasks = 0
  // The evaluation task now open, and the take it belongs to (rule, heard event)
  let open: { key: string; taskId: string } | undefined
  const push = (e: Omit<Envelope, "schemaVersion" | "id" | "sessionId" | "sequence">) => {
    const sequence = out.length + 1
    const envelope = { schemaVersion: 1 as const, id: `e${sequence}`, sessionId, sequence, ...e }
    out.push(envelope)
    return envelope
  }

  for (const e of events) {
    const p = e.payload as Record<string, unknown> & { rule?: string; cause?: string; causeAt?: number; taskId?: string; subject?: string; detail?: Record<string, unknown> }
    const at = iso(e.at)
    const causationId = e.cause !== undefined ? idOf.get(e.cause) : undefined
    const base = { recordedAt: at, occurredAt: at, class: e.class, ...(causationId ? { causationId } : {}) }
    const owlit = (payload?: Record<string, unknown>) => ({ extensions: { owlit: { kind: e.type, actor: e.actor, ...(payload ? { payload } : {}) } } })
    let envelope: Envelope
    if (!e.type.startsWith("run.") && e.type !== "evaluation" && e.type !== "rule.looked") open = undefined

    if (e.type === "evaluation" || e.type === "rule.looked") {
      const key = `${p.rule}\u0000${p.cause}\u0000${p.causeAt}`
      // A look starts a take; decisions join the take they follow (with only its runs' states between),
      // and one that heard nothing (a comment held back as it came to land) is a take of its own
      if (e.type === "rule.looked" || p.causeAt === undefined || open?.key !== key) {
        // owlit's rules keep no state of their own, so there are no revisions to name
        const started = push({ ...base, class: "internal", source: { kind: "runtime", id: "owlit-rules" }, type: "task.started", taskId: `eval-${++tasks}`, payload: { scope: "background", stateRevision: 0, configRevision: 0 } })
        open = { key, taskId: started.taskId! }
      }
      if (e.type === "rule.looked") envelope = push({ ...base, source: { kind: "agent", id: "owlit-rules" }, type: "rule.looked", taskId: open.taskId, payload: e.payload, ...owlit() })
      else {
        if (p.taskId) taskOfRun.set(p.taskId, open.taskId)
        const decision = p.decision as keyof typeof DECISION_KIND
        const payload = { kind: DECISION_KIND[decision], reason: (p.reason as string | undefined) ?? "queued a run", workIds: p.taskId ? [p.taskId] : [], subject: { rule: p.rule!, subject: p.subject! } }
        envelope = push({ ...base, source: { kind: "agent", id: "owlit-rules" }, type: "evaluation.decided", taskId: open.taskId, payload, ...owlit(e.payload) })
      }
    } else if (e.type.startsWith("run.")) {
      const jobId = p.taskId as string
      const payload =
        e.type === "run.waiting" ? { jobId, reason: (p.waiting as string | undefined) ?? "", detail: "" }
        : e.type === "run.done" ? { jobId, result: null }
        : e.type === "run.failed" || e.type === "run.cancelled" ? { jobId, reason: (p.error as string | undefined) ?? "" }
        : { jobId }
      const taskId = taskOfRun.get(jobId)
      envelope = push({ ...base, source: { kind: "runtime", id: "owlit-tasks" }, type: RUN_TO_JOB[e.type] ?? "job.progress", ...(taskId ? { taskId } : {}), payload, ...owlit(e.payload) })
    } else if (e.type === "agent.wrote") {
      envelope = push({ ...base, source: { kind: "agent", id: "owlit" }, type: "owlit.wrote", payload: e.payload, ...owlit() })
    } else if (e.type.startsWith("feedback.")) {
      envelope = push({ ...base, source: { kind: "adapter", id: "owlit" }, type: e.type, payload: { ...(p.subject ? { targetId: p.subject } : {}), ...(p.detail ? { detail: p.detail } : {}) }, ...owlit(e.payload) })
    } else {
      const core = (CORE_KINDS as readonly string[]).includes(e.type)
      envelope = push({ ...base, source: { kind: "adapter", id: core ? "owlit-core" : "owlit" }, type: e.type === "idle" ? "app.idle" : e.type, payload: e.payload, ...owlit() })
    }
    idOf.set(e.seq, envelope.id)
  }
  return out
}

export async function readArchive(dir: string): Promise<{ manifest: ArchiveManifest; events: ArchiveEvent[] }> {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as ArchiveManifest
  if (manifest.schema !== "continuo.session-archive" || manifest.safeConfig?.owlit?.format !== ARCHIVE_FORMAT) throw new Error(`${dir} isn't an owlit archive.`)
  const lines = await readJsonl<{ archiveSequence: number; event: Envelope }>(path.join(dir, "events.jsonl"))
  // owlit's events back, numbered again from 1 (the evaluation tasks are continuo's view of them)
  const seqOf = new Map<string, number>()
  const events: ArchiveEvent[] = []
  for (const { event: env } of lines) {
    const own = env.extensions?.owlit
    if (!own) continue
    const seq = events.length + 1
    seqOf.set(env.id, seq)
    const cause = env.causationId !== undefined ? seqOf.get(env.causationId) : undefined
    events.push({ seq, at: Date.parse(env.occurredAt), type: own.kind, actor: own.actor, class: env.class, ...(cause !== undefined ? { cause } : {}), payload: own.payload ?? env.payload })
  }
  return { manifest, events }
}
