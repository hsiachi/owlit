import {
  parseTopic,
  RpcErrorCode,
  serializeTopic,
  type ActivityEvent,
  type Change,
  type JournalEntry,
  type KnowledgeRun,
  type KnowledgeVersion,
  type KnowledgeWrite,
  type PaperKnowledge,
  type Passage,
  type Topic,
  type TopicSidecar,
  type TopicSummary,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { appendFile, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { Chats } from "../chats/chats.ts"
import type { Docs } from "../docs/docs.ts"
import type { Versions } from "../docs/versions.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import type { Library } from "../library/library.ts"
import { isPaperId, paperDir } from "../library/paths.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskDefinition } from "../tasks/index.ts"
import { checkTopic, findQuote, passageOf } from "./check.ts"

// Owlit's Knowledge (README › Knowledge 运行规则): topic files in knowledge/, written by a background
// agent session from what the user did since the last run, and what the user did to them, kept in
// .owlit/knowledge/ where a run can't touch it:
//
//   topics/<topic id>.json    the sidecar: the user's edits and removals, the change history, what changed when
//   papers/<paper id>.json    a paper's passages Knowledge cites, and its connections
//   run.json                  where in the journal the last run stopped, and what it changed
//   changes.jsonl             every change any writer made, in order
//   versions/<id>/            knowledge/ as it was before each run (and before each revert)

export const KNOWLEDGE_DIR = "knowledge"
const UPDATE = "knowledge.update"

export interface KnowledgeTimings {
  // How long things must stay quiet after each kind of event before a run
  delays: Partial<Record<ActivityEvent["kind"], number>>
  // At most one run in this long, except right after an edit in Knowledge
  minGap: number
}

export const KNOWLEDGE_TIMINGS: KnowledgeTimings = {
  delays: { "doc.edited": 3 * 60_000, "chat.sent": 5 * 60_000, "chat.ended": 5 * 60_000, "paper.closed": 60_000, "knowledge.edited": 0 },
  minGap: 10 * 60_000,
}

export interface KnowledgeServices {
  // A background agent session that may use owlit's Knowledge tools; its answer is a summary
  agent?: (prompt: string, signal: AbortSignal) => Promise<{ text: string; connectorId: string }>
  // A sidecar or a paper's passages changed under the windows
  changed?: (change: { topics?: Record<string, TopicSidecar>; papers?: Record<string, PaperKnowledge> }) => void
  // A run ended
  updated?: (run: KnowledgeRun) => void
  timings?: KnowledgeTimings
  // Resolves once the activity heard so far is in journal.jsonl, so a run right after it reads it
  journalFlushed?: () => Promise<void>
  // An agent in a chat wrote a topic; versionId takes the write back
  wroteTopic?: (change: { versionId: string; path: string; label: string; chatId?: string }) => void
}

interface RunState {
  // Byte offset in journal.jsonl the next run reads from
  cursor: number
  lastRun: KnowledgeRun | null
  lastRunAt: number
}

// What a run takes in: the user's own doings since the last one
export interface Delta {
  docs: string[]
  chats: string[]
  papers: Record<string, { highlights: number; note: boolean; closed: boolean }>
  edited: { topic: string; id: string }[]
  end: number
}

const isEmpty = (d: Delta) => !d.docs.length && !d.chats.length && !Object.keys(d.papers).length && !d.edited.length

const blankSidecar = (): TopicSidecar => ({ seenAt: 0, history: [], edits: {}, removed: {}, said: {}, changedAt: {} })
const blankPaper = (): PaperKnowledge => ({ passages: {}, connections: [], dismissed: [], seenAt: 0 })
const fileName = (id: string) => `${encodeURIComponent(id)}.json`

export const topicPath = (name: string) => `${KNOWLEDGE_DIR}/${name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Topic"}.md`
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "topic"

export class Knowledge {
  private readonly root: string
  private readonly dir: string
  private readonly docs: Docs
  private readonly library: Library
  private readonly chats: Chats
  private readonly fileVersions: Versions
  private readonly services: KnowledgeServices
  private readonly timings: KnowledgeTimings
  private scheduler: Scheduler | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private runState: RunState | null = null
  // Papers with new highlights or a note since the last run: closing one of them calls for a run
  private marked = new Set<string>()
  // The run in progress: what it changed in each topic
  private current: Map<string, { added: number; rewritten: number; removed: number }> | null = null

  constructor(root: string, owlitDir: string, parts: { docs: Docs; library: Library; chats: Chats; versions: Versions }, services: KnowledgeServices = {}) {
    this.root = root
    this.dir = path.join(owlitDir, "knowledge")
    this.docs = parts.docs
    this.library = parts.library
    this.chats = parts.chats
    this.fileVersions = parts.versions
    this.services = services
    this.timings = services.timings ?? KNOWLEDGE_TIMINGS
  }

  attach(tasks: Scheduler) {
    this.scheduler = tasks
  }

  // ---- What the windows keep in step with ----

  async state() {
    const topics: Record<string, TopicSidecar> = {}
    const papers: Record<string, PaperKnowledge> = {}
    for (const [sub, into] of [
      ["topics", topics],
      ["papers", papers],
    ] as const) {
      const names = await readdir(path.join(this.dir, sub)).catch(() => [] as string[])
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        const value = await readJson<TopicSidecar & PaperKnowledge>(path.join(this.dir, sub, name)).catch(() => undefined)
        if (value) into[decodeURIComponent(name.slice(0, -5))] = value
      }
    }
    return { topics, papers, lastRun: (await this.run()).lastRun }
  }

  // The window's own changes (an edit, a removal, a passage found); core's own reach it as knowledge.changed
  putTopic(id: string, sidecar: TopicSidecar) {
    return this.serial(async () => {
      await writeJsonAtomic(path.join(this.dir, "topics", fileName(id)), sidecar)
      return null
    })
  }

  putPaper(id: string, paper: PaperKnowledge) {
    if (!isPaperId(id)) throw new RpcFailure(RpcErrorCode.InvalidParams, `${id} is not a paper id.`)
    return this.serial(async () => {
      await writeJsonAtomic(path.join(this.dir, "papers", fileName(id)), paper)
      return null
    })
  }

  // ---- Runs ----

  // Hears what the user does and puts a run off until things have been quiet long enough
  heard(event: ActivityEvent) {
    if (event.kind === "highlight.added" || event.kind === "note.edited") {
      this.marked.add(event.paperId)
      return
    }
    if (event.kind === "paper.closed" && !this.marked.has(event.paperId)) return
    const delay = this.timings.delays[event.kind]
    if (delay === undefined || !this.scheduler) return
    const tasks = this.scheduler
    void this.run().then((run) => {
      const gap = event.kind === "knowledge.edited" ? 0 : Math.max(0, run.lastRunAt + this.timings.minGap - Date.now())
      tasks.debounce(UPDATE, "workspace", Math.max(delay, gap))
    })
  }

  // Update now (the topic menu)
  update() {
    if (!this.scheduler) throw new RpcFailure(RpcErrorCode.NoWorkspace, "Open a folder as the workspace first.")
    // A run already put off for quiet starts now instead
    return this.scheduler.debounce(UPDATE, "workspace", 0, "asked")
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask(UPDATE, {
        lane: "agent",
        retries: 1,
        run: async (ctx) => {
          await this.services.journalFlushed?.()
          const delta = await this.delta()
          const state = await this.run()
          if (isEmpty(delta)) {
            await this.saveRun({ ...state, cursor: delta.end })
            return
          }
          if (!this.services.agent) throw new TaskFailure("No agent is set up to update Knowledge.")
          ctx.progress(0, undefined, "Reading what changed")
          const version = await this.snapshot("run")
          this.current = new Map()
          let touched: NonNullable<typeof this.current>
          try {
            await this.services.agent(await this.prompt(delta), ctx.signal)
          } finally {
            touched = this.current
            this.current = null
          }
          if (!touched.size) await rm(path.join(this.dir, "versions", version.id), { recursive: true, force: true })
          const at = Date.now()
          const lastRun: KnowledgeRun = { at, items: [...touched].map(([topicId, n]) => ({ topicId, what: describe(n) })), versionId: touched.size ? version.id : undefined }
          await this.saveRun({ cursor: delta.end, lastRun: touched.size ? lastRun : state.lastRun, lastRunAt: at })
          for (const id of Object.keys(delta.papers)) this.marked.delete(id)
          this.services.updated?.(lastRun)
        },
      }),
    ]
  }

  // The journal since the last run, as what the user did; agents' own writes don't count
  async delta(): Promise<Delta> {
    const { cursor } = await this.run()
    const file = path.join(path.dirname(this.dir), "journal.jsonl")
    const all = await readFile(file).catch(() => Buffer.alloc(0))
    const from = cursor <= all.length ? cursor : 0
    const delta: Delta = { docs: [], chats: [], papers: {}, edited: [], end: all.length }
    const docs = new Set<string>()
    const chats = new Set<string>()
    const paper = (id: string) => (delta.papers[id] ??= { highlights: 0, note: false, closed: false })
    for (const line of all.subarray(from).toString("utf8").split("\n")) {
      if (!line.trim()) continue
      let entry: JournalEntry
      try {
        entry = JSON.parse(line) as JournalEntry
      } catch {
        continue
      }
      if (entry.actor !== "user") continue
      if (entry.kind === "doc.edited" && !entry.path.startsWith(`${KNOWLEDGE_DIR}/`)) docs.add(entry.path)
      else if (entry.kind === "chat.ended") chats.add(entry.chatId)
      else if (entry.kind === "highlight.added") paper(entry.paperId).highlights++
      else if (entry.kind === "note.edited") paper(entry.paperId).note = true
      else if (entry.kind === "paper.closed") paper(entry.paperId).closed = true
      else if (entry.kind === "knowledge.edited") delta.edited.push({ topic: entry.topic, id: entry.id })
    }
    // A paper only opened and closed again isn't material yet
    for (const [id, p] of Object.entries(delta.papers)) if (!p.highlights && !p.note) delete delta.papers[id]
    delta.docs = [...docs]
    delta.chats = [...chats]
    return delta
  }

  private async prompt(delta: Delta) {
    const out = [
      "Update the user's Knowledge from what they did since the last update. You are working in the background: nobody will answer questions, and the user reads the result later.",
      "",
      "What the user did:",
    ]
    for (const p of delta.docs) out.push(`- Wrote in the doc ${p} (docs_read)`)
    for (const id of delta.chats) {
      const title = await this.chats
        .get(id)
        .then((c) => c.title)
        .catch(() => "")
      out.push(`- Talked with Owlit in the chat ${id}${title ? ` “${title}”` : ""} (chats_read)`)
    }
    for (const [id, p] of Object.entries(delta.papers)) {
      const paper = await this.library.get(id).catch(() => undefined)
      const did = [p.highlights ? `${p.highlights} new highlight${p.highlights === 1 ? "" : "s"} (library_highlights)` : "", p.note ? "edited their note (library_read part=note)" : ""].filter(Boolean)
      out.push(`- Read ${paper ? `“${paper.title}”` : "the paper"} (${id}): ${did.join(", ")}`)
    }
    for (const e of delta.edited) out.push(`- Edited the line ^${e.id} in the topic ${e.topic} by hand`)
    out.push(
      "",
      "How to work:",
      "1. knowledge_read lists the topics; read the ones this could touch.",
      "2. Read what the user did. Only material the user touched counts; what they wrote and said is theirs, a paper's findings are the paper's. A You: line says the user's point in their own voice, first person (“I”, “my draft”).",
      "3. Change topics with knowledge_write, giving the whole file in the format knowledge_read shows, and why in the user's terms (“you highlighted two passages of Lewis et al. 2020”). A line that speaks for a paper cites a passage: quote it word for word from library_read in passages.",
      "4. Open a new topic only when two separate pieces of the user's material are about the same question. If nothing here belongs in Knowledge, write nothing.",
      "5. When knowledge_write refuses, fix what it says and write again.",
      "",
      "Finish with one line per topic you changed, saying what changed, or “Nothing to keep.”",
    )
    return out.join("\n")
  }

  // ---- Reading and writing topics (owlit-mcp's knowledge_read and knowledge_write) ----

  async topics(): Promise<Topic[]> {
    const dir = path.join(this.root, KNOWLEDGE_DIR)
    const names = await readdir(dir, { recursive: true }).catch(() => [] as string[])
    const topics: Topic[] = []
    for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
      const rel = `${KNOWLEDGE_DIR}/${name.split(path.sep).join("/")}`
      const abs = path.join(this.root, rel)
      const [content, info] = await Promise.all([readFile(abs, "utf8"), stat(abs)]).catch(() => [null, null] as const)
      if (content !== null && info) topics.push(parseTopic(rel, content, info.mtimeMs))
    }
    return topics
  }

  async find(ref: string) {
    const topics = await this.topics()
    const want = ref.trim().toLowerCase()
    return topics.find((t) => t.id === ref || t.path === ref || t.name.toLowerCase() === want || t.path.toLowerCase() === `${KNOWLEDGE_DIR}/${want}.md`)
  }

  async summaries(): Promise<TopicSummary[]> {
    const out: TopicSummary[] = []
    for (const t of await this.topics()) {
      const side = await this.sidecar(t.id)
      out.push({ id: t.id, path: t.path, name: t.name, summary: t.summary, lines: t.lines.length, questions: t.questions.length, updatedAt: t.updatedAt, paused: !!side.paused })
    }
    return out
  }

  async read(ref: string) {
    const topic = await this.find(ref)
    if (!topic) throw new RpcFailure(RpcErrorCode.NotFound, `There is no topic called ${ref}.`)
    const side = await this.sidecar(topic.id)
    const content = (await this.docs.readDisk(topic.path)) ?? ""
    const edited = Object.entries(side.edits)
      .filter(([id]) => topic.lines.some((l) => l.id === id))
      .map(([id, e]) => ({ id, text: e.text }))
    return { id: topic.id, path: topic.path, name: topic.name, content, edited, removed: Object.values(side.removed).map((r) => r.text), paused: !!side.paused }
  }

  async sidecar(id: string) {
    return (await readJson<TopicSidecar>(path.join(this.dir, "topics", fileName(id))).catch(() => undefined)) ?? blankSidecar()
  }

  async paper(id: string) {
    return (await readJson<PaperKnowledge>(path.join(this.dir, "papers", fileName(id))).catch(() => undefined)) ?? blankPaper()
  }

  write(input: KnowledgeWrite) {
    return this.serial(async () => {
      const before = (await this.find(input.topic)) ?? null
      const sidecar = before ? await this.sidecar(before.id) : blankSidecar()
      if (sidecar.paused) throw new RpcFailure(RpcErrorCode.Conflict, `The user paused updates to “${before?.name}”; leave it as it is.`)

      // The passages given with this write: each quote must be in its paper, word for word
      const problems: string[] = []
      const given = new Map<string, Map<string, Passage>>()
      for (const p of input.passages ?? []) {
        const text = isPaperId(p.paper) ? await readFile(path.join(paperDir(this.root, p.paper), "text.md"), "utf8").catch(() => null) : null
        if (text === null) {
          problems.push(`${p.paper} has no text in owlit, so its passages can't be checked; leave its lines out.`)
          continue
        }
        const page = findQuote(text, p.quote)
        if (page === null) {
          problems.push(`The passage “${p.id}” isn't in ${p.paper} word for word; quote it as library_read gives it.`)
          continue
        }
        if (!given.has(p.paper)) given.set(p.paper, new Map())
        given.get(p.paper)!.set(p.id, passageOf(p.id, p.quote, page, p.section))
      }
      const cited = new Set([...input.content.matchAll(/owlit:\/\/library\/([^#)\s/]+)#passage=/g)].map((m) => m[1]))
      const known: Record<string, Set<string>> = {}
      for (const id of new Set([...cited, ...given.keys()])) {
        if (!isPaperId(id)) continue
        known[id] = new Set([...Object.keys((await this.paper(id)).passages), ...(given.get(id)?.keys() ?? [])])
      }

      const checked = checkTopic({ before, content: input.content, sidecar, remove: input.remove ?? [], passages: known })
      problems.push(...checked.problems)
      if (problems.length) throw new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)

      const topics = await this.topics()
      const next = checked.topic
      next.id = before?.id ?? uniqueId(slugify(next.name), topics)
      const rel = before?.path ?? uniquePath(topicPath(next.name), topics)
      const text = serializeTopic(next)
      // Kept like any agent write, so it can be undone on its own (a run's snapshot covers the whole run)
      const version = await this.fileVersions.saveFile(rel, before ? await this.docs.readDisk(rel) : null, text, { ...(input.chatId ? { chatId: input.chatId } : {}) })
      await this.docs.writeTold(rel, text)

      // The record: what changed in which line, why, and when
      const at = Date.now()
      const by = input.chatId ? `chat:${input.chatId}` : this.current ? "run" : "agent"
      const changes = diff(before, next).map((c): Change => ({ id: randomUUID().slice(0, 8), at, by: "owlit", why: input.why, ...c }))
      const side: TopicSidecar = { ...sidecar, history: [...changes.slice().reverse(), ...sidecar.history], changedAt: { ...sidecar.changedAt } }
      for (const c of changes) if (c.lineId && c.what !== "Removed") side.changedAt[c.lineId] = at
      if (!before) side.seenAt = 0
      await writeJsonAtomic(path.join(this.dir, "topics", fileName(next.id)), side)
      const papers: Record<string, PaperKnowledge> = {}
      for (const [id, passages] of given) {
        const paper = await this.paper(id)
        papers[id] = { ...paper, passages: { ...paper.passages, ...Object.fromEntries(passages) } }
        await writeJsonAtomic(path.join(this.dir, "papers", fileName(id)), papers[id])
      }
      await mkdir(this.dir, { recursive: true })
      await appendFile(path.join(this.dir, "changes.jsonl"), changes.map((c) => JSON.stringify({ ...c, topic: next.id, writer: by }) + "\n").join(""))
      this.services.changed?.({ topics: { [next.id]: side }, ...(Object.keys(papers).length ? { papers } : {}) })

      if (this.current) {
        const n = this.current.get(next.id) ?? { added: 0, rewritten: 0, removed: 0 }
        for (const c of changes) {
          if (c.what === "Added") n.added++
          else if (c.what === "Rewritten") n.rewritten++
          else if (c.what === "Removed") n.removed++
        }
        this.current.set(next.id, n)
      }
      if (input.chatId) this.services.wroteTopic?.({ versionId: version.id, path: rel, label: next.name, chatId: input.chatId })
      return { id: next.id, path: rel, name: next.name, changes: changes.map((c) => `${c.what}${c.lineId ? ` ^${c.lineId}` : ""}`) }
    })
  }

  // ---- Versions: knowledge/ as it was before each run ----

  async snapshot(reason: KnowledgeVersion["reason"]): Promise<KnowledgeVersion> {
    const id = `${Date.now()}-${randomUUID().slice(0, 4)}`
    const files = (await this.topics()).map((t) => t.path)
    const into = path.join(this.dir, "versions", id)
    await mkdir(into, { recursive: true })
    for (const rel of files) await cp(path.join(this.root, rel), path.join(into, rel))
    const version: KnowledgeVersion = { id, at: Date.now(), reason, files }
    await writeJsonAtomic(path.join(into, "version.json"), version)
    return version
  }

  async versions(): Promise<KnowledgeVersion[]> {
    const ids = await readdir(path.join(this.dir, "versions")).catch(() => [] as string[])
    const all = await Promise.all(ids.map((id) => readJson<KnowledgeVersion>(path.join(this.dir, "versions", id, "version.json")).catch(() => undefined)))
    return all.filter((v): v is KnowledgeVersion => !!v).sort((a, b) => b.at - a.at)
  }

  // Puts knowledge/ back as a version had it; what it is now is kept as a version first, so a revert
  // can be reverted
  revert(versionId: string) {
    return this.serial(async () => {
      const version = (await this.versions()).find((v) => v.id === versionId)
      if (!version) throw new RpcFailure(RpcErrorCode.NotFound, "There is no such version of Knowledge.")
      const now = await this.snapshot("revert")
      for (const rel of now.files) if (!version.files.includes(rel)) await this.docs.removeTold(rel)
      for (const rel of version.files) await this.docs.writeTold(rel, await readFile(path.join(this.dir, "versions", version.id, rel), "utf8"))
      return { files: version.files, versionId: now.id }
    })
  }

  // ---- Inside ----

  private async run(): Promise<RunState> {
    this.runState ??= (await readJson<RunState>(path.join(this.dir, "run.json")).catch(() => undefined)) ?? { cursor: 0, lastRun: null, lastRunAt: 0 }
    return this.runState
  }

  private async saveRun(state: RunState) {
    this.runState = state
    await writeJsonAtomic(path.join(this.dir, "run.json"), state)
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn, fn)
    this.writing = next.catch(() => undefined)
    return next
  }
}

// What a write changed, line by line, the way the history words it
function diff(before: Topic | null, next: Omit<Topic, "path" | "updatedAt">): Omit<Change, "id" | "at" | "by" | "why">[] {
  const out: Omit<Change, "id" | "at" | "by" | "why">[] = []
  if (!before) out.push({ what: "Started" })
  else if (before.summary !== next.summary) out.push({ what: "Summary rewritten", before: before.summary })
  const old = new Map(before?.lines.map((l) => [l.id, l]))
  for (const l of next.lines) {
    const was = old.get(l.id)
    if (!was) out.push({ lineId: l.id, what: "Added" })
    else if (was.text !== l.text || was.speaker !== l.speaker || was.condition !== l.condition) out.push({ lineId: l.id, what: "Rewritten", before: was.text })
  }
  const kept = new Set(next.lines.map((l) => l.id))
  for (const l of before?.lines ?? []) if (!kept.has(l.id)) out.push({ lineId: l.id, what: "Removed", before: l.text })
  const oldQ = new Map(before?.questions.map((q) => [q.id, q]))
  for (const q of next.questions) {
    const was = oldQ.get(q.id)
    if (!was) out.push({ lineId: q.id, what: "Question added" })
    else if (was.status !== q.status) out.push({ lineId: q.id, what: "Question updated", before: was.status })
  }
  const keptQ = new Set(next.questions.map((q) => q.id))
  for (const q of before?.questions ?? []) if (!keptQ.has(q.id)) out.push({ lineId: q.id, what: "Question removed", before: q.text })
  return out
}

function describe(n: { added: number; rewritten: number; removed: number }) {
  const count = (k: number, what: string) => (k ? `${k === 1 ? "One" : k} line${k === 1 ? "" : "s"} ${what}` : "")
  const parts = [count(n.added, "added"), count(n.rewritten, "rewritten"), count(n.removed, "removed")].filter(Boolean)
  return parts.length ? parts.map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(", ") : "Sources updated"
}

function uniqueId(base: string, topics: Topic[]) {
  const taken = new Set(topics.map((t) => t.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

function uniquePath(base: string, topics: Topic[]) {
  const taken = new Set(topics.map((t) => t.path.toLowerCase()))
  let rel = base
  for (let n = 2; taken.has(rel.toLowerCase()); n++) rel = base.replace(/\.md$/, ` ${n}.md`)
  return rel
}

