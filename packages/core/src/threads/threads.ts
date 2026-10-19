import { t } from "@lingui/core/macro"
import {
  applyThreadEdit,
  type Change,
  type ChatAbout,
  type ChangeOrigin,
  GROUPING_COLUMN,
  groupingView,
  itemId,
  QUESTION_COLUMN,
  RpcErrorCode,
  sameWords,
  shownThread,
  summarize,
  type Thread,
  type ThreadBatch,
  type ThreadCell,
  type ThreadColumn,
  type ThreadEdit,
  type ThreadGroup,
  type ThreadOverrides,
  type ThreadSearch,
  type ThreadPaper,
  type ThreadSize,
  type ThreadRow,
  type PaperIds,
  type ThreadSummary,
  type ThreadWrite,
  upgradeThread,
} from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"
import type { Started } from "../chats/chats.ts"
import { newWriteId, type RecordInput, type Recorder } from "../changes/record.ts"
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
import { sameJson, Serial } from "../util.ts"
import { THREAD_RECIPES } from "../recipes/threads.ts"

// Threads: papers Owlit gathered for a question, in .owlit/threads/<id>/:
//
//   thread.json   the thread, with what the user did to it in `overrides`
//   history.jsonl     one line per agent write: which chat or run, which items, why, the searches it
//                     rests on (About)
//
// Owlit writes its own record without asking, but never over the user: a rewrite of theirs stays word for
// word whatever Owlit writes later, and what they removed stays out. Every change, Owlit's and the user's,
// goes in the change log one item at a time (a row, a cell, a group, a memo sentence, the title), with the
// item on each side, so an undo puts back that item alone and leaves what was done to others since.

export interface ThreadsServices {
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
  // Starts a chat owlit starts for the person (core.ts startFor), on the agent Settings picks for its work
  startChat?: (start: { about: ChatAbout; title: string; recipe: string }) => Promise<Started>
  // What a chat owlit started works on, by the chat's id; undefined for a chat the person typed into
  chatAbout?: (chatId: string) => Promise<ChatAbout | undefined>
}

interface HistoryLine {
  at: number
  by: string
  // The background run that wrote it, "<kind>:<task id>", in threads written before thread work was a chat
  run?: string
  // The recipe of the chat owlit started that wrote it (recipes/threads.ts)
  recipe?: string
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

// What About says set a batch going, by the recipe of the chat owlit started that wrote it
const RECIPE_TRIGGER: Record<string, ThreadBatch["trigger"]> = { gather: "gather", "find-more": "more", "ask-each": "fill", group: "fill", "read-in-full": "read" }

// Work started on a thread that changed it first (a new thread, a new column): the thread, and the chat
// doing the work
export interface ThreadStarted {
  thread: Thread
  chatId: string
}

type ThreadRecipe = keyof typeof THREAD_RECIPES

const FILE = "thread.json"

export class Threads {
  private readonly dir: string
  private readonly trashDir: string
  private readonly recorder: Recorder
  private readonly services: ThreadsServices
  private readonly serial = new Serial()
  // When each chat's or run's searches were last given to a write
  private attributed = new Map<string, number>()

  constructor(owlitDir: string, parts: { recorder: Recorder }, services: ThreadsServices = {}) {
    this.dir = path.join(owlitDir, "threads")
    this.trashDir = path.join(owlitDir, "trash")
    this.recorder = parts.recorder
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

  // ---- Owlit's work on a thread: a chat owlit starts about it ----

  // The rows Read in full reads: answered from their abstracts or titles, with a PDF to be had (a free
  // one the search found, or the paper's text in the library already). The thread's button counts the
  // same rows (app/src/features/threads/components/Work.tsx), so it says what the chat will do.
  async toRead(c: Thread): Promise<string[]> {
    const rows = c.rows.filter((r) => Object.values(r.cells).every((cell) => cell.depth !== "full"))
    const hasText = this.services.hasText
    const can = await Promise.all(rows.map(async (r) => r.paper.openPdf || (hasText ? await hasText(r.id, r.paper.ids) : false)))
    return rows.filter((_, i) => can[i]).map((r) => r.id)
  }

  // A recipe written out for this thread (recipes/threads.ts), for owlit_help. column: the column ask-each
  // or group fills, by its id or its question; lookFor: what find-more looks for this time
  async recipe(name: ThreadRecipe, id: string, opts: { column?: string; lookFor?: string } = {}): Promise<string> {
    const c = await this.get(id)
    let column: ThreadColumn | undefined
    if (name === "ask-each" || name === "group") {
      const grouping = name === "group"
      const want = opts.column?.trim() ?? ""
      column = c.columns.find((col) => (col.kind === "grouping") === grouping && (col.id === want || sameWords(col.question, want)))
      if (!column)
        throw new RpcFailure(
          RpcErrorCode.InvalidParams,
          grouping
            ? `There is no grouping "${want}" in thread ${id}: start it with thread_write new_grouping, then ask for this recipe with its id.`
            : `There is no column "${want}" in thread ${id}: add the question with thread_write columns, then ask for this recipe with its id.`,
        )
    }
    return this.recipeFor(c, name, { ...(column ? { column } : {}), ...(opts.lookFor ? { lookFor: opts.lookFor } : {}) })
  }

  private async recipeFor(c: Thread, name: ThreadRecipe, opts: { column?: ThreadColumn; lookFor?: string }) {
    const lookFor = opts.lookFor?.trim()
    return THREAD_RECIPES[name].text({
      thread: c,
      withText: await this.withText(c),
      toRead: name === "read-in-full" ? await this.toRead(c) : [],
      ...(lookFor && !sameWords(lookFor, c.asked.text) ? { lookFor } : {}),
      ...(opts.column ? { column: opts.column } : {}),
    })
  }

  // Starts the work on a thread: a chat owlit starts for the person about the thread, with the recipe as
  // its first message; its id. Never inside this.serial: the chat's agent writes the thread through it.
  private async begin(c: Thread, name: ThreadRecipe, opts: { column?: ThreadColumn; lookFor?: string } = {}): Promise<string> {
    const start = this.services.startChat
    if (!start) throw new RpcFailure(RpcErrorCode.Unavailable, t`Owlit can't work on threads here.`)
    const about: ChatAbout = { kind: "thread", id: c.id, recipe: name, ...(opts.column ? { column: opts.column.id } : {}) }
    return (await start({ about, title: shownThread(c).title, recipe: await this.recipeFor(c, name, opts) })).chatId
  }

  // The thread's rows whose full text owlit has: Owlit answers those from it from the start
  private async withText(c: Thread): Promise<string[]> {
    const hasText = this.services.hasText
    if (!hasText) return []
    const has = await Promise.all(c.rows.map((r) => hasText(r.id, r.paper.ids)))
    return c.rows.filter((_, i) => has[i]).map((r) => r.id)
  }

  // Owlit gathers papers for a question: the thread is there at once, titled by the question until
  // Owlit names it, and a chat about it fills it
  async gather(input: { question: string; project?: string; size: ThreadSize }, caller: Caller): Promise<ThreadStarted> {
    const thread = await this.serial.run(async () => {
      const now = Date.now()
      const question = input.question.trim()
      if (!question) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to collect papers on.`)
      const c: Thread = { ...(await this.blank({ asked: question, title: question, project: input.project ?? "" }, now)), size: input.size }
      await this.save(c)
      await this.recorder.record(caller, { action: "create", target: { kind: "thread", path: c.id } }, { quiet: true })
      this.services.changed?.(c.id, c)
      return c
    })
    return { thread, chatId: await this.begin(thread, "gather") }
  }

  // more: with what to look for this time when it isn't the thread's question, kept on the thread as one
  // more question asked (About shows it) and told to the chat that does it
  async start(id: string, run: "more" | "read", caller: Caller, what?: string): Promise<{ chatId: string }> {
    const asked = what?.trim()
    const c = await this.serial.run(async () => {
      const c = await this.get(id)
      if (run === "more" && asked && !sameWords(asked, c.asked.text) && !c.alsoAsked?.some((a) => sameWords(a.text, asked))) {
        const before = structuredClone(c)
        c.alsoAsked = [...(c.alsoAsked ?? []), { text: asked, at: Date.now() }]
        c.updatedAt = Date.now()
        await this.save(c)
        await this.recordItems(caller, before, c, ["alsoAsked"])
        this.services.changed?.(c.id, c)
      }
      return c
    })
    return { chatId: await this.begin(c, run === "more" ? "find-more" : "read-in-full", run === "more" && asked ? { lookFor: asked } : {}) }
  }

  // A new column: one question for every paper, answered in a chat about the thread
  async ask(id: string, question: string, caller: Caller): Promise<ThreadStarted> {
    const [thread, column] = await this.serial.run(async () => {
      const c = await this.get(id)
      const q = question.trim()
      if (!q) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to ask of each paper.`)
      let column = c.columns.find((col) => sameWords(col.question, q))
      if (!column) {
        const before = structuredClone(c)
        column = { id: freshId("c", c.columns.map((col) => col.id)), question: q, kind: "ask" }
        c.columns.push(column)
        c.updatedAt = Date.now()
        await this.save(c)
        await this.recordItems(caller, before, c, [`column:${column.id}`])
        this.services.changed?.(c.id, c)
      } else if (column.hidden) {
        const before = structuredClone(c)
        column.hidden = false
        await this.save(c)
        await this.recordItems(caller, before, c, [`column:${column.id}`])
        this.services.changed?.(c.id, c)
      }
      return [c, column] as const
    })
    return { thread, chatId: await this.begin(thread, "ask-each", { column }) }
  }

  // A new way of grouping the papers: a hidden grouping column with the user's words as its question,
  // filled in a chat about the thread. The same words again fill the grouping there is (Ask again).
  async group(id: string, question: string, caller: Caller): Promise<ThreadStarted> {
    const [thread, column] = await this.serial.run(async () => {
      const c = await this.get(id)
      const q = question.trim()
      if (!q) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Say what to group the papers by.`)
      let column = c.columns.find((col) => col.kind === "grouping" && sameWords(col.question, q))
      if (!column) {
        const before = structuredClone(c)
        column = { id: freshId("g", c.columns.map((col) => col.id)), question: q, kind: "grouping", hidden: true, groups: [] }
        c.columns.push(column)
        c.updatedAt = Date.now()
        await this.save(c)
        await this.recordItems(caller, before, c, [`column:${column.id}`])
        this.services.changed?.(c.id, c)
      }
      return [c, column] as const
    })
    return { thread, chatId: await this.begin(thread, "group", { column }) }
  }

  // Fills what a column still lacks (Ask again)
  async fill(id: string, columnId: string): Promise<{ chatId: string }> {
    const c = await this.get(id)
    const column = c.columns.find((col) => col.id === columnId)
    if (!column) throw new RpcFailure(RpcErrorCode.NotFound, t`That column isn't there any more.`)
    return { chatId: await this.begin(c, column.kind === "grouping" ? "group" : "ask-each", { column }) }
  }

  // A column that sets every paper against sentences the user picked from a doc of theirs. The column is
  // theirs (they chose the sentences); its cells are Owlit's reading.
  async compare(id: string, doc: string, sentences: string[], caller: Caller): Promise<ThreadStarted> {
    const [thread, column] = await this.serial.run(async () => {
      const c = await this.get(id)
      const lines = sentences.map((text) => text.trim()).filter(Boolean)
      if (!lines.length) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Pick at least one sentence to compare with.`)
      const before = structuredClone(c)
      const column = { id: freshId("c", c.columns.map((col) => col.id)), question: doc, kind: "compare" as const, doc, sentences: lines.map((text, i) => ({ id: `l${i + 1}`, text })) }
      c.columns.push(column)
      c.updatedAt = Date.now()
      await this.save(c)
      await this.recordItems(caller, before, c, [`column:${column.id}`])
      this.services.changed?.(c.id, c)
      return [c, column] as const
    })
    return { thread, chatId: await this.begin(thread, "ask-each", { column }) }
  }

  // ---- Owlit's writes ----

  write(input: ThreadWrite, caller: Caller) {
    return this.serial.run(async () => {
      const now = Date.now()
      const existing = input.id ? await this.load(input.id) : undefined
      if (input.id && !existing) throw new RpcFailure(RpcErrorCode.NotFound, `There is no thread ${input.id}; leave id out to start one.`)
      const problems: string[] = []
      if (!existing && !input.asked?.trim()) problems.push("A new thread needs asked: the question as the user put it.")
      if (!existing && !input.title?.trim()) problems.push("A new thread needs a title: a short, neutral name for what it gathers.")
      if (problems.length) throw new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)

      const c: Thread = existing ? structuredClone(existing) : await this.blank(input, now)
      const fresh = !existing
      // Every item the write changed goes in the history and the log (which of them carry a dot is
      // threadDot's to say)
      const changed = new Set<string>()
      const mark = (item: string) => changed.add(item)

      if (existing && input.title?.trim() && input.title.trim() !== c.title) {
        c.title = input.title.trim()
        mark(itemId.title())
      }
      if (input.project !== undefined && !existing) c.project = input.project
      const asked = input.asked?.trim()
      if (existing && asked && !sameWords(asked, c.asked.text) && !c.alsoAsked?.some((a) => sameWords(a.text, asked))) {
        c.alsoAsked = [...(c.alsoAsked ?? []), { text: asked, at: now, ...(input.chatId ? { chatId: input.chatId } : {}) }]
        changed.add("alsoAsked")
      }
      if (input.sources?.length) c.sources = [...new Set([...c.sources, ...input.sources])]

      // Columns: new questions to ask of every paper
      for (const col of input.columns ?? []) {
        const question = col.question.trim()
        if (!question) continue
        if (c.columns.some((have) => have.id === col.id || sameWords(have.question, question))) continue
        const id = col.id?.trim() || freshId("c", c.columns.map((x) => x.id))
        c.columns.push({ id, question, kind: "ask" })
        mark(`column:${id}`)
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
        mark(`column:${grouping.id}`)
      } else if (wantsGroups && input.grouping && grouping?.kind !== "grouping") problems.push(`There is no grouping ${input.grouping}; leave grouping out for the thread's own (Topic), or give new_grouping to start one.`)
      else if (wantsGroups && !grouping) {
        let id = GROUPING_COLUMN
        for (let n = 2; c.columns.some((col) => col.id === id); n++) id = `${GROUPING_COLUMN}${n}`
        grouping = { id, question: "Topic", kind: "grouping", hidden: true, groups: [] }
        c.columns.push(grouping)
        mark(`column:${id}`)
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
          const into = c.overrides.merged[`${col.id}:${g.id}`]
          if (into !== undefined) userKept.push(`The user merged group ${named(g.id)} into ${named(into)}: papers you put in ${g.id} go in ${into}. Leave ${g.id} out.`)
          else if (c.overrides.removed[itemId.group(col.id, g.id)]) userKept.push(`The user ungrouped ${named(g.id)}: it stays gone, and papers you put in it aren't in it. Leave it out.`)
        }
        // Groups the user put papers in or merged others into, which Owlit's grouping leaves out
        const held = new Set([
          ...Object.entries(c.overrides.placed)
            .filter(([key, p]) => p.in && key.startsWith(`${col.id}:`))
            .map(([key]) => key.slice(key.lastIndexOf(":") + 1)),
          ...Object.entries(c.overrides.merged)
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
          changed.add(itemId.row(row.id))
        }
      }
      const view = col ? groupingView(c, col) : undefined

      // Rows: new papers, and answers for the ones there
      const added: string[] = []
      let updated = 0
      const left: string[] = []
      for (const asked of input.rows ?? []) {
        if (c.overrides.removed[itemId.row(asked.id)]) {
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
        } else if (r.foundBy && !row.foundBy) {
          row.foundBy = r.foundBy
          changed.add(itemId.row(r.id))
        }
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
          mark(itemId.cell(r.id, col))
        }
        if (col && (r.group !== undefined || r.groups !== undefined)) {
          const ids = placeIn(col.groups ?? [], r.groups ?? (r.group ? [r.group] : []), (id) => {
            // A group the user merged or ungrouped: kept as Owlit wrote it while Owlit still has the group,
            // so the user's change shows over it and their Undo finds it; otherwise where it went
            const into = c.overrides.merged[`${col.id}:${id}`]
            const ungrouped = !!c.overrides.removed[itemId.group(col.id, id)]
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
            mark(itemId.row(r.id))
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
        const removedTexts = Object.entries(c.overrides.removed)
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
          if (c.overrides.edits[itemId.memo(s.id)] && !next.some((n) => n.id === s.id)) next.splice(Math.min(i, next.length), 0, s)
        })
        for (const s of c.memo) if (!next.some((n) => n.id === s.id)) changed.add(itemId.memo(s.id))
        c.memo = next
      }

      if (problems.length) throw new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)
      if (!fresh && !changed.size) return { id: c.id, title: shownThread(c).title, added: 0, updated: 0, left, userKept }

      c.updatedAt = now
      await this.save(c)
      const searches = await this.searchesFor(c.id, input, now)
      const recipe = input.chatId ? (await this.services.chatAbout?.(input.chatId))?.recipe : undefined
      await this.record(c.id, {
        at: now,
        by: input.chatId ? `chat:${input.chatId}` : "agent",
        ...(input.run && !input.chatId ? { run: input.run } : {}),
        ...(recipe ? { recipe } : {}),
        ...(input.why ? { why: input.why } : {}),
        items: [...changed],
        ...(added.length ? { added } : {}),
        ...(asked && changed.has("alsoAsked") ? { asked } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        ...(searches.length ? { searches } : {}),
      })
      this.services.changed?.(c.id, c)
      const title = shownThread(c).title
      // One write is one undo on the chat's card: its entries share the tool call's id, or one of their own
      const origin = { writeId: (caller.kind !== "window" && caller.toolCallId) || newWriteId(), ...(input.chatId ? { chatId: input.chatId } : {}) }
      const entries = fresh
        ? [await this.recorder.record(caller, { action: "create", target: { kind: "thread", path: c.id }, origin }, { quiet: true })]
        : await this.recordItems(caller, existing!, c, [...changed], origin)
      // Said once per write and only for a chat, which shows it under the answer; a run's write is shown
      // with the run
      if (input.chatId && entries[0]) this.recorder.say(entries[0], { label: title, thread: { rows: added, updated, ...(asked ? { asked } : {}) } })
      return { id: c.id, title, added: added.length, updated, left, userKept }
    })
  }

  // ---- The user's changes ----

  edit(id: string, edit: ThreadEdit, caller: Caller) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      const before = structuredClone(c)
      const now = Date.now()
      const done = applyThreadEdit(c, edit, now)
      if ("problem" in done) {
        if (done.problem === "empty") throw new RpcFailure(RpcErrorCode.InvalidParams, t`Write something, or remove it instead.`)
        if (done.problem === "row") throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the thread any more.`)
        if (done.problem === "group") throw new RpcFailure(RpcErrorCode.NotFound, t`That group isn't there any more.`)
        throw new RpcFailure(RpcErrorCode.NotFound, t`That isn't in the thread any more.`)
      }
      // How the user looks changes nothing worth an entry in the log, nor the order of the list
      if (edit.op !== "view") {
        c.updatedAt = now
        await this.recordItems(caller, before, c, done.items.length ? done.items : [edit.op])
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
  // chatId: the chat whose result card asked for it, which then finds the split in the log
  split(id: string, rowIds: string[], asked: string, group: { column: string; id: string } | undefined, caller: Caller, chatId?: string) {
    return this.serial.run(async () => {
      const from = await this.get(id)
      const was = structuredClone(from)
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
        if (name !== undefined) from.overrides.removed[itemId.group(col.id, group.id)] = { text: name, at: now }
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
      const origin = { writeId: newWriteId(), ...(chatId ? { chatId } : {}) }
      await this.recorder.record(caller, { action: "create", target: { kind: "thread", path: c.id }, origin }, { quiet: true })
      await this.recordItems(caller, was, from, [...rows.map((r) => itemId.row(r.id)), ...(group ? [itemId.group(group.column, group.id)] : [])], origin)
      this.services.changed?.(from.id, from)
      this.services.changed?.(c.id, c)
      return c
    })
  }

  // Undo of split(): the rows go back as they were in the thread they came from, with what the user
  // wrote in their answers since; one they removed here stays out, and so does one already back there
  unsplit(id: string, caller: Caller, chatId?: string) {
    return this.serial.run(async () => {
      const c = await this.get(id)
      if (!c.splitFrom) throw new RpcFailure(RpcErrorCode.NotFound, t`This thread wasn't kept separate from another.`)
      const from = await this.load(c.splitFrom.id)
      if (!from) throw new RpcFailure(RpcErrorCode.NotFound, t`The thread these papers came from is gone.`)
      const was = structuredClone(from)
      const now = Date.now()
      const back = c.splitFrom.rows.filter((r) => !c.overrides.removed[itemId.row(r.id)] && !from.rows.some((have) => have.id === r.id))
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
        const edit = c.overrides.edits[cell]
        if (edit) from.overrides.edits[cell] = edit
        delete from.overrides.removed[itemId.row(r.id)]
      }
      // The group comes back with them
      if (c.splitFrom.group) delete from.overrides.removed[itemId.group(c.splitFrom.group.column, c.splitFrom.group.id)]
      if (c.splitFrom.asked && !from.alsoAsked?.some((a) => sameWords(a.text, c.splitFrom!.asked!.text))) from.alsoAsked = [...(from.alsoAsked ?? []), c.splitFrom.asked]
      from.updatedAt = now
      await this.save(from)
      await this.toTrash(c.id, now)
      const origin = { writeId: newWriteId(), ...(chatId ? { chatId } : {}) }
      await this.recordItems(caller, was, from, [...back.map((r) => itemId.row(r.id)), ...(c.splitFrom.group ? [itemId.group(c.splitFrom.group.column, c.splitFrom.group.id)] : [])], origin)
      await this.recorder.record(caller, { action: "delete", target: { kind: "thread", path: c.id }, origin }, { quiet: true })
      this.services.changed?.(c.id, null)
      this.services.changed?.(from.id, from)
      return from
    })
  }

  // To .owlit/trash/<stamp>-thread-<id>/, whole, so undelete() can put it back
  delete(id: string, caller: Caller) {
    return this.serial.run(async () => {
      await this.get(id)
      await this.toTrash(id)
      await this.recorder.record(caller, { action: "delete", target: { kind: "thread", path: id } }, { quiet: true })
      this.services.changed?.(id, null)
      return null
    })
  }

  undelete(id: string, caller: Caller) {
    return this.serial.run(async () => {
      const c = await this.fromTrash(id)
      await this.recorder.record(caller, { action: "create", target: { kind: "thread", path: id } }, { quiet: true })
      this.services.changed?.(id, c)
      return c
    })
  }

  // Undo of one item's entry (changes/undo.ts): the item goes back to `to`, but only while it still is
  // `expect`, what the entry left; recorded as the change that undoes the entry
  setItem(id: string, item: string, to: unknown, expect: unknown, caller: Caller, extra: Pick<RecordInput, "origin" | "undoes">) {
    return this.serial.run(async () => {
      const c = await this.load(id)
      if (!c) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
      const now = itemOf(c, item)
      // A row's paper is read through the Library's facts and saved so by the user's edits: what it
      // says doesn't make the row another one
      const bare = (v: unknown) => (item.startsWith("row:") && (v as { value?: object } | undefined)?.value ? { ...(v as object), value: { ...(v as { value: object }).value, paper: undefined } } : v)
      if (!sameJson(bare(now), bare(expect))) throw new RpcFailure(RpcErrorCode.Conflict, t`That changed in the thread since, so owlit left it as it is.`, { id, item })
      if (!putItem(c, item, to)) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the thread any more.`, { id, item })
      c.updatedAt = Date.now()
      await this.save(c)
      this.services.changed?.(c.id, c)
      const action = now === undefined ? "create" : to === undefined ? "delete" : "update"
      return this.recorder.record(caller, { action, target: { kind: "thread", path: id, part: item }, ...extra, ...(now !== undefined ? { before: now } : {}), ...(to !== undefined ? { after: to } : {}) })
    })
  }

  // Undo of a whole thread's entry: one that started it puts it in the trash, one that deleted it brings it
  // back from there. An update of the whole thread holds a snapshot in its content file, which nothing
  // reads: it is refused
  undoWhole(change: Change, caller: Caller, extra: Pick<RecordInput, "origin" | "undoes">) {
    return this.serial.run(async () => {
      const id = change.target.path
      if (change.action === "update") throw new RpcFailure(RpcErrorCode.Conflict, t`That change holds the whole thread at once, so it can't be undone.`, { id })
      if (change.action === "create") {
        if (!(await this.load(id))) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
        await this.toTrash(id)
        this.services.changed?.(id, null)
      } else this.services.changed?.(id, await this.fromTrash(id))
      return this.recorder.record(caller, { action: change.action === "create" ? "delete" : "create", target: { kind: "thread", path: id }, ...extra })
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

  // Owlit's writes in batches: a chat owlit started with a recipe is one however long it takes (Retry is
  // a turn in the same chat), as a background run's was; a chat's writes close together are one. Threads
  // from before runs were recorded group Owlit's writes the same way by time.
  async about(id: string): Promise<ThreadBatch[]> {
    const c = await this.get(id)
    const columns = new Map(c.columns.map((col) => [col.id, col]))
    const titles = new Map(c.rows.map((r) => [r.id, r.paper.title]))
    const batches: (ThreadBatch & { key: string; last: number; rows: Set<string>; lines: HistoryLine[] })[] = []
    for (const line of await this.history(id)) {
      const key = line.run ?? line.by
      let batch = batches.at(-1)
      if (!batch || batch.key !== key || (!line.run && !line.recipe && line.at - batch.last > BATCH_GAP_MS)) {
        const kind = line.run?.split(":")[0]?.replace(/^threads\./, "") ?? (line.recipe ? RECIPE_TRIGGER[line.recipe] : undefined)
        const trigger: ThreadBatch["trigger"] = kind && ["gather", "more", "read", "fill"].includes(kind) ? (kind as ThreadBatch["trigger"]) : line.by.startsWith("chat:") ? "chat" : "agent"
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

  // A change to these items, an entry for each that changed, sharing one writeId
  private async recordItems(caller: Caller, before: Thread, after: Thread, items: string[], origin: Partial<ChangeOrigin> = { writeId: newWriteId() }) {
    const entries: Change[] = []
    for (const item of new Set(items)) {
      const was = itemOf(before, item)
      const now = itemOf(after, item)
      if (sameJson(was, now)) continue
      const action = was === undefined ? "create" : now === undefined ? "delete" : "update"
      entries.push(
        await this.recorder.record(
          caller,
          { action, target: { kind: "thread", path: after.id, part: item }, origin, ...(was !== undefined ? { before: was } : {}), ...(now !== undefined ? { after: now } : {}) },
          { quiet: true },
        ),
      )
    }
    return entries
  }

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
      createdAt: now,
      updatedAt: now,
      overrides: { edits: {}, removed: {}, placed: {}, merged: {} },
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

  // The latest of this thread in .owlit/trash, back in its place
  private async fromTrash(id: string) {
    if (await this.load(id)) throw new RpcFailure(RpcErrorCode.Conflict, t`That thread is already here.`, { id })
    const suffix = `-thread-${id}`
    const entry = (await readdir(this.trashDir).catch(() => [] as string[])).filter((n) => n.endsWith(suffix)).sort().reverse()[0]
    if (!entry) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread is no longer in the trash.`, { id })
    await mkdir(this.dir, { recursive: true })
    await rename(path.join(this.trashDir, entry), path.join(this.dir, id))
    return this.get(id)
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

// One item of a thread as the change log keeps it: Owlit's value, and the user's rewrite or removal of it
// that wins over that value. Items are named as itemId() names them, plus column:<id>, alsoAsked, and the
// thread's project. A row is kept without its cells and a column without its groups:
// those are items of their own. undefined when the thread has nothing of it.
function itemOf(c: Thread, item: string): unknown {
  const [kind, a, b] = item.split(":")
  const o = c.overrides
  let value: unknown
  if (item === itemId.title()) value = c.title
  else if (item === "asked") value = c.asked
  else if (item === "alsoAsked") value = c.alsoAsked
  else if (item === "project") value = c.project
  else if (kind === "memo") value = c.memo.find((s) => s.id === a)
  else if (kind === "cell") value = c.rows.find((r) => r.id === a)?.cells[b!]
  else if (kind === "column") {
    const col = c.columns.find((col) => col.id === a)
    if (col) {
      const { groups: _groups, ...rest } = col
      value = rest
    }
  } else if (kind === "row") {
    const row = c.rows.find((r) => r.id === a)
    const placed = Object.fromEntries(Object.entries(o.placed).filter(([key]) => key.split(":")[1] === a))
    if (row) {
      const { cells: _cells, ...rest } = row
      value = Object.keys(placed).length ? { ...rest, placed } : rest
    }
  } else if (kind === "group") {
    const group = c.columns.find((col) => col.id === a)?.groups?.find((g) => g.id === b)
    const merged = o.merged[`${a}:${b}`]
    value = group && (merged !== undefined ? { ...group, merged } : group)
  }
  const edit = o.edits[item]
  const removed = o.removed[item]
  if (value === undefined && !edit && !removed) return undefined
  return { ...(value !== undefined ? { value } : {}), ...(edit ? { edit } : {}), ...(removed ? { removed } : {}) }
}

// Sets one item to what itemOf gave for it (undefined: none of it), so itemOf reads that back. False when
// the item needs a row or grouping the thread no longer has.
function putItem(c: Thread, item: string, to: unknown): boolean {
  const { value, edit, removed } = (to ?? {}) as { value?: any; edit?: ThreadOverrides["edits"][string]; removed?: ThreadOverrides["removed"][string] }
  const [kind, a, b] = item.split(":")
  const o = c.overrides
  const put = <T extends { id: string }>(list: T[], id: string | undefined, next: T | undefined) => {
    const at = list.findIndex((x) => x.id === id)
    if (!next) return list.filter((x) => x.id !== id)
    if (at < 0) return [...list, next]
    return list.map((x, i) => (i === at ? next : x))
  }
  if (kind === "cell" || kind === "group") {
    const row = kind === "cell" ? c.rows.find((r) => r.id === a) : undefined
    const col = kind === "group" ? c.columns.find((x) => x.id === a && x.kind === "grouping") : undefined
    if (kind === "cell" && !row) return value === undefined
    if (kind === "group" && !col) return value === undefined
    if (row) {
      if (value) row.cells[b!] = value
      else delete row.cells[b!]
    }
    if (col) {
      const { merged, ...group } = (value ?? {}) as ThreadGroup & { merged?: string }
      col.groups = put(col.groups ?? [], b, value ? group : undefined)
      if (merged !== undefined) o.merged[`${a}:${b}`] = merged
      else delete o.merged[`${a}:${b}`]
    }
  } else if (item === itemId.title()) c.title = value ?? c.title
  else if (item === "asked") c.asked = value ?? c.asked
  else if (item === "alsoAsked") {
    if (value) c.alsoAsked = value
    else delete c.alsoAsked
  } else if (item === "project") c.project = value ?? ""
  else if (kind === "memo") c.memo = put(c.memo, a, value)
  else if (kind === "column") {
    const was = c.columns.find((col) => col.id === a)
    c.columns = put(c.columns, a, value && { ...value, ...(was?.groups ? { groups: was.groups } : value.kind === "grouping" ? { groups: [] } : {}) })
  } else if (kind === "row") {
    const was = c.rows.find((r) => r.id === a)
    const { placed, ...row } = (value ?? {}) as ThreadRow & { placed?: ThreadOverrides["placed"] }
    c.rows = put(c.rows, a, value ? { ...row, cells: was?.cells ?? {} } : undefined)
    for (const key of Object.keys(o.placed)) if (key.split(":")[1] === a) delete o.placed[key]
    Object.assign(o.placed, placed ?? {})
  }
  if (edit) o.edits[item] = edit
  else delete o.edits[item]
  if (removed) o.removed[item] = removed
  else delete o.removed[item]
  return true
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
