import type { ActivityEvent, Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ActivityBus } from "../activity/bus.ts"
import { Journal } from "../activity/journal.ts"
import { appendJsonl } from "../fs-util.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { exportArchive, readArchive, type ArchiveEvent, type Envelope } from "./archive.ts"
import { Initiative } from "./initiative.ts"
import { differences, ManualClock, replay } from "./replay.ts"
import { defineRule, paperRead, RULES, type World } from "./rules.ts"
import { ME, MY_OWLIT } from "../test-util.ts"

const T0 = Date.parse("2026-10-16T09:00:00Z")
const MIN = 60_000

// A workspace session wired as core wires it (the bus feeds the journal and the rules; the rules' looks,
// decisions and stars go to the journal), on a manual clock, with a workspace that changes as Owlit's
// runs finish: a digest gets written, a thread's row gets answered again
async function session() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-replay-test-")))
  const root = path.join(base, "ws")
  mkdirSync(path.join(root, ".owlit"), { recursive: true })
  const journalFile = path.join(root, ".owlit", "journal.jsonl")
  const tasksLog = path.join(base, "data", "tasks", "log.jsonl")
  const clock = new ManualClock(T0)

  const digests = new Set<string>()
  let checked = T0 - 2 * 86_400_000
  let rereadFrom = "abstract"
  const world: World = {
    digestHeldBack: async (id) => (digests.has(id) ? "has a digest" : id === "p2" ? "nothing to read" : null),
    watched: async () => [{ id: "th1", due: clock.now() - checked >= 86_400_000 }],
    rowsOf: async (id) =>
      id === "p1"
        ? [
            { thread: "th1", row: "r1", fromAbstract: rereadFrom === "abstract" },
            { thread: "th2", row: "r2", fromAbstract: false },
          ]
        : [],
    leaning: async (id) => (id === "p1" ? ["notes.md#c1"] : []),
  }

  const tasks = new Map<string, Task>()
  let n = 0
  // As the task store writes it: each change in order, the task as it was then
  let logging = Promise.resolve()
  const log = (task: Task) => {
    const line = { at: clock.now(), task: { ...task } }
    return (logging = logging.then(() => appendJsonl(tasksLog, line)))
  }
  const ws = {
    root,
    owlitPath: (...parts: string[]) => path.join(root, ".owlit", ...parts),
    tasks: {
      enqueue: (kind: string, subject: string, priority: Task["priority"]) => {
        const task = { id: `t${++n}`, kind, subject, priority, lane: "agent", state: "queued", attempts: 0, createdAt: clock.now() } as Task
        tasks.set(task.id, task)
        void log(task)
        return task
      },
    },
  } as unknown as Workspace

  const bus = new ActivityBus()
  const journal = new Journal(bus, () => journalFile, async () => ME)
  const initiative = new Initiative({ workspace: () => ws, record: (e) => journal.evaluation(e), trace: (e) => journal.trace(e), rules: RULES, clock, world: () => world })
  bus.subscribe((event) => initiative.observe(event))

  const until = async (at: number) => {
    await initiative.idle()
    clock.at = Math.max(clock.at, at)
  }
  const at = (minutes: number) => T0 + minutes * MIN
  const user = async (minutes: number, event: Omit<ActivityEvent, "at">) => {
    await until(at(minutes))
    bus.publish({ ...event, at: clock.now() } as ActivityEvent)
  }
  const core = async (minutes: number, kind: "workspace.opened" | "clock.hour" | "paper.starred" | "paper.read", paperId?: string) => {
    await until(at(minutes))
    initiative.observe(kind === "paper.starred" || kind === "paper.read" ? { kind, at: clock.now(), paperId: paperId! } : { kind, at: clock.now() })
  }
  // A run of Owlit's starts and finishes, and the workspace shows it
  const run = async (minutes: number, subject: string, done: () => void) => {
    await until(at(minutes))
    const task = [...tasks.values()].find((t) => t.subject === subject && t.state === "queued")!
    await log(Object.assign(task, { state: "running", startedAt: clock.now(), chatId: `run-${task.id}` }))
    clock.at += 1000
    done()
    await log(Object.assign(task, { state: "done", endedAt: clock.now() }))
  }

  // Opening: the watched thread is due
  await core(0, "workspace.opened")
  await run(1, "th1", () => (checked = clock.now()))
  // A starred paper gets its digest; starring it again finds it written; a paper with nothing to read
  await core(2, "paper.starred", "p1")
  await run(3, "p1", () => digests.add("p1"))
  await core(4, "paper.starred", "p1")
  await core(5, "paper.starred", "p2")
  // Read in full: the row answered from its abstract is answered again, the comment citing it looked at
  await user(6, { kind: "paper.opened", paperId: "p1" } as ActivityEvent)
  await user(7, { kind: "paper.closed", paperId: "p1" } as ActivityEvent)
  await core(8, "paper.read", "p1")
  await run(9, "th1:r1", () => (rereadFrom = "full"))
  await run(10, "notes.md#c1|p1", () => {})
  journal.feedback({ kind: "feedback.seen", at: clock.now() + 1, subject: "notes.md", detail: { comment: "c1" } })
  await until(at(11))
  journal.feedback({ kind: "feedback.dismiss", at: clock.now(), subject: "notes.md", detail: { comment: "c1" } })
  await user(20, { kind: "idle", seconds: 60 } as ActivityEvent)
  // The hour's look finds nothing due; a day later the thread is due again
  await core(60, "clock.hour")
  await core(60 * 25, "clock.hour")
  await until(at(60 * 25 + 1))
  await Promise.all([journal.flush(), logging])
  return { base, root, journalFile, tasksLog }
}

async function exported() {
  const s = await session()
  const to = path.join(s.base, "archive")
  const summary = await exportArchive({ root: s.root, journal: s.journalFile, tasksLog: s.tasksLog, to, owlit: MY_OWLIT, recording: true, version: "test", now: Date.now() })
  return { ...s, to, summary, archive: await readArchive(to) }
}

const decision = (rule: string, subject: string, d: string, reason: string | undefined, cause: string) => ({ rule, subject, decision: d, ...(reason ? { reason } : {}), cause })

describe("archive export and replay", () => {
  it("exports what Owlit heard, looked at and decided, the user's feedback and its runs, numbered from 1", async () => {
    const { archive, summary, to } = await exported()
    const { events, manifest } = archive
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    const lines = readFileSync(path.join(to, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { archiveSequence: number; recordedAt: string; event: Envelope })
    expect(summary).toMatchObject({ to, events: lines.length, from: T0 })
    expect(manifest).toMatchObject({ schema: "continuo.session-archive", version: 1, status: "completed", application: { name: "owlit" }, durableWatermark: lines.length })
    expect(manifest.safeConfig.owlit).toMatchObject({ format: 1, recording: true })
    expect(manifest.safeConfig.owlit.workspace).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(manifest)).not.toContain(path.basename(path.dirname(to)))
    // continuo's archive records around continuo's event envelopes, and the folders its tools expect
    expect(lines.map((l) => l.archiveSequence)).toEqual(lines.map((_, i) => i + 1))
    expect(lines[0]).toMatchObject({ archiveSequence: 1, recordedAt: new Date(T0).toISOString(), event: { schemaVersion: 1, id: "e1", sessionId: manifest.sessionId, sequence: 1, source: { kind: "adapter", id: "owlit-core" } } })
    expect(readdirSync(to).sort()).toEqual(["audio", "events.jsonl", "manifest.json", "observations.jsonl"])

    const types = new Set(events.map((e) => e.type))
    for (const t of ["evaluation", "rule.looked", "feedback.seen", "feedback.dismiss", "run.queued", "run.running", "run.done", "workspace.opened", "clock.hour", "paper.starred", "paper.read", "paper.closed", "idle"]) expect(types).toContain(t)
    // The opening is put in from the decision that heard it; the quiet hourly look left nothing
    expect(events.filter((e) => e.type === "clock.hour")).toHaveLength(1)

    const bySeq = new Map(events.map((e) => [e.seq, e]))
    const causeOf = (e: ArchiveEvent) => bySeq.get(e.cause!)
    for (const e of events.filter((e) => e.type === "evaluation")) expect(causeOf(e)).toMatchObject({ type: e.payload.cause, at: e.payload.causeAt })
    for (const e of events.filter((e) => e.type === "run.queued")) expect(causeOf(e)).toMatchObject({ type: "evaluation", payload: { taskId: e.payload.taskId } })
    for (const e of events.filter((e) => e.type === "run.done")) expect(causeOf(e)).toMatchObject({ type: "run.running", payload: { taskId: e.payload.taskId } })
    expect(events.find((e) => e.type === "paper.closed")).toMatchObject({ actor: ME, class: "interaction" })
    expect(events.find((e) => e.type === "idle")).toMatchObject({ class: "observation" })
    expect(events.find((e) => e.type === "evaluation")).toMatchObject({ actor: MY_OWLIT, class: "internal" })
  })

  it("writes inputs continuo accepts, and every decision traceable to the input it heard", async () => {
    const { to } = await exported()
    const envelopes = readFileSync(path.join(to, "events.jsonl"), "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { event: Envelope }).event)
    const byId = new Map(envelopes.map((e) => [e.id, e]))
    // continuo's validateInput, as of its 67d880c: a project type is a.b outside its reserved roots;
    // feedback carries only targetId and detail
    const reserved = ["session", "window", "job", "feedback", "participant", "silence", "timer", "config", "evaluation", "task", "action", "agent", "runtime", "transcript", "speech", "artifact", "presentation", "surface"]
    const inputs = envelopes.filter((e) => e.source.kind === "adapter")
    expect(inputs.length).toBeGreaterThan(0)
    for (const e of inputs) {
      if (e.type.startsWith("feedback.")) expect(Object.keys(e.payload).every((k) => ["targetId", "detail"].includes(k))).toBe(true)
      else {
        expect(e.type).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/)
        expect(reserved).not.toContain(e.type.split(".")[0])
      }
    }
    expect(envelopes.map((e) => e.type)).toContain("app.idle")
    // continuo's decisionLog: a decision's task started from an event that leads back to an input
    const started = new Map(envelopes.filter((e) => e.type === "task.started").map((e) => [e.taskId, e]))
    const decided = envelopes.filter((e) => e.type === "evaluation.decided")
    expect(decided.length).toBeGreaterThan(0)
    for (const d of decided) expect(byId.get(started.get(d.taskId)!.causationId!)?.source.kind).toBe("adapter")
    expect(new Set(decided.map((d) => d.payload.kind))).toEqual(new Set(["work", "no-action"]))
    // A run is the job of the task that queued it
    for (const j of envelopes.filter((e) => e.type === "job.queued")) expect(decided.find((d) => (d.payload.workIds as string[]).includes(j.payload.jobId as string))?.taskId).toBe(j.taskId)
  })

  it("replays to the same decisions with the same rules", async () => {
    const { archive } = await exported()
    const { recorded, replayed, unanswered } = await replay(archive)
    expect(recorded).toEqual([
      decision("threads.checkWatched", "th1", "job", undefined, "workspace.opened"),
      decision("digest.onStar", "p1", "job", undefined, "paper.starred"),
      decision("digest.onStar", "p1", "none", "has a digest", "paper.starred"),
      decision("digest.onStar", "p2", "none", "nothing to read", "paper.starred"),
      decision("paper.readInFull", "th1:r1", "job", undefined, "paper.read"),
      decision("paper.readInFull", "th2:r2", "none", "answered from the full text already", "paper.read"),
      decision("paper.readInFull", "notes.md#c1|p1", "job", undefined, "paper.read"),
      decision("threads.checkWatched", "th1", "job", undefined, "clock.hour"),
    ])
    expect(replayed).toEqual(recorded)
    expect(unanswered).toEqual([])
  })

  it("shows a changed rule's decisions differing only where it changed", async () => {
    const { archive } = await exported()
    // A reading leaves threads alone and only looks at comments again
    const sparing = defineRule({
      ...paperRead,
      when: async (e, ctx) => (await paperRead.when(e as never, ctx)).filter((o) => !("job" in o) || o.job.kind !== "threads.reread"),
    })
    const { recorded, replayed, unanswered } = await replay(archive, RULES.map((r) => (r === paperRead ? sparing : r)))
    expect(differences(recorded, replayed)).toEqual([
      { at: 4, recorded: decision("paper.readInFull", "th1:r1", "job", undefined, "paper.read"), replayed: decision("paper.readInFull", "th2:r2", "none", "answered from the full text already", "paper.read") },
      { at: 5, recorded: decision("paper.readInFull", "th2:r2", "none", "answered from the full text already", "paper.read"), replayed: decision("paper.readInFull", "notes.md#c1|p1", "job", undefined, "paper.read") },
      { at: 6, recorded: decision("paper.readInFull", "notes.md#c1|p1", "job", undefined, "paper.read"), replayed: decision("threads.checkWatched", "th1", "job", undefined, "clock.hour") },
      { at: 7, recorded: decision("threads.checkWatched", "th1", "job", undefined, "clock.hour"), replayed: undefined },
    ])
    expect(unanswered).toEqual([])
  })

  it("says so when a changed rule asks something the archive has no answer for", async () => {
    const { archive } = await exported()
    const curious = defineRule({
      ...paperRead,
      when: async (e, ctx) => {
        const { paperId } = e as { paperId: string }
        return [{ subject: paperId, none: (await ctx.world.digestHeldBack(paperId)) ?? "?" }]
      },
    })
    const { replayed, unanswered } = await replay(archive, RULES.map((r) => (r === paperRead ? curious : r)))
    expect(replayed.some((d) => d.rule === "paper.readInFull")).toBe(false)
    expect(unanswered[0]).toMatch(/^paper\.readInFull asked digestHeldBack\(p1\) on paper\.read at /)
  })

  it("exports an empty archive that says why while activity recording is off", async () => {
    const s = await session()
    const to = path.join(s.base, "off")
    const summary = await exportArchive({ root: s.root, journal: s.journalFile, tasksLog: s.tasksLog, to, owlit: MY_OWLIT, recording: false, version: "test", now: T0 })
    expect(summary).toEqual({ to, events: 0, note: "Activity recording is off, so there is nothing to export." })
    expect(readFileSync(path.join(to, "events.jsonl"), "utf8")).toBe("")
    const { manifest, events } = await readArchive(to)
    expect(events).toEqual([])
    expect(manifest).toMatchObject({ durableWatermark: 0, safeConfig: { owlit: { recording: false, note: summary.note } } })
  })

  it("keeps a since: only what came after, numbered from 1 again", async () => {
    const s = await session()
    const since = T0 + 6.5 * MIN
    const to = path.join(s.base, "since")
    await exportArchive({ root: s.root, journal: s.journalFile, tasksLog: s.tasksLog, to, owlit: MY_OWLIT, since, recording: true, version: "test", now: Date.now() })
    const { events, manifest } = await readArchive(to)
    expect(events[0]).toMatchObject({ seq: 1, type: "paper.closed" })
    expect(events.every((e) => e.at >= since)).toBe(true)
    const { recorded, replayed } = await replay({ events, manifest })
    expect(replayed).toEqual(recorded)
  })

  it("won't write into the workspace, or over a folder that has something in it", async () => {
    const s = await session()
    const options = { root: s.root, journal: s.journalFile, tasksLog: s.tasksLog, owlit: MY_OWLIT, recording: true, version: "test", now: T0 }
    await expect(exportArchive({ ...options, to: path.join(s.root, "archive") })).rejects.toThrow("outside the workspace")
    await expect(exportArchive({ ...options, to: path.join(s.base, "data") })).rejects.toThrow("isn't empty")
  })
})
