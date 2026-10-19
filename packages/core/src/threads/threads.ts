import { t } from "@lingui/core/macro"
import {
  applyThreadEdit,
  GROUPING_COLUMN,
  groupingView,
  threadOfSubject,
  itemId,
  QUESTION_COLUMN,
  RpcErrorCode,
  sameWords,
  shownThread,
  summarize,
  type Thread,
  type ThreadBatch,
  type ThreadCell,
  type ThreadEdit,
  type ThreadGroup,
  type ThreadSearch,
  type ThreadPaper,
  type ThreadSize,
  type TaskPriority,
  type ThreadRow,
  type PaperIds,
  type ThreadSummary,
  type ThreadWrite,
  upgradeThread,
} from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"
import type { Versions } from "../docs/versions.ts"
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import { checkSkill, fillSkill, gatherSkill, moreSkill, readSkill, rereadSkill, type Skill } from "../initiative/skills.ts"
import { Serial } from "../util.ts"

// Threads: papers Owlit gathered for a question, in .owlit/threads/<id>/:
//
//   thread.json   the thread, with what the user did to it in `yours`
//   history.jsonl     one line per write: who (a chat, a run, the user, an undo), which items, why
//
// Owlit writes its own record without asking, but never over the user: a rewrite of theirs stays word for
// word whatever Owlit writes later, and what they removed stays out. Every agent write is kept as a
// version, so the window can offer Undo like for any agent change; an undo takes back what Owlit did and
// keeps what the user did since.

export interface ThreadsServices {
  // A background agent session with owlit's tools, allowed these besides the read-only ones; its answer
  // is a line on what it did
  // A background agent run for a task (ctx: its signal, and its session shown beside the thread);
  // run signs its searches and writes
  agent?: (prompt: string, ctx: TaskContext, allow: RegExp, run: string) => Promise<{ text: string }>
  // The searches a chat (chat:<id>) or a background run (run:<kind>:<task>) made since a moment
  searches?: (by: string, since: number) => Promise<{ at: number; query: string; source: string; results: string[] }[]>
  // What a paper is, by its id: the Library's record, or what a recent search found
  paper?: (id: string) => Promise<ThreadPaper | undefined>
  // The 1-based page a quote is on in a paper's full text, word for word; null when it isn't there,
  // undefined when owlit has no text of the paper
  findPassage?: (paperId: string, quote: string) => Promise<number | null | undefined>
  // Whether owlit has a paper's full text (its text.md), by any id it goes by
  hasText?: (id: string, ids?: PaperIds) => Promise<boolean>
  // The library's id for a paper named by any id it goes by, undefined when it isn't in the library: a row
  // keeps the id the search gave, which often isn't the library's (Library.canonical)
  canonical?: (id: string, ids?: PaperIds) => Promise<string | undefined>
  // A row's paper as the thread is read: the Library's facts, with the user's corrections, when it is there
  facts?: (id: string, paper: ThreadPaper) => Promise<ThreadPaper>
  // A thread changed under the windows (null: deleted)
  changed?: (id: string, thread: Thread | null) => void
  // An agent in a chat wrote to a thread; versionId takes the write back
  wrote?: (change: { versionId: string; id: string; label: string; chatId?: string; created: boolean; rows: string[]; updated: number; asked?: string }) => void
}

interface HistoryLine {
  at: number
  by: string
  // The background run that wrote it, "<kind>:<task id>"
  run?: string
  why?: string
  items: string[]
  // Rows the write added, the question it was for when that was a later one, Owlit's note on what it
  // couldn't reach, and the searches it rests on (made since the same chat's or run's last write)
  added?: string[]
  asked?: string
  note?: string
  searches?: { at: number; query: string; source: string; results: string[] }[]
}

// How far back a write looks for the searches it rests on, when nothing of the same chat or run came before
const SEARCHES_SINCE_MS = 6 * 3_600_000
// Writes of one chat this close together are one batch
const BATCH_GAP_MS = 30 * 60_000

const FILE = "thread.json"
const DAY = 24 * 3_600_000

// A skill that may use only owlit's read-only tools
const NO_TOOLS = /^$/

export class Threads {
  private readonly dir: string
  private readonly trashDir: string
  private readonly versions: Versions
  private readonly services: ThreadsServices
  private readonly serial = new Serial()
  private scheduler: Scheduler | null = null
  // When each chat's or run's searches were last given to a write
  private attributed = new Map<string, number>()

  constructor(owlitDir: string, parts: { versions: Versions }, services: ThreadsServices = {}) {
    this.dir = path.join(owlitDir, "threads")
    this.trashDir = path.join(owlitDir, "trash")
    this.versions = parts.versions
    this.services = services
  }

  // Newest change first
  async list(): Promise<ThreadSummary[]> {
    const ids = await readdir(this.dir).catch(() => [] as string[])
    const all = await Promise.all(ids.map((id) => this.load(id).catch(() => undefined)))
    return all
      .filter((c): c is Thread => !!c)
      .map(summarize)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // A paper as a thread keeps it, from any thread that has it
  async paperOf(paperId: string): Promise<ThreadPaper | undefined> {
    const ids = await readdir(this.dir).catch(() => [] as string[])
    for (const id of ids) {
      const row = await this.rowOf((await this.load(id).catch(() => undefined))?.rows ?? [], paperId)
      if (row) return row.paper
    }
    return undefined
  }

  // The threads that have this paper as a row (under any id it goes by), and whether some of its answers
  // there rest only on the abstract (the user's reading of it in full can give them again from the whole
  // text)
  async rowsOf(paperId: string): Promise<{ thread: string; row: string; fromAbstract: boolean }[]> {
    const out: { thread: string; row: string; fromAbstract: boolean }[] = []
    for (const id of await readdir(this.dir).catch(() => [] as string[])) {
      const row = await this.rowOf((await this.load(id).catch(() => undefined))?.rows ?? [], paperId)
      if (row) out.push({ thread: id, row: row.id, fromAbstract: Object.values(row.cells).some((cell) => cell.depth !== "full") })
    }
    return out
  }

  // The thread as it is read: each row's paper as the Library has it, when it is there
  async get(id: string): Promise<Thread> {
    const c = await this.load(id)
    if (!c) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
    const facts = this.services.facts
    return facts ? { ...c, rows: await Promise.all(c.rows.map(async (r) => ({ ...r, paper: await facts(r.id, r.paper) }))) } : c
  }

  // The row that is this paper: by its id, or by the library's id both go by
  private async rowOf(rows: ThreadRow[], paperId: string): Promise<ThreadRow | undefined> {
    const exact = rows.find((r) => r.id === paperId)
    const canonical = this.services.canonical
    if (exact || !canonical || !rows.length) return exact
    const target = await canonical(paperId)
    if (!target) return undefined
    for (const r of rows) if ((await canonical(r.id, r.paper.ids)) === target) return r
    return undefined
  }

  attach(tasks: Scheduler) {
    this.scheduler = tasks
  }

  // ---- Owlit's work in the background ----

  // The task kinds, when there is an agent to run them
  tasks(): TaskDefinition[] {
    const agent = this.services.agent
    if (!agent) return []
    // A task per skill (initiative/skills.ts): the skill says what the session is told and which tools it gets
    const run = <I>(skill: Skill<I>, input: (c: Thread, subject: string) => I | Promise<I>, after?: (c: Thread) => Promise<void>) =>
      defineTask(skill.id, {
        lane: skill.lane,
        retries: 1,
        run: async (ctx) => {
          const c = await this.load(threadOfSubject(ctx.task.subject))
          if (!c) throw new TaskFailure("The thread is gone.")
          ctx.progress(0, undefined, skill.id)
          // What it did is in the thread, with Owlit's dots; its answer is only a line for the log
          const done = await agent(skill.instructions(await input(c, ctx.task.subject)), ctx, skill.tools ?? NO_TOOLS, `${skill.id}:${ctx.task.id}`)
          if (process.env.OWLIT_LOG_AGENTS) console.log(`[threads] ${skill.id} ${ctx.task.subject}: ${done.text.trim().split("\n").pop()}`)
          await after?.(c)
        },
      })
    return [
      run(gatherSkill, async (thread) => ({ thread, size: thread.size ?? "few", withText: await this.withText(thread) })),
      run(moreSkill, async (thread) => ({ thread, withText: await this.withText(thread) })),
      run(fillSkill, async (thread, subject) => {
        const column = thread.columns.find((col) => col.id === subject.split(":")[1])
        if (!column) throw new TaskFailure("The column is gone.")
        return { thread, column, withText: await this.withText(thread) }
      }),
      run(readSkill, (thread) => ({ thread })),
      run(checkSkill, (thread) => ({ thread, since: thread.checkedAt ?? thread.createdAt }), (c) => this.checked(c.id)),
      // "<id>:<paper>": one row, answered again once the user read the paper in full
      run(rereadSkill, (thread, subject) => ({ thread, paperId: subject.slice(subject.indexOf(":") + 1) })),
    ]
  }

  // The thread's rows whose full text owlit has: Owlit answers those from it from the start
  private async withText(c: Thread): Promise<string[]> {
    const hasText = this.services.hasText
    if (!hasText) return []
    const has = await Promise.all(c.rows.map((r) => hasText(r.id, r.paper.ids)))
    return c.rows.filter((_, i) => has[i]).map((r) => r.id)
  }

  // Owlit gathers papers for a question: the thread is there at once, titled by the question until
  // Owlit names it, and the task fills it
  gather(input: { question: string; project?: string; size: ThreadSize }) {
    return this.serial.run(async () => {
      const now = Date.now()
      const question = input.question.trim()
      if (!question) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to collect papers on.`)
      const c: Thread = { ...(await this.blank({ asked: question, title: question, project: input.project ?? "" }, now)), size: input.size }
      await this.save(c)
      await this.record(c.id, { at: now, by: "you", items: ["asked"] })
      this.services.changed?.(c.id, c)
      this.queue("threads.gather", c.id, "asked")
      return c
    })
  }

  async start(id: string, run: "more" | "read" | "check") {
    await this.get(id)
    return this.queue(`threads.${run}`, id, "asked")
  }

  // A new column: one question for every paper, answered in the background
  ask(id: string, question: string) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      const q = question.trim()
      if (!q) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to ask of each paper.`)
      let column = c.columns.find((col) => sameWords(col.question, q))
      if (!column) {
        column = { id: freshId("c", c.columns.map((col) => col.id)), question: q, kind: "ask" }
        c.columns.push(column)
        c.updatedAt = Date.now()
        await this.save(c)
        await this.record(c.id, { at: c.updatedAt, by: "you", items: [`column:${column.id}`] })
        this.services.changed?.(c.id, c)
      } else if (column.hidden) {
        column.hidden = false
        await this.save(c)
        this.services.changed?.(c.id, c)
      }
      this.queue("threads.fill", `${c.id}:${column.id}`, "asked")
      return c
    })
  }

  // A new way of grouping the papers: a hidden grouping column with the user's words as its question,
  // filled in the background. The same words again fill the grouping there is (Ask again).
  group(id: string, question: string) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      const q = question.trim()
      if (!q) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to group the papers by.`)
      let column = c.columns.find((col) => col.kind === "grouping" && sameWords(col.question, q))
      if (!column) {
        column = { id: freshId("g", c.columns.map((col) => col.id)), question: q, kind: "grouping", hidden: true, groups: [] }
        c.columns.push(column)
        c.updatedAt = Date.now()
        await this.save(c)
        await this.record(c.id, { at: c.updatedAt, by: "you", items: [`column:${column.id}`] })
        this.services.changed?.(c.id, c)
      }
      this.queue("threads.fill", `${c.id}:${column.id}`, "asked")
      return c
    })
  }

  async fill(id: string, columnId: string) {
    const c = await this.get(id)
    if (!c.columns.some((col) => col.id === columnId)) throw new RpcFailure(RpcErrorCode.NotFound, t`That column isn't there any more.`)
    return this.queue("threads.fill", `${id}:${columnId}`, "asked")
  }

  // A column that sets every paper against sentences the user picked from a doc of theirs. The column is
  // theirs (they chose the sentences); its cells are Owlit's reading.
  compare(id: string, doc: string, sentences: string[]) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      const lines = sentences.map((text) => text.trim()).filter(Boolean)
      if (!lines.length) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Pick at least one sentence to compare with.`)
      const column = { id: freshId("c", c.columns.map((col) => col.id)), question: doc, kind: "compare" as const, doc, sentences: lines.map((text, i) => ({ id: `l${i + 1}`, text })) }
      c.columns.push(column)
      c.updatedAt = Date.now()
      await this.save(c)
      await this.record(c.id, { at: c.updatedAt, by: "you", items: [`column:${column.id}`] })
      this.services.changed?.(c.id, c)
      this.queue("threads.fill", `${c.id}:${column.id}`, "asked")
      return c
    })
  }

  // The threads the user asked Owlit to watch, each with whether a day has passed since its last check
  // (Owlit's rules queue the check)
  async watched(now = Date.now()): Promise<{ id: string; due: boolean }[]> {
    const out: { id: string; due: boolean }[] = []
    for (const s of await this.list()) {
      if (!s.watch) continue
      const c = await this.load(s.id)
      if (c) out.push({ id: c.id, due: now - (c.checkedAt ?? c.createdAt) >= DAY })
    }
    return out
  }

  private async checked(id: string) {
    await this.serial.run(async () => {
      const c = await this.load(id)
      if (!c) return
      c.checkedAt = Date.now()
      await this.save(c)
    })
  }

  private queue(kind: string, subject: string, priority: TaskPriority) {
    if (!this.scheduler) throw new RpcFailure(RpcErrorCode.Unavailable, t`Owlit can't work in the background here.`)
    return this.scheduler.enqueue(kind, subject, priority)
  }

  // ---- Owlit's writes ----

  write(input: ThreadWrite) {
    return this.serial.run(async () => {
      const now = Date.now()
      const existing = input.id ? await this.load(input.id) : undefined
      if (input.id && !existing) throw new RpcFailure(RpcErrorCode.NotFound, `There is no thread ${input.id}; leave id out to start one.`)
      const problems: string[] = []
      if (!existing && !input.asked?.trim()) problems.push("A new thread needs asked: the question as the user put it.")
      if (!existing && !input.title?.trim()) problems.push("A new thread needs a title: a short, neutral name for what it gathers.")
      if (problems.length) throw new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)

      const before = existing ? JSON.stringify(existing) : null
      const c: Thread = existing ? structuredClone(existing) : await this.blank(input, now)
      const fresh = !existing
      // Until the user has looked at the thread once, all of it is new: nothing in it gets a dot of its
      // own (the list says it is new)
      const looked = c.seenAt > 0
      const changed = new Set<string>()
      // Every item the write changed goes in the history; dot: false leaves it without Owlit's dot
      const mark = (item: string, dot = true) => {
        changed.add(item)
        // Later than the user's last look even within the same millisecond, or the dot would never show
        if (dot && !fresh && looked) c.changedAt[item] = Math.max(now, c.seenAt + 1)
      }

      if (existing && input.title?.trim() && input.title.trim() !== c.title) {
        c.title = input.title.trim()
        mark(itemId.title())
      }
      if (input.project !== undefined && !existing) c.project = input.project
      const asked = input.asked?.trim()
      if (existing && asked && !sameWords(asked, c.asked.text) && !c.alsoAsked?.some((a) => sameWords(a.text, asked))) {
        c.alsoAsked = [...(c.alsoAsked ?? []), { text: asked, at: now, ...(input.chatId ? { chatId: input.chatId } : {}) }]
        changed.add("asked")
      }
      if (input.sources?.length) c.sources = [...new Set([...c.sources, ...input.sources])]

      // Columns: new questions to ask of every paper
      for (const col of input.columns ?? []) {
        const question = col.question.trim()
        if (!question) continue
        if (c.columns.some((have) => have.id === col.id || sameWords(have.question, question))) continue
        const id = col.id?.trim() || freshId("c", c.columns.map((x) => x.id))
        c.columns.push({ id, question, kind: "ask" })
        mark(`column:${id}`, false)
      }

      // Groups: the whole of one grouping as Owlit means it now, under what the user did to it. Groups they
      // merged or ungrouped stay so (Owlit is told), and a group they put a paper in stays even when Owlit
      // leaves it out.
      const userKept: string[] = []
      const wantsGroups = !!input.groups || (input.rows ?? []).some((r) => r.group !== undefined || r.groups !== undefined)
      const newGrouping = input.newGrouping?.trim()
      let grouping = newGrouping
        ? c.columns.find((col) => col.kind === "grouping" && sameWords(col.question, newGrouping))
        : wantsGroups
          ? input.grouping
            ? c.columns.find((col) => col.id === input.grouping)
            : c.columns.find((col) => col.kind === "grouping")
          : undefined
      if (newGrouping && !grouping) {
        grouping = { id: freshId("g", c.columns.map((col) => col.id)), question: newGrouping, kind: "grouping", hidden: true, groups: [] }
        c.columns.push(grouping)
        mark(`column:${grouping.id}`, false)
      } else if (wantsGroups && input.grouping && grouping?.kind !== "grouping") problems.push(`There is no grouping ${input.grouping}; leave grouping out for the thread's own (Topic), or give new_grouping to start one.`)
      else if (wantsGroups && !grouping) {
        let id = GROUPING_COLUMN
        for (let n = 2; c.columns.some((col) => col.id === id); n++) id = `${GROUPING_COLUMN}${n}`
        grouping = { id, question: "Topic", kind: "grouping", hidden: true, groups: [] }
        c.columns.push(grouping)
        mark(`column:${id}`, false)
      }
      const col = grouping?.kind === "grouping" ? grouping : undefined
      const named = (id: string) => `${id} (${col?.groups?.find((g) => g.id === id)?.name ?? id})`
      if (col && input.groups) {
        const given = new Map(input.groups.map((g) => [g.id, g]))
        for (const g of input.groups) {
          if (!g.parent) continue
          const parent = given.get(g.parent)
          if (!parent) problems.push(`Group ${g.id} sits under ${g.parent}, which isn't one of the groups.`)
          else if (parent.parent || g.parent === g.id) problems.push(`Groups go two levels deep at most: ${g.id} sits under ${g.parent}, which is itself under ${parent.parent}.`)
        }
        const before = col.groups ?? []
        const next: ThreadGroup[] = input.groups.map((g) => ({ ...g }))
        for (const g of next) {
          const into = c.yours.merged[`${col.id}:${g.id}`]
          if (into !== undefined) userKept.push(`The user merged group ${named(g.id)} into ${named(into)}: papers you put in ${g.id} go in ${into}. Leave ${g.id} out.`)
          else if (c.yours.removed[itemId.group(col.id, g.id)]) userKept.push(`The user ungrouped ${named(g.id)}: it stays gone, and papers you put in it aren't in it. Leave it out.`)
        }
        // Groups the user put papers in or merged others into, which Owlit's grouping leaves out
        const held = new Set([
          ...Object.entries(c.yours.placed)
            .filter(([key, p]) => p.in && key.startsWith(`${col.id}:`))
            .map(([key]) => key.slice(key.lastIndexOf(":") + 1)),
          ...Object.entries(c.yours.merged)
            .filter(([key]) => key.startsWith(`${col.id}:`))
            .map(([, into]) => into),
        ])
        for (const id of held) {
          const was = before.find((g) => g.id === id)
          if (!was || given.has(id)) continue
          const { parent, ...rest } = was
          const top = parent ? next.find((g) => g.id === parent && !g.parent) : undefined
          next.push(top ? { ...rest, parent } : rest)
        }
        for (const g of next) {
          const was = before.find((have) => have.id === g.id)
          if (!was || was.name !== g.name || was.one !== g.one || was.parent !== g.parent) mark(itemId.group(col.id, g.id))
        }
        for (const g of before) if (!next.some((have) => have.id === g.id)) changed.add(itemId.group(col.id, g.id))
        col.groups = next
        // Owlit's papers in a group that is gone fall out of it
        const ids = new Set(next.map((g) => g.id))
        for (const row of c.rows) {
          const kept = row.in?.[col.id]?.filter((id) => ids.has(id))
          if (!row.in?.[col.id] || kept?.length === row.in[col.id]!.length) continue
          if (kept?.length) row.in[col.id] = kept
          else delete row.in[col.id]
        }
      }
      const view = col ? groupingView(c, col) : undefined

      // Rows: new papers, and answers for the ones there
      const added: string[] = []
      let updated = 0
      const left: string[] = []
      for (const asked of input.rows ?? []) {
        if (c.yours.removed[itemId.row(asked.id)]) {
          left.push(asked.id)
          continue
        }
        // A paper the thread has under another of its ids is that row
        let row = await this.rowOf(c.rows, asked.id)
        const r = row ? { ...asked, id: row.id } : asked
        if (!row) {
          const paper = r.paper ?? (await this.services.paper?.(r.id))
          if (!paper) {
            problems.push(`owlit doesn't know the paper ${r.id}: name papers by the id a search gave you.`)
            continue
          }
          row = { id: r.id, paper, cells: {}, addedAt: now, ...(r.foundBy ? { foundBy: r.foundBy } : {}) }
          c.rows.push(row)
          added.push(r.id)
          mark(itemId.row(r.id))
        } else if (r.foundBy && !row.foundBy) row.foundBy = r.foundBy
        let touched = false
        // Whether the paper's record has an abstract, asked once per row and only for answers not from the full text
        let abstract: boolean | undefined
        for (const [col, cell] of Object.entries(r.cells ?? {})) {
          if (!c.columns.some((have) => have.id === col)) {
            problems.push(`There is no column ${col}; add it under columns first.`)
            continue
          }
          const text = cell.text.trim()
          if (!text) continue
          // An answer from the full text rests on a passage that is in the paper word for word
          let passage = cell.passage
          if (cell.depth === "full") {
            if (!passage) {
              problems.push(`${r.id}'s answer for ${col} says it is from the full text but gives no passage; quote the words it rests on.`)
              continue
            }
            const page = this.services.findPassage ? await this.services.findPassage(r.id, passage.quote) : passage.page
            if (page === undefined) {
              problems.push(`owlit has no full text of ${r.id}, so its answer can only be from the abstract (depth abstract).`)
              continue
            }
            if (page === null) {
              problems.push(`The passage for ${r.id} isn't in its text word for word; quote it as library_read gives it.`)
              continue
            }
            passage = { quote: passage.quote, page }
          }
          // An answer "from the abstract" of a paper with none was from its title: stored so, for the memo,
          // the cell and the export to say
          let depth = cell.depth
          if (depth === "abstract") {
            abstract ??= !!(this.services.facts ? await this.services.facts(row.id, row.paper) : row.paper).abstract?.trim()
            if (!abstract) depth = "title"
          }
          const was = row.cells[col]
          const next: ThreadCell = { ...cell, depth, text, at: now, ...(passage && cell.depth === "full" ? { passage } : {}) }
          if (cell.depth !== "full") delete next.passage
          if (was && sameCell(was, next)) continue
          row.cells[col] = next
          touched = true
          // A cell the user rewrote keeps their words; Owlit's new answer waits underneath without a dot
          mark(itemId.cell(r.id, col), !c.yours.edits[itemId.cell(r.id, col)])
        }
        if (col && (r.group !== undefined || r.groups !== undefined)) {
          const ids = placeIn(col.groups ?? [], r.groups ?? (r.group ? [r.group] : []), (id) => {
            // A group the user merged or ungrouped: kept as Owlit wrote it while Owlit still has the group,
            // so the user's change shows over it and their Undo finds it; otherwise where it went
            const into = c.yours.merged[`${col.id}:${id}`]
            const ungrouped = !!c.yours.removed[itemId.group(col.id, id)]
            if (ungrouped) userKept.push(`${r.id} isn't in ${named(id)}: the user ungrouped it.`)
            if (into !== undefined || ungrouped) return (col.groups ?? []).some((g) => g.id === id) ? id : into !== undefined ? view!.target(into) : null
            if (!(col.groups ?? []).some((g) => g.id === id)) {
              problems.push(`Row ${r.id} is put in group ${id}, which isn't one of the groups.`)
              return null
            }
            return id
          })
          const was = row.in?.[col.id] ?? []
          if (ids.join() !== was.join()) {
            if (ids.length) row.in = { ...row.in, [col.id]: ids }
            else if (row.in) delete row.in[col.id]
            touched = true
            mark(itemId.row(r.id), false)
          }
        }
        if (touched && !changed.has(itemId.row(r.id))) updated++
      }
      for (const id of input.removeRows ?? []) {
        const at = c.rows.findIndex((r) => r.id === id)
        if (at < 0) continue
        c.rows.splice(at, 1)
        changed.add(itemId.row(id))
      }

      // The memo, whole. What the user removed doesn't come back in other words' clothing; a sentence the
      // user rewrote stays where it was even when Owlit drops it.
      if (input.memo) {
        const removedTexts = Object.entries(c.yours.removed)
          .filter(([k]) => k.startsWith("memo:"))
          .map(([, v]) => v.text)
        const next: Thread["memo"] = []
        const taken = c.memo.map((s) => s.id)
        for (const s of input.memo) {
          const text = s.text.trim()
          if (!text) continue
          if (removedTexts.some((gone) => sameWords(gone, text))) continue
          const id = s.id && !next.some((n) => n.id === s.id) ? s.id : freshId("s", [...taken, ...next.map((n) => n.id)])
          const was = c.memo.find((have) => have.id === id)
          if (!was || !sameWords(was.text, text)) mark(itemId.memo(id))
          next.push({ id, text })
        }
        c.memo.forEach((s, i) => {
          if (c.yours.edits[itemId.memo(s.id)] && !next.some((n) => n.id === s.id)) next.splice(Math.min(i, next.length), 0, s)
        })
        for (const s of c.memo) if (!next.some((n) => n.id === s.id)) changed.add(itemId.memo(s.id))
        c.memo = next
      }

      if (problems.length) throw new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)
      if (!fresh && !changed.size) return { id: c.id, title: shownThread(c).title, added: 0, updated: 0, left, userKept }

      c.updatedAt = now
      const version = await this.versions.saveThread(c.id, before, { ...(input.chatId ? { chatId: input.chatId } : {}) })
      await this.save(c)
      const searches = await this.searchesFor(c.id, input, now)
      await this.record(c.id, {
        at: now,
        by: input.chatId ? `chat:${input.chatId}` : "agent",
        ...(input.run && !input.chatId ? { run: input.run } : {}),
        ...(input.why ? { why: input.why } : {}),
        items: [...changed],
        ...(added.length ? { added } : {}),
        ...(asked && changed.has("asked") ? { asked } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        ...(searches.length ? { searches } : {}),
      })
      this.services.changed?.(c.id, c)
      const title = shownThread(c).title
      if (input.chatId) this.services.wrote?.({ versionId: version.id, id: c.id, label: title, chatId: input.chatId, created: fresh, rows: added, updated, ...(asked ? { asked } : {}) })
      return { id: c.id, title, added: added.length, updated, left, userKept }
    })
  }

  // ---- The user's changes ----

  edit(id: string, edit: ThreadEdit) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      const now = Date.now()
      const done = applyThreadEdit(c, edit, now)
      if ("problem" in done) {
        if (done.problem === "empty") throw new RpcFailure(RpcErrorCode.InvalidParams, t`Write something, or remove it instead.`)
        if (done.problem === "row") throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the thread any more.`)
        if (done.problem === "group") throw new RpcFailure(RpcErrorCode.NotFound, t`That group isn't there any more.`)
        throw new RpcFailure(RpcErrorCode.NotFound, t`That isn't in the thread any more.`)
      }
      const items = done.items
      // Looking, and how the user looks, change nothing worth a line in the history, nor the order of the list
      if (edit.op !== "seen" && edit.op !== "view") {
        c.updatedAt = now
        await this.record(c.id, { at: now, by: "you", items: items.length ? items : [edit.op] })
      }
      await this.save(c)
      this.services.changed?.(c.id, c)
      return c
    })
  }

  // Keep it separate: rows an agent added to a thread, for a question close to its own, become a
  // thread of their own for that question. The user's words make its title until they rename it;
  // there is no memo yet, since Owlit's reading was of the other thread. Made from a group (Make it a
  // thread of its own), the group leaves the thread, and a paper that is in another of its groups too
  // stays there as well: it is copied, not moved.
  split(id: string, rowIds: string[], asked: string, group?: { column: string; id: string }) {
    return this.serial.run(async () => {
      const from = await this.get(id)
      const now = Date.now()
      const rows = from.rows.filter((r) => rowIds.includes(r.id))
      if (!rows.length) throw new RpcFailure(RpcErrorCode.NotFound, t`Those papers aren't in the thread any more.`)
      const col = group && from.columns.find((x) => x.id === group.column && x.kind === "grouping")
      if (group && !col) throw new RpcFailure(RpcErrorCode.NotFound, t`That group isn't there any more.`)
      const copied: string[] = []
      if (col && group) {
        const view = groupingView(from, col)
        const own = new Set([group.id, ...view.groups.filter((g) => g.parent === group.id).map((g) => g.id)])
        for (const r of rows) if (view.of(r).some((g) => !own.has(g))) copied.push(r.id)
        const name = view.groups.find((g) => g.id === group.id)?.name
        if (name !== undefined) from.yours.removed[itemId.group(col.id, group.id)] = { text: name, at: now }
      }
      const question = asked.trim() || from.asked.text
      const c: Thread = {
        ...(await this.blank({ asked: question, title: question }, now)),
        project: from.project,
        sources: from.sources,
        // Only the question's own answers: the other thread's columns and groups don't come along
        rows: rows.map(({ in: _in, ...r }): ThreadRow => {
          const answer = r.cells[QUESTION_COLUMN]
          return { ...r, cells: answer ? { [QUESTION_COLUMN]: answer } : {} }
        }),
      }
      const taken = from.alsoAsked?.find((a) => sameWords(a.text, question))
      c.splitFrom = { id: from.id, rows, ...(taken ? { asked: taken } : {}), ...(col && group ? { group, copied } : {}) }
      from.rows = from.rows.filter((r) => !rowIds.includes(r.id) || copied.includes(r.id))
      from.alsoAsked = from.alsoAsked?.filter((a) => a !== taken)
      from.updatedAt = now
      await this.save(c)
      await this.save(from)
      await this.record(c.id, { at: now, by: "you", why: `Kept separate from ${from.id}`, items: rows.map((r) => itemId.row(r.id)) })
      await this.record(from.id, { at: now, by: "you", why: `Moved to ${c.id}`, items: [...rows.filter((r) => !copied.includes(r.id)).map((r) => itemId.row(r.id)), ...(group ? [itemId.group(group.column, group.id)] : [])] })
      this.services.changed?.(from.id, from)
      this.services.changed?.(c.id, c)
      return c
    })
  }

  // Undo of split(): the rows go back as they were in the thread they came from, with what the user
  // wrote in their answers since; one they removed here stays out, and so does one already back there
  unsplit(id: string) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      if (!c.splitFrom) throw new RpcFailure(RpcErrorCode.NotFound, t`This thread wasn't kept separate from another.`)
      const from = await this.load(c.splitFrom.id)
      if (!from) throw new RpcFailure(RpcErrorCode.NotFound, t`The thread these papers came from is gone.`)
      const now = Date.now()
      const back = c.splitFrom.rows.filter((r) => !c.yours.removed[itemId.row(r.id)] && !from.rows.some((have) => have.id === r.id))
      for (const r of back) {
        // Into the groups it had there that are there still
        const { in: was, ...rest } = r
        const into = Object.fromEntries(
          Object.entries(was ?? {})
            .map(([col, ids]) => [col, ids.filter((id) => from.columns.find((x) => x.id === col && x.kind === "grouping")?.groups?.some((g) => g.id === id))] as const)
            .filter(([, ids]) => ids.length),
        )
        from.rows.push(Object.keys(into).length ? { ...rest, in: into } : rest)
        const cell = itemId.cell(r.id, QUESTION_COLUMN)
        const edit = c.yours.edits[cell]
        if (edit) from.yours.edits[cell] = edit
        delete from.yours.removed[itemId.row(r.id)]
      }
      // The group comes back with them
      if (c.splitFrom.group) delete from.yours.removed[itemId.group(c.splitFrom.group.column, c.splitFrom.group.id)]
      if (c.splitFrom.asked && !from.alsoAsked?.some((a) => sameWords(a.text, c.splitFrom!.asked!.text))) from.alsoAsked = [...(from.alsoAsked ?? []), c.splitFrom.asked]
      from.updatedAt = now
      await this.save(from)
      await this.record(from.id, { at: now, by: "you", why: `Put back from ${c.id}`, items: back.map((r) => itemId.row(r.id)) })
      await this.toTrash(c.id, now)
      this.services.changed?.(c.id, null)
      this.services.changed?.(from.id, from)
      return from
    })
  }

  // To .owlit/trash/<stamp>-thread-<id>/, whole, so undelete() can put it back
  delete(id: string) {
    return this.serial.run(async () => {
      await this.get(id)
      await this.toTrash(id)
      this.services.changed?.(id, null)
      return null
    })
  }

  undelete(id: string) {
    return this.serial.run(async () => {
      if (await this.load(id)) throw new RpcFailure(RpcErrorCode.Conflict, t`That thread is already here.`, { id })
      const suffix = `-thread-${id}`
      const entry = (await readdir(this.trashDir).catch(() => [] as string[])).filter((n) => n.endsWith(suffix)).sort().reverse()[0]
      if (!entry) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread is no longer in the trash.`, { id })
      await mkdir(this.dir, { recursive: true })
      await rename(path.join(this.trashDir, entry), path.join(this.dir, id))
      const c = await this.get(id)
      this.services.changed?.(id, c)
      return c
    })
  }

  // Undo of an agent's write: the thread as it was before, with what the user did since kept (their
  // rewrites and removals are theirs, not the agent's). A write that started the thread is undone by
  // putting the thread in the trash. What it replaces is kept as a version too, so the undo can be
  // undone.
  restoreVersion(id: string, content: string, existed: boolean, meta: { chatId?: string }) {
    return this.serial.run(async () => {
      const now = await this.load(id)
      const redo = await this.versions.saveThread(id, now ? JSON.stringify(now) : null, { ...meta, by: "undo" })
      if (!existed) {
        if (now) await this.toTrash(id)
        this.services.changed?.(id, null)
      } else {
        const back = upgradeThread(JSON.parse(content))
        const c: Thread = { ...back, yours: now?.yours ?? back.yours, seenAt: now?.seenAt ?? back.seenAt, watch: now?.watch ?? back.watch, updatedAt: Date.now() }
        await this.save(c)
        await this.record(id, { at: c.updatedAt, by: "undo", items: [] })
        this.services.changed?.(id, c)
      }
      return { redoId: redo.id }
    })
  }

  // ---- About: Owlit's work in batches ----

  // The searches a write rests on: those its chat or run made since it last wrote (here or to another
  // thread), or in the last hours when it hasn't
  private async searchesFor(id: string, input: ThreadWrite, now: number) {
    const by = input.chatId ? `chat:${input.chatId}` : input.run ? `run:${input.run}` : undefined
    if (!by || !this.services.searches) return []
    let since = this.attributed.get(by)
    if (since === undefined) {
      // After a restart: the same run's or chat's last write here
      const key = input.chatId ? `chat:${input.chatId}` : undefined
      const last = (await this.history(id)).findLast((l) => (input.run ? l.run === input.run : l.by === key))
      since = Math.max(last?.at ?? 0, now - SEARCHES_SINCE_MS)
    }
    this.attributed.set(by, now)
    return (await this.services.searches(by, since)).map(({ at, query, source, results }) => ({ at, query, source, results }))
  }

  // Owlit's writes in batches: a background run's writes are one, a chat's writes close together are one.
  // Threads from before runs were recorded group Owlit's writes the same way by time.
  async about(id: string): Promise<ThreadBatch[]> {
    const c = await this.get(id)
    const columns = new Map(c.columns.map((col) => [col.id, col]))
    const titles = new Map(c.rows.map((r) => [r.id, r.paper.title]))
    const batches: (ThreadBatch & { key: string; last: number; rows: Set<string>; lines: HistoryLine[] })[] = []
    for (const line of await this.history(id)) {
      if (line.by === "you" || line.by === "undo") continue
      const key = line.run ?? line.by
      let batch = batches.at(-1)
      if (!batch || batch.key !== key || (!line.run && line.at - batch.last > BATCH_GAP_MS)) {
        const kind = line.run?.split(":")[0]?.replace(/^threads\./, "")
        const trigger: ThreadBatch["trigger"] = kind && ["gather", "more", "check", "read", "reread", "fill"].includes(kind) ? (kind as ThreadBatch["trigger"]) : line.by.startsWith("chat:") ? "chat" : "agent"
        batch = { key, last: line.at, rows: new Set(), lines: [], at: line.at, trigger, added: 0, answered: 0, columns: [], searches: [], notes: [] }
        if (trigger === "chat") batch.chatId = line.by.slice("chat:".length)
        batches.push(batch)
      }
      batch.last = line.at
      batch.lines.push(line)
      // Rows a line added; an older line doesn't record them, so for it the rows that came in at that moment
      for (const r of line.added ?? c.rows.filter((r) => r.addedAt === line.at).map((r) => r.id)) batch.rows.add(r)
      if (line.asked) batch.asked = line.asked
      if (line.note) batch.notes.push(line.note)
    }
    return batches
      .map(({ key: _key, last: _last, rows, lines, ...batch }) => {
        const answered = new Set<string>()
        const asked = new Set<string>()
        for (const line of lines)
          for (const item of line.items) {
            const m = /^cell:(.+):([^:]+)$/.exec(item)
            if (!m || rows.has(m[1]!)) continue
            answered.add(m[1]!)
            const col = columns.get(m[2]!)
            if (col && col.id !== QUESTION_COLUMN) asked.add(col.kind === "compare" ? (col.doc ?? col.question) : col.question)
          }
        const searches: ThreadSearch[] = lines.flatMap((l) => l.searches ?? []).map((s) => searchOf(s, rows, titles))
        return { ...batch, added: rows.size, answered: answered.size, columns: [...asked], searches }
      })
      .filter((b) => b.added || b.answered || b.searches.length || b.notes.length)
  }

  // ---- Inside ----

  private async blank(input: ThreadWrite, now: number): Promise<Thread> {
    const title = input.title!.trim()
    const taken = await readdir(this.dir).catch(() => [] as string[])
    return {
      version: 2,
      id: uniqueId(title, taken),
      title,
      asked: { text: input.asked!.trim(), at: now, ...(input.chatId ? { chatId: input.chatId } : {}), ...(input.docPath ? { docPath: input.docPath } : {}) },
      project: input.project ?? "",
      sources: [],
      memo: [],
      columns: [{ id: QUESTION_COLUMN, question: input.asked!.trim(), kind: "ask" }],
      rows: [],
      watch: false,
      createdAt: now,
      updatedAt: now,
      changedAt: {},
      seenAt: 0,
      yours: { edits: {}, removed: {}, placed: {}, merged: {} },
    }
  }

  private async load(id: string): Promise<Thread | undefined> {
    if (!/^[\w-]+$/.test(id)) return undefined
    const raw = await readJson<Parameters<typeof upgradeThread>[0]>(path.join(this.dir, id, FILE))
    if (!raw || raw.version !== 1) return raw
    // A thread kept before groupings were columns: upgraded once, on disk too, after whatever is writing now
    void this.serial.run(async () => {
      const again = await readJson<Parameters<typeof upgradeThread>[0]>(path.join(this.dir, id, FILE))
      if (again?.version === 1) await this.save(upgradeThread(again))
    })
    return upgradeThread(raw)
  }

  // Into .owlit/trash as <when>-thread-<id>, where undelete finds the latest
  private async toTrash(id: string, at = Date.now()) {
    await mkdir(this.trashDir, { recursive: true })
    await rename(path.join(this.dir, id), path.join(this.trashDir, `${at}-thread-${id}`))
  }

  private async save(c: Thread) {
    await writeJsonAtomic(path.join(this.dir, c.id, FILE), c)
  }

  private async record(id: string, line: HistoryLine) {
    await appendJsonl(path.join(this.dir, id, "history.jsonl"), line)
  }

  history(id: string): Promise<HistoryLine[]> {
    return readJsonl<HistoryLine>(path.join(this.dir, id, "history.jsonl"))
  }

}

// The groups a row is put in, as Owlit wrote them: each through check (the group it now stands for, or
// null to leave it out), each once, and not a group whose subgroup is there too
function placeIn(groups: ThreadGroup[], wanted: string[], check: (id: string) => string | null | undefined) {
  const ids = new Set<string>()
  for (const id of wanted.map((w) => w.trim()).filter(Boolean)) {
    const at = check(id)
    if (at) ids.add(at)
  }
  for (const id of [...ids]) {
    const parent = groups.find((g) => g.id === id)?.parent
    if (parent) ids.delete(parent)
  }
  return [...ids]
}

function sameCell(a: ThreadCell, b: ThreadCell) {
  return sameWords(a.text, b.text) && a.depth === b.depth && a.rel === b.rel && a.sentence === b.sentence && a.passage?.quote === b.passage?.quote
}

function freshId(prefix: string, taken: string[]) {
  let n = taken.length + 1
  while (taken.includes(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

// From the title's Latin words where it has some ("UIST 2026 papers" → uist-2026-papers), otherwise a
// short random id; unique among the threads there are
export function uniqueId(title: string, taken: string[]) {
  const words = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
  // A mostly Chinese title would be named after its one English word ("adhd"): random instead
  const letters = title.match(/\p{L}/gu)?.length ?? 0
  const latin = title.normalize("NFKD").match(/[a-z]/gi)?.length ?? 0
  const base = words.length >= 3 && latin * 2 >= letters ? words.slice(0, 48).replace(/-+$/, "") : `t-${randomBytes(3).toString("hex")}`
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

// A logged search as About says it: a paper followed by its references or citations is named by its title
function searchOf(s: { query: string; source: string; results: string[] }, kept: Set<string>, titles: Map<string, string>): ThreadSearch {
  const follow = /^(references|cited_by|similar) of (.+)$/.exec(s.query)
  const base = { source: s.source, found: s.results.length, kept: s.results.filter((id) => kept.has(id)).length }
  if (follow) return { ...base, kind: follow[1] as "references" | "cited_by" | "similar", query: follow[2]!, of: titles.get(follow[2]!) ?? follow[2]! }
  return { ...base, kind: s.source === "crossref" ? "listing" : "search", query: s.query }
}
