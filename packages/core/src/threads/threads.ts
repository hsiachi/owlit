import { t } from "@lingui/core/macro"
import {
  applyThreadEdit,
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
  type ThreadSearch,
  type ThreadPaper,
  type ThreadRun,
  type ThreadSize,
  type TaskPriority,
  type ThreadRow,
  type ThreadSummary,
  type ThreadWrite,
} from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"
import type { Versions } from "../docs/versions.ts"
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { defineTask, TaskFailure, type Scheduler, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import { checkPrompt, fillPrompt, gatherPrompt, morePrompt, readPrompt } from "./prompts.ts"
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

// What each kind of run may use besides owlit's read-only tools
const GATHER_TOOLS = /^(library_(search|related|journal)|thread_write)$/
const FILL_TOOLS = /^thread_write$/
// Reading in full means the paper is used: it joins the library
const READ_TOOLS = /^(library_add|thread_write)$/

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
      const row = (await this.load(id).catch(() => undefined))?.rows.find((r) => r.id === paperId)
      if (row) return row.paper
    }
    return undefined
  }

  async get(id: string): Promise<Thread> {
    const c = await this.load(id)
    if (!c) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
    return c
  }

  attach(tasks: Scheduler) {
    this.scheduler = tasks
  }

  // ---- Owlit's work in the background ----

  // The task kinds, when there is an agent to run them
  tasks(): TaskDefinition[] {
    const agent = this.services.agent
    if (!agent) return []
    const run = (kind: ThreadRun, allow: RegExp, prompt: (c: Thread, subject: string) => string, after?: (c: Thread) => Promise<void>) =>
      defineTask(kind, {
        lane: "agent",
        retries: 1,
        run: async (ctx) => {
          const c = await this.load(threadOfSubject(ctx.task.subject))
          if (!c) throw new TaskFailure("The thread is gone.")
          ctx.progress(0, undefined, kind)
          // What it did is in the thread, with Owlit's dots; its answer is only a line for the log
          const done = await agent(prompt(c, ctx.task.subject), ctx, allow, `${kind}:${ctx.task.id}`)
          if (process.env.OWLIT_LOG_AGENTS) console.log(`[threads] ${kind} ${ctx.task.subject}: ${done.text.trim().split("\n").pop()}`)
          await after?.(c)
        },
      })
    return [
      run("threads.gather", GATHER_TOOLS, (c) => gatherPrompt(c, c.size ?? "few")),
      run("threads.more", GATHER_TOOLS, (c) => morePrompt(c)),
      run("threads.fill", FILL_TOOLS, (c, subject) => {
        const column = c.columns.find((col) => col.id === subject.split(":")[1])
        if (!column) throw new TaskFailure("The column is gone.")
        return fillPrompt(c, column)
      }),
      run("threads.read", READ_TOOLS, (c) => readPrompt(c)),
      run("threads.check", GATHER_TOOLS, (c) => checkPrompt(c, c.checkedAt ?? c.createdAt), (c) => this.checked(c.id)),
    ]
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

      // Rows: new papers, and answers for the ones there
      const added: string[] = []
      let updated = 0
      const left: string[] = []
      for (const r of input.rows ?? []) {
        if (c.yours.removed[itemId.row(r.id)]) {
          left.push(r.id)
          continue
        }
        let row = c.rows.find((have) => have.id === r.id)
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
          const was = row.cells[col]
          const next: ThreadCell = { ...cell, text, at: now, ...(passage && cell.depth === "full" ? { passage } : {}) }
          if (cell.depth !== "full") delete next.passage
          if (was && sameCell(was, next)) continue
          row.cells[col] = next
          touched = true
          // A cell the user rewrote keeps their words; Owlit's new answer waits underneath without a dot
          mark(itemId.cell(r.id, col), !c.yours.edits[itemId.cell(r.id, col)])
        }
        if (r.group !== undefined && r.group !== row.group) {
          row.group = r.group || undefined
          touched = true
          mark(itemId.row(r.id), false)
        }
        if (touched && !changed.has(itemId.row(r.id))) updated++
      }
      for (const id of input.removeRows ?? []) {
        const at = c.rows.findIndex((r) => r.id === id)
        if (at < 0) continue
        c.rows.splice(at, 1)
        changed.add(itemId.row(id))
      }

      // Groups: the whole grouping as Owlit means it now. Rows in a group that is gone fall out of it.
      if (input.groups) {
        const ids = new Set(input.groups.map((g) => g.id))
        for (const g of input.groups) if (g.parent && !ids.has(g.parent)) problems.push(`Group ${g.id} sits under ${g.parent}, which isn't one of the groups.`)
        for (const g of input.groups) {
          const was = c.groups.find((have) => have.id === g.id)
          if (!was || was.name !== g.name || was.one !== g.one || was.parent !== g.parent) mark(itemId.group(g.id))
        }
        c.groups = input.groups.map((g) => ({ ...g }))
        for (const row of c.rows) if (row.group && !ids.has(row.group)) delete row.group
      }
      for (const r of input.rows ?? []) {
        const row = c.rows.find((have) => have.id === r.id)
        if (row?.group && !c.groups.some((g) => g.id === row.group)) problems.push(`Row ${r.id} is put in group ${row.group}, which isn't one of the groups.`)
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
      if (!fresh && !changed.size) return { id: c.id, title: shownThread(c).title, added: 0, updated: 0, left }

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
      return { id: c.id, title, added: added.length, updated, left }
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
      // Looking changes nothing worth a line in the history, nor the order of the list
      if (edit.op !== "seen") {
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
  // there is no memo yet, since Owlit's reading was of the other thread.
  split(id: string, rowIds: string[], asked: string) {
    return this.serial.run(async () => {
      const from = await this.get(id)
      const now = Date.now()
      const rows = from.rows.filter((r) => rowIds.includes(r.id))
      if (!rows.length) throw new RpcFailure(RpcErrorCode.NotFound, t`Those papers aren't in the thread any more.`)
      const question = asked.trim() || from.asked.text
      const c: Thread = {
        ...(await this.blank({ asked: question, title: question }, now)),
        project: from.project,
        sources: from.sources,
        // Only the question's own answers: the other thread's columns and groups don't come along
        rows: rows.map(({ group: _group, ...r }): ThreadRow => {
          const answer = r.cells[QUESTION_COLUMN]
          return { ...r, cells: answer ? { [QUESTION_COLUMN]: answer } : {} }
        }),
      }
      const taken = from.alsoAsked?.find((a) => sameWords(a.text, question))
      c.splitFrom = { id: from.id, rows, ...(taken ? { asked: taken } : {}) }
      from.rows = from.rows.filter((r) => !rowIds.includes(r.id))
      from.alsoAsked = from.alsoAsked?.filter((a) => a !== taken)
      from.updatedAt = now
      await this.save(c)
      await this.save(from)
      await this.record(c.id, { at: now, by: "you", why: `Kept separate from ${from.id}`, items: rows.map((r) => itemId.row(r.id)) })
      await this.record(from.id, { at: now, by: "you", why: `Moved to ${c.id}`, items: rows.map((r) => itemId.row(r.id)) })
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
        const group = r.group && from.groups.some((g) => g.id === r.group) ? r.group : undefined
        const { group: _group, ...rest } = r
        from.rows.push(group ? { ...rest, group } : rest)
        const cell = itemId.cell(r.id, QUESTION_COLUMN)
        const edit = c.yours.edits[cell]
        if (edit) from.yours.edits[cell] = edit
        delete from.yours.removed[itemId.row(r.id)]
      }
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
        const back = JSON.parse(content) as Thread
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
        const trigger: ThreadBatch["trigger"] = kind && ["gather", "more", "check", "read", "fill"].includes(kind) ? (kind as ThreadBatch["trigger"]) : line.by.startsWith("chat:") ? "chat" : "agent"
        batch = { key, last: line.at, rows: new Set(), lines: [], at: line.at, trigger, added: 0, answered: 0, columns: [], searches: [], notes: [] }
        if (trigger === "chat") batch.chatId = line.by.slice("chat:".length)
        batches.push(batch)
      }
      batch.last = line.at
      batch.lines.push(line)
      // Rows a line added: recorded since batches were; before, the rows that came in at that moment
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
      version: 1,
      id: uniqueId(title, taken),
      title,
      asked: { text: input.asked!.trim(), at: now, ...(input.chatId ? { chatId: input.chatId } : {}), ...(input.docPath ? { docPath: input.docPath } : {}) },
      project: input.project ?? "",
      sources: [],
      memo: [],
      columns: [{ id: QUESTION_COLUMN, question: input.asked!.trim(), kind: "ask" }],
      rows: [],
      groups: [],
      watch: false,
      createdAt: now,
      updatedAt: now,
      changedAt: {},
      seenAt: 0,
      yours: { edits: {}, removed: {} },
    }
  }

  private async load(id: string): Promise<Thread | undefined> {
    if (!/^[\w-]+$/.test(id)) return undefined
    return readJson<Thread>(path.join(this.dir, id, FILE))
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
