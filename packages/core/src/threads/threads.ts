import { t } from "@lingui/core/macro"
import {
  applyThreadEdit,
  type Change,
  type ChangeOrigin,
  GROUPING_COLUMN,
  itemId,
  keptPapers,
  plainLine,
  fromText,
  QUESTION_COLUMN,
  RpcErrorCode,
  sameWords,
  type StoredThread,
  summarize,
  type Thread,
  type ThreadBatch,
  type ThreadCell,
  type ThreadEdit,
  type ThreadGroup,
  type ThreadSearch,
  type ThreadPaper,
  type ThreadRead,
  type ThreadRow,
  type ThreadSummary,
  type ThreadWrite,
  type PaperIds,
  upgradeThread,
} from "@owlit/protocol"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"
import type { ChangeLog } from "../changes/log.ts"
import { newWriteId, type RecordInput, type Recorder } from "../changes/record.ts"
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
import { sameJson, Serial } from "../util.ts"

// Threads: Owlit's reports on the user's questions with the papers they rest on, in .owlit/threads/<id>/:
//
//   thread.json       the thread; each row names a Library paper by its id and keeps none of its facts
//   history.jsonl     what a write rests on that the change log doesn't keep: the searches, Owlit's
//                     note, the later question it was for (About)
//
// A thread is Owlit's: the user changes it by asking in a chat, and from a window only moves it to a
// project or chooses what its table is grouped by. It is given out with each row's paper as the Library
// has it (read()); what is saved is only what changed, never those facts. Every change goes in the change
// log one item at a time (a row, a cell, a group, the report, the title), with the item on each side, the
// entries of one write sharing its writeId, so the chat's card undoes a write whole and an item that
// changed since stays.

// What owlit itself does (an upgrade adding a thread's papers to the Library) is Owlit's
const OWLIT: Caller = { kind: "owlit" }

export interface ThreadsServices {
  // The searches a chat (chat:<id>) made since a moment
  searches?: (by: string, since: number) => Promise<{ at: number; query: string; source: string; results: string[] }[]>
  // What a paper is, by its id: the Library's record, or what a recent search found
  paper?: (id: string) => Promise<ThreadPaper | undefined>
  // Adds a paper the Library hasn't got, as the caller's, without fetching its PDF (that waits until
  // someone reads it); the Library's id for it
  addPaper?: (id: string, paper: ThreadPaper, caller: Caller) => Promise<string>
  // The search that showed a paper lately, for a new row's foundBy
  foundBy?: (id: string) => string | undefined
  // The 1-based page a quote is on in a paper's full text, word for word; null when it isn't there,
  // undefined when owlit has no text of the paper
  findPassage?: (paperId: string, quote: string) => Promise<number | null | undefined>
  // The library's id for a paper named by any id it goes by, undefined when it isn't in the library: a
  // search names a paper by its own id, which often isn't the library's (Library.canonical)
  canonical?: (id: string, ids?: PaperIds) => Promise<string | undefined>
  // A row's paper as the thread is read: the Library's facts, with the user's corrections; undefined when
  // the Library hasn't got it
  facts?: (id: string) => Promise<ThreadPaper | undefined>
  // A thread changed under the windows (null: deleted)
  changed?: (id: string, thread: ThreadRead | null) => void
  // How far a chat read a paper's text, from what core saw it read: the whole text, part of it, or
  // none so far (undefined)
  readDepth?: (chatId: string, paperId: string) => "full" | "part" | undefined
}

// A line of history.jsonl: what a write rests on that neither the thread nor the change log keeps (the
// searches its chat made since its last write, Owlit's note on what it couldn't reach, the later question
// it was for), named by the write's id in the change log. Only a write with one of those has a line.
interface HistoryLine {
  at: number
  // chat:<id>, or agent for a write that names no chat
  by: string
  writeId?: string
  asked?: string
  note?: string
  searches?: { at: number; query: string; source: string; results: string[] }[]
  // Lines from before the change log also name the items they changed and the rows they added, and what
  // set them going: a scheduler task as "<kind>:<task id>", or the recipe of a chat owlit started
  items?: string[]
  added?: string[]
  run?: string
  recipe?: string
}

// One write of Owlit's to the thread as About reads it
interface Write {
  at: number
  by: string
  // Its entries are in the change log; itemized: one at least names an item (an older write that started
  // a thread logged only that it did)
  logged: boolean
  itemized: boolean
  line?: HistoryLine
  added: Set<string>
  // Row and column of each answer it wrote
  answered: [string, string][]
  asked?: string
  notes: string[]
  searches: NonNullable<HistoryLine["searches"]>
}

// How far back a write looks for the searches it rests on, when nothing of the same chat came before
const SEARCHES_SINCE_MS = 6 * 3_600_000
// Writes of one chat this close together are one batch
const BATCH_GAP_MS = 30 * 60_000
// An older history line was appended just before its write's entries in the change log
const LINE_MATCH_MS = 60_000

// What About says set a batch going, by the recipe of the chat owlit started that wrote it (older lines)
const RECIPE_TRIGGER: Record<string, ThreadBatch["trigger"]> = { gather: "gather", "find-more": "more", "ask-each": "fill", group: "fill", "read-in-full": "read" }

const FILE = "thread.json"

export class Threads {
  private readonly dir: string
  private readonly trashDir: string
  private readonly recorder: Recorder
  private readonly changes: ChangeLog
  private readonly services: ThreadsServices
  private readonly serial = new Serial()
  // When each chat's searches were last given to a write
  private attributed = new Map<string, number>()

  constructor(owlitDir: string, parts: { recorder: Recorder; changes: ChangeLog }, services: ThreadsServices = {}) {
    this.dir = path.join(owlitDir, "threads")
    this.trashDir = path.join(owlitDir, "trash")
    this.recorder = parts.recorder
    this.changes = parts.changes
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

  // One thread as the list shows it, without reading its papers; undefined when it isn't there
  async summary(id: string): Promise<ThreadSummary | undefined> {
    const c = await this.load(id).catch(() => undefined)
    return c && summarize(c)
  }

  // The thread as it is read: each row's paper as the Library has it
  async get(id: string): Promise<ThreadRead> {
    const c = await this.load(id)
    if (!c) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
    return this.read(c)
  }

  // Each row with its paper's facts from the Library. A copy: what is saved is the thread without them.
  private async read(c: Thread): Promise<ThreadRead> {
    const facts = this.services.facts
    return { ...c, rows: await Promise.all(c.rows.map(async (r) => ({ ...r, paper: (await facts?.(r.id)) ?? { title: r.id, authors: [], ids: {} } }))) }
  }

  private async announce(c: Thread) {
    const changed = this.services.changed
    if (changed) changed(c.id, await this.read(c))
  }

  // The row that is this paper: by its id, or by the library's id the paper goes by
  private async rowOf(rows: ThreadRow[], paperId: string): Promise<ThreadRow | undefined> {
    const exact = rows.find((r) => r.id === paperId)
    if (exact || !rows.length) return exact
    const here = await this.services.canonical?.(paperId)
    return here ? rows.find((r) => r.id === here) : undefined
  }

  // ---- Owlit's writes ----

  // A write goes in as far as it can: a row with a problem is left out whole, a report that links a paper
  // the thread hasn't got stays as it was, and each is named in `left` for the agent to fix and write
  // again. It is refused whole when it can't be read at all (a new thread without its question, groups
  // that don't fit together) or when nothing in it could go in.
  write(given: ThreadWrite, caller: Caller) {
    // The chat a write is for is the caller's: a program names its chat only through its session's grant
    // (rpc/socket.ts), never in the params
    const chatId = caller.kind === "window" ? given.chatId : caller.chatId
    const { chatId: _named, ...rest } = given
    const input: ThreadWrite = { ...rest, ...(chatId ? { chatId } : {}) }
    return this.serial.run(async () => {
      const now = Date.now()
      const existing = input.id ? await this.load(input.id) : undefined
      if (input.id && !existing) throw new RpcFailure(RpcErrorCode.NotFound, `There is no thread ${input.id}; leave id out to start one.`)
      const refused: string[] = []
      if (!existing && !input.asked?.trim()) refused.push("A new thread needs asked: the question as the user put it.")
      if (!existing && !input.title?.trim()) refused.push("A new thread needs a title: a short, neutral name for what it gathers.")
      if (refused.length) throw refusal(refused)

      const c: Thread = existing ? structuredClone(existing) : await this.blank(input, now)
      const before = structuredClone(c)
      const fresh = !existing
      // Every item the write changed goes in the log (which of them carry a dot is threadDot's to say)
      const changed = new Set<string>()
      const mark = (item: string) => changed.add(item)
      const left: string[] = []

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

      // Groups: the whole of one grouping as Owlit means it now
      const wantsGroups = !!input.groups || (input.rows ?? []).some((r) => r.group !== undefined || r.groups !== undefined)
      const newGrouping = input.newGrouping?.trim()
      // The Topic grouping this write starts only because its rows name groups
      let topic: string | undefined
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
      } else if (wantsGroups && input.grouping && grouping?.kind !== "grouping") refused.push(`There is no grouping ${input.grouping}; leave grouping out for the thread's own (Topic), or give new_grouping to start one.`)
      else if (wantsGroups && !grouping) {
        let id = GROUPING_COLUMN
        for (let n = 2; c.columns.some((col) => col.id === id); n++) id = `${GROUPING_COLUMN}${n}`
        grouping = { id, question: "Topic", kind: "grouping", hidden: true, groups: [] }
        c.columns.push(grouping)
        mark(`column:${id}`)
        topic = `column:${id}`
      }
      const col = grouping?.kind === "grouping" ? grouping : undefined
      if (col && input.groups) {
        const given = new Map(input.groups.map((g) => [g.id, g]))
        for (const g of input.groups) {
          if (!g.parent) continue
          const parent = given.get(g.parent)
          if (!parent) refused.push(`Group ${g.id} sits under ${g.parent}, which isn't one of the groups.`)
          else if (parent.parent || g.parent === g.id) refused.push(`Groups go two levels deep at most: ${g.id} sits under ${g.parent}, which is itself under ${parent.parent}.`)
        }
        const was = col.groups ?? []
        const next: ThreadGroup[] = input.groups.map((g) => ({ ...g }))
        for (const g of next) {
          const had = was.find((have) => have.id === g.id)
          if (!had || had.name !== g.name || had.one !== g.one || had.parent !== g.parent) mark(itemId.group(col.id, g.id))
        }
        for (const g of was) if (!next.some((have) => have.id === g.id)) changed.add(itemId.group(col.id, g.id))
        col.groups = next
        // Papers in a group that is gone fall out of it
        const ids = new Set(next.map((g) => g.id))
        for (const row of c.rows) {
          const kept = row.in?.[col.id]?.filter((id) => ids.has(id))
          if (!row.in?.[col.id] || kept?.length === row.in[col.id]!.length) continue
          if (kept?.length) row.in[col.id] = kept
          else delete row.in[col.id]
          if (!Object.keys(row.in).length) delete row.in
          changed.add(itemId.row(row.id))
        }
      }
      if (refused.length) throw refusal(refused)

      // Rows: new papers, and answers for the ones there. Each row is checked whole before any of it
      // goes in. A new paper the Library hasn't got is added to it once the write is known to go in
      // (toAdd); until then its row goes by the id it was named by.
      const added: string[] = []
      const toAdd = new Map<string, ThreadPaper>()
      let updated = 0
      for (const given of input.rows ?? []) {
        const problems: string[] = []
        // A paper the thread has under the Library's id is that row
        let row = await this.rowOf(c.rows, given.id)
        let paper: ThreadPaper | undefined
        let id = row?.id ?? given.id
        if (!row) {
          const here = await this.services.canonical?.(given.id)
          if (!here) {
            paper = await this.services.paper?.(given.id)
            if (!paper && this.services.paper) {
              left.push(`owlit doesn't know the paper ${given.id}: name papers by the id a search gave you.`)
              continue
            }
          }
          id = here ?? given.id
        }
        // Whether the paper's record has an abstract, asked once per row and only for answers not from the full text
        let abstract: boolean | undefined
        const cells: Record<string, ThreadCell> = {}
        for (const [colId, cell] of Object.entries(given.cells ?? {})) {
          if (!c.columns.some((have) => have.id === colId)) {
            problems.push(`There is no column ${colId}; add it under columns first.`)
            continue
          }
          const text = cell.text.trim()
          if (!text) continue
          // An answer from the text rests on a passage that is in the paper word for word
          let passage = cell.passage
          let depth = cell.depth
          if (fromText(depth)) {
            if (!passage) {
              problems.push(`${given.id}'s answer for ${colId} says it is from the text but gives no passage; quote the words it rests on.`)
              continue
            }
            const page = this.services.findPassage ? await this.services.findPassage(id, passage.quote) : passage.page
            if (page === undefined) {
              problems.push(`owlit has no full text of ${given.id}, so its answer can only be from the abstract (depth abstract).`)
              continue
            }
            if (page === null) {
              problems.push(`The passage for ${given.id} isn't in its text word for word; quote it as library_read gives it.`)
              continue
            }
            passage = { quote: passage.quote, page }
            // Whether the whole text was read or part of it is what core saw the chat read, not the
            // agent's word: a quote after reading pages is part of the text
            if (input.chatId && this.services.readDepth) depth = this.services.readDepth(input.chatId, id) ?? "part"
          }
          // An answer "from the abstract" of a paper with none was from its title: stored so, for the report,
          // the cell and the export to say
          if (depth === "abstract") {
            abstract ??= !!(paper ?? (await this.services.facts?.(id)))?.abstract?.trim()
            if (!abstract) depth = "title"
          }
          const next: ThreadCell = { ...cell, depth, text, at: now, ...(passage && fromText(depth) ? { passage } : {}) }
          if (!fromText(depth)) delete next.passage
          const was = row?.cells[colId]
          if (!was || !sameCell(was, next)) cells[colId] = next
        }
        let groups: string[] | undefined
        if (col && (given.group !== undefined || given.groups !== undefined)) {
          groups = placeIn(col.groups ?? [], given.groups ?? (given.group ? [given.group] : []), (gid) => {
            if ((col.groups ?? []).some((g) => g.id === gid)) return gid
            problems.push(`Row ${given.id} is put in group ${gid}, which isn't one of the groups.`)
            return null
          })
        }
        if (problems.length) {
          left.push(...problems)
          continue
        }

        const year = (paper ?? (await this.services.facts?.(id)))?.year
        if (!row) {
          const foundBy = citingOrder(given.foundBy?.trim() || foundByOf(this.services.foundBy?.(given.id)), year)
          row = { id, cells: {}, addedAt: now, ...(foundBy ? { foundBy } : {}) }
          c.rows.push(row)
          added.push(id)
          if (paper) toAdd.set(id, paper)
          mark(itemId.row(id))
        }
        let touched = false
        const foundBy = citingOrder(given.foundBy?.trim(), year)
        if (foundBy && foundBy !== row.foundBy) {
          row.foundBy = foundBy
          touched = true
          changed.add(itemId.row(id))
        }
        const is = given.is?.trim()
        if (is && is !== row.is) {
          row.is = is
          touched = true
          mark(itemId.row(id))
        }
        for (const [colId, cell] of Object.entries(cells)) {
          row.cells[colId] = cell
          touched = true
          mark(itemId.cell(id, colId))
        }
        if (col && groups) {
          const was = row.in?.[col.id] ?? []
          if (groups.join() !== was.join()) {
            if (groups.length) row.in = { ...row.in, [col.id]: groups }
            else if (row.in) {
              delete row.in[col.id]
              if (!Object.keys(row.in).length) delete row.in
            }
            touched = true
            mark(itemId.row(id))
          }
        }
        if (touched && !added.includes(id)) updated++
      }
      for (const name of input.removeRows ?? []) {
        const row = await this.rowOf(c.rows, name)
        if (!row) {
          left.push(`${name} isn't a paper of this thread, so there was nothing to take out.`)
          continue
        }
        c.rows.splice(c.rows.indexOf(row), 1)
        changed.add(itemId.row(row.id))
      }

      // The report, whole, and the one line: the report's first sentence when the write gives no line. A
      // report's papers are rows of the thread, its links named by their ids.
      if (input.report !== undefined) {
        const { text, strangers } = await this.linkRows(c.rows, input.report.trim())
        if (strangers.length)
          left.push(`The report links ${strangers.join(", ")}, which ${strangers.length === 1 ? "isn't a paper" : "aren't papers"} of this thread, so the report stays as it was: link only papers that are rows (add them in rows first).`)
        else if (text !== c.report) {
          c.report = text
          mark(itemId.report())
        }
      }
      const one = (input.one?.trim() && plainLine(input.one)) || (changed.has(itemId.report()) && !input.one ? firstSentence(c.report) : undefined)
      if (one !== undefined && one !== c.one) {
        c.one = one
        mark(itemId.one())
      }

      // Nothing could go in: a new thread whose papers all had problems is no thread either, and a Topic
      // grouping started for rows that were left out is nothing either
      if (left.length && (fresh ? !c.rows.length : ![...changed].some((item) => item !== topic))) throw refusal(left)
      if (!fresh && !changed.size) return { id: c.id, title: c.title, added: 0, updated: 0 }

      // The papers new to the Library, added as the writer's; a row then goes by the Library's id
      for (const [name, paper] of toAdd) {
        const id = this.services.addPaper ? await this.services.addPaper(name, paper, caller) : name
        if (id !== name) rekeyRow(c, name, id, { added, changed })
      }

      c.updatedAt = now
      await this.save(c)
      // One write is one undo on the chat's card: its entries share the tool call's id, or one of their own.
      // A thread it starts is one entry, and each item it put in one more, so About reads what it added.
      const origin = { writeId: (caller.kind !== "window" && caller.toolCallId) || newWriteId(), ...(input.chatId ? { chatId: input.chatId } : {}) }
      const searches = await this.searchesFor(c.id, input, now)
      const note = input.note?.trim()
      const question = asked && changed.has("alsoAsked") ? asked : undefined
      if (searches.length || note || question)
        await this.record(c.id, { at: now, by: input.chatId ? `chat:${input.chatId}` : "agent", writeId: origin.writeId, ...(question ? { asked: question } : {}), ...(note ? { note } : {}), ...(searches.length ? { searches } : {}) })
      await this.announce(c)
      const entries = [
        ...(fresh ? [await this.recorder.record(caller, { action: "create", target: { kind: "thread", path: c.id }, origin }, { quiet: true })] : []),
        ...(await this.recordItems(caller, before, c, [...changed], origin)),
      ]
      // Said once per write and only for a chat, which shows it under the answer
      if (input.chatId && entries[0]) this.recorder.say(entries[0], { label: c.title, thread: { rows: added, updated, ...(asked ? { asked } : {}) } })
      return { id: c.id, title: c.title, added: added.length, updated, ...(left.length ? { left } : {}) }
    })
  }

  // The report with each owlit://library/ link naming its row by the row's id, and the papers it links
  // that are no row of the thread
  private async linkRows(rows: ThreadRow[], report: string) {
    const strangers: string[] = []
    const named = new Map<string, string>()
    for (const [, id] of report.matchAll(LIBRARY_LINK)) {
      if (named.has(id!)) continue
      const row = await this.rowOf(rows, id!)
      named.set(id!, row?.id ?? id!)
      if (!row) strangers.push(id!)
    }
    return { text: report.replace(LIBRARY_LINK, (link, id: string) => link.replace(id, named.get(id) ?? id)), strangers }
  }

  // ---- The user's changes ----

  // The thread's project, or what its table is grouped by: read from disk and saved, so the facts a window
  // was shown are never saved (read()). The project is logged; how the user looks changes nothing worth an
  // entry in the log, nor the order of the list.
  edit(id: string, edit: ThreadEdit, caller: Caller) {
    return this.serial.run(async () => {
      const c = await this.mustLoad(id)
      const before = structuredClone(c)
      applyThreadEdit(c, edit)
      if (edit.op === "project") {
        c.updatedAt = Date.now()
        await this.recordItems(caller, before, c, ["project"])
      }
      await this.save(c)
      const read = await this.read(c)
      this.services.changed?.(c.id, read)
      return read
    })
  }

  // To .owlit/trash/<stamp>-thread-<id>/, whole, so undelete() can put it back
  delete(id: string, caller: Caller) {
    return this.serial.run(async () => {
      await this.mustLoad(id)
      await this.toTrash(id)
      await this.recorder.record(caller, { action: "delete", target: { kind: "thread", path: id } }, { quiet: true })
      this.services.changed?.(id, null)
      return null
    })
  }

  undelete(id: string, caller: Caller) {
    return this.serial.run(async () => {
      const c = await this.read(await this.fromTrash(id))
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
      if (!sameJson(now, expect)) throw new RpcFailure(RpcErrorCode.Conflict, t`That changed in the thread since, so owlit left it as it is.`, { id, item })
      if (!putItem(c, item, to)) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the thread any more.`, { id, item })
      c.updatedAt = Date.now()
      await this.save(c)
      await this.announce(c)
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
      } else await this.announce(await this.fromTrash(id))
      return this.recorder.record(caller, { action: change.action === "create" ? "delete" : "create", target: { kind: "thread", path: id }, ...extra })
    })
  }

  // ---- About: Owlit's work in batches ----

  // The searches a write rests on: those its chat made since it last wrote (here or to another thread),
  // or in the last hours when it hasn't
  private async searchesFor(id: string, input: ThreadWrite, now: number) {
    const by = input.chatId ? `chat:${input.chatId}` : undefined
    if (!by || !this.services.searches) return []
    let since = this.attributed.get(by)
    if (since === undefined) {
      // After a restart: the same chat's last write here
      const last = (await this.history(id)).findLast((l) => l.by === by)
      since = Math.max(last?.at ?? 0, now - SEARCHES_SINCE_MS)
    }
    this.attributed.set(by, now)
    return (await this.services.searches(by, since)).map(({ at, query, source, results }) => ({ at, query, source, results }))
  }

  // Owlit's work on the thread in batches, for About. Each write is read from the change log, its entries
  // sharing a writeId, leaving out what was undone since; its line in history.jsonl adds the searches, the
  // note and the question it was for. A write whose entries the log no longer keeps (log.ts KEEP_MS) is
  // read from its line: the rows still here that came in at its moment. Lines from before the change log
  // list the items they changed and are read as written. A chat's writes close together are one batch, and
  // so are writes that name no chat.
  async about(id: string): Promise<ThreadBatch[]> {
    const c = await this.get(id)
    const present = new Set(c.rows.map((r) => r.id))
    const entries = (await this.changes.list({ target: { kind: "thread", path: id } })).reverse()
    const undone = undoneOf(entries)
    const writes: Write[] = []
    const logged = new Map<string, Write>()
    for (const e of entries) {
      // The person's own changes (the thread's project) and undos are no work of Owlit's
      if (e.undoes || e.actor.startsWith("p_") || !e.origin.writeId) continue
      let w = logged.get(e.origin.writeId)
      if (!w) {
        w = { at: e.at, by: e.origin.chatId ? `chat:${e.origin.chatId}` : "agent", logged: true, itemized: false, added: new Set(), answered: [], notes: [], searches: [] }
        logged.set(e.origin.writeId, w)
        writes.push(w)
      }
      if (!e.target.part) continue
      w.itemized = true
      if (undone.has(e.id)) continue
      const [kind, row, col] = e.target.part.split(":")
      if (kind === "row" && e.action === "create") w.added.add(row!)
      else if (kind === "cell" && e.action !== "delete") w.answered.push([row!, col!])
    }
    for (const line of await this.history(id)) {
      // An older line has no writeId: its write is the first of its chat's logged just after it
      let w = line.writeId ? logged.get(line.writeId) : writes.find((x) => x.logged && !x.line && x.by === line.by && x.at >= line.at && x.at - line.at < LINE_MATCH_MS)
      if (!w) {
        w = { at: line.at, by: line.by, logged: false, itemized: false, added: new Set(), answered: [], notes: [], searches: [] }
        writes.push(w)
      }
      w.line = line
      if (!w.itemized) {
        for (const r of line.added ?? c.rows.filter((r) => r.addedAt === line.at).map((r) => r.id)) if (present.has(r)) w.added.add(r)
        for (const item of line.items ?? []) {
          const [kind, row, col] = item.split(":")
          if (kind === "cell" && present.has(row!)) w.answered.push([row!, col!])
        }
      }
      if (line.asked) w.asked = line.asked
      if (line.note) w.notes.push(line.note)
      w.searches.push(...(line.searches ?? []))
    }

    const columns = new Map(c.columns.map((col) => [col.id, col]))
    const titles = new Map(c.rows.map((r) => [r.id, r.paper.title]))
    const batches: { key: string; last: number; batch: ThreadBatch; writes: Write[] }[] = []
    for (const w of writes.sort((a, b) => a.at - b.at)) {
      const { run, recipe } = w.line ?? {}
      const key = run ?? w.by
      let open = batches.at(-1)
      // A scheduler task's lines, and a chat owlit started with a recipe, were one batch however far apart
      if (!open || open.key !== key || (!run && !recipe && w.at - open.last > BATCH_GAP_MS)) {
        const kind = run?.split(":")[0]?.replace(/^threads\./, "") ?? (recipe ? RECIPE_TRIGGER[recipe] : undefined)
        const trigger: ThreadBatch["trigger"] = kind && ["gather", "more", "read", "fill"].includes(kind) ? (kind as ThreadBatch["trigger"]) : w.by.startsWith("chat:") ? "chat" : "agent"
        open = { key, last: w.at, writes: [], batch: { at: w.at, trigger, ...(trigger === "chat" ? { chatId: w.by.slice("chat:".length) } : {}), added: 0, answered: 0, columns: [], searches: [], notes: [] } }
        batches.push(open)
      }
      open.last = w.at
      open.writes.push(w)
    }
    return batches
      .map(({ batch, writes }) => {
        const rows = new Set(writes.flatMap((w) => [...w.added]))
        const answered = new Set<string>()
        const asked = new Set<string>()
        for (const [row, colId] of writes.flatMap((w) => w.answered)) {
          if (rows.has(row)) continue
          answered.add(row)
          const col = columns.get(colId)
          if (col && col.id !== QUESTION_COLUMN) asked.add(col.kind === "compare" ? (col.doc ?? col.question) : col.question)
        }
        const question = writes.findLast((w) => w.asked)?.asked
        return {
          ...batch,
          ...(question ? { asked: question } : {}),
          added: rows.size,
          answered: answered.size,
          columns: [...asked],
          searches: writes.flatMap((w) => w.searches).map((s) => searchOf(s, rows, titles)),
          notes: writes.flatMap((w) => w.notes),
        }
      })
      .filter((b) => b.added || b.answered || b.searches.length || b.notes.length || b.asked)
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
      version: 3,
      id: uniqueId(title, taken),
      title,
      asked: { text: input.asked!.trim(), at: now, ...(input.chatId ? { chatId: input.chatId } : {}), ...(input.docPath ? { docPath: input.docPath } : {}) },
      project: input.project ?? "",
      sources: [],
      report: "",
      one: "",
      columns: [{ id: QUESTION_COLUMN, question: input.asked!.trim(), kind: "ask" }],
      rows: [],
      createdAt: now,
      updatedAt: now,
    }
  }

  private async mustLoad(id: string): Promise<Thread> {
    const c = await this.load(id)
    if (!c) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread isn't here any more.`, { id })
    return c
  }

  private async load(id: string): Promise<Thread | undefined> {
    if (!/^[\w-]+$/.test(id)) return undefined
    const raw = await readJson<StoredThread>(path.join(this.dir, id, FILE))
    if (!raw || raw.version === 3) return raw
    // A thread of an older version: upgraded once on disk too, after whatever is writing now. A write
    // already in progress saves the same upgrade, and then this finds nothing left to do.
    void this.serial.run(async () => {
      const again = await readJson<StoredThread>(path.join(this.dir, id, FILE))
      if (again && again.version !== 3) await this.save(await this.upgrade(again))
    })
    return this.upgrade(raw)
  }

  // A thread of any version as version 3 (upgradeThread), its rows named by the Library's ids. A paper
  // the Library hasn't got is added to it as Owlit's from the snapshot the row kept; one that can't be
  // added keeps its row as it was.
  private async upgrade(raw: StoredThread): Promise<Thread> {
    const c = upgradeThread(raw)
    const kept = keptPapers(raw)
    const { canonical, addPaper } = this.services
    for (const r of [...c.rows]) {
      const paper = kept[r.id]
      let id = await canonical?.(r.id, paper?.ids)
      if (!id && paper && addPaper) id = await addPaper(r.id, paper, OWLIT).catch(() => undefined)
      if (id && id !== r.id) rekeyRow(c, r.id, id)
    }
    return c
  }

  // The latest of this thread in .owlit/trash, back in its place
  private async fromTrash(id: string) {
    if (await this.load(id)) throw new RpcFailure(RpcErrorCode.Conflict, t`That thread is already here.`, { id })
    const suffix = `-thread-${id}`
    const entry = (await readdir(this.trashDir).catch(() => [] as string[])).filter((n) => n.endsWith(suffix)).sort().reverse()[0]
    if (!entry) throw new RpcFailure(RpcErrorCode.NotFound, t`That thread is no longer in the trash.`, { id })
    await mkdir(this.dir, { recursive: true })
    await rename(path.join(this.trashDir, entry), path.join(this.dir, id))
    return this.mustLoad(id)
  }

  // Into .owlit/trash as <when>-thread-<id>, where undelete finds the latest
  private async toTrash(id: string, at = Date.now()) {
    await mkdir(this.trashDir, { recursive: true })
    await rename(path.join(this.dir, id), path.join(this.trashDir, `${at}-thread-${id}`))
  }

  // thread.json never holds a paper's facts: a thread read for a window has them on its rows (read())
  private async save(c: Thread) {
    await writeJsonAtomic(path.join(this.dir, c.id, FILE), { ...c, rows: c.rows.map(({ paper: _paper, ...r }: ThreadRow & { paper?: unknown }) => r) })
  }

  private async record(id: string, line: HistoryLine) {
    await appendJsonl(path.join(this.dir, id, "history.jsonl"), line)
  }

  history(id: string): Promise<HistoryLine[]> {
    return readJsonl<HistoryLine>(path.join(this.dir, id, "history.jsonl"))
  }

}

// One item of a thread as the change log keeps it. Items are named as itemId() names them, plus
// column:<id>, alsoAsked and the thread's project. A row is kept without its cells and a column without its
// groups: those are items of their own. undefined when the thread has nothing of it.
function itemOf(c: Thread, item: string): unknown {
  const [kind, a, b] = item.split(":")
  let value: unknown
  if (item === itemId.title()) value = c.title
  else if (item === itemId.report()) value = c.report
  else if (item === itemId.one()) value = c.one
  else if (item === "asked") value = c.asked
  else if (item === "alsoAsked") value = c.alsoAsked
  else if (item === "project") value = c.project
  else if (kind === "cell") value = c.rows.find((r) => r.id === a)?.cells[b!]
  else if (kind === "column") {
    const col = c.columns.find((col) => col.id === a)
    if (col) {
      const { groups: _groups, ...rest } = col
      value = rest
    }
  } else if (kind === "row") {
    const row = c.rows.find((r) => r.id === a)
    if (row) {
      const { cells: _cells, ...rest } = row
      value = rest
    }
  } else if (kind === "group") value = c.columns.find((col) => col.id === a)?.groups?.find((g) => g.id === b)
  return value === undefined ? undefined : { value }
}

// Sets one item to what itemOf gave for it (undefined: none of it), so itemOf reads that back. False when
// the item needs a row or grouping the thread no longer has.
function putItem(c: Thread, item: string, to: unknown): boolean {
  const { value } = (to ?? {}) as { value?: any }
  const [kind, a, b] = item.split(":")
  const put = <T extends { id: string }>(list: T[], id: string | undefined, next: T | undefined) => {
    const at = list.findIndex((x) => x.id === id)
    if (!next) return list.filter((x) => x.id !== id)
    if (at < 0) return [...list, next]
    return list.map((x, i) => (i === at ? next : x))
  }
  if (kind === "cell") {
    const row = c.rows.find((r) => r.id === a)
    if (!row) return value === undefined
    if (value) row.cells[b!] = value
    else delete row.cells[b!]
  } else if (kind === "group") {
    const col = c.columns.find((x) => x.id === a && x.kind === "grouping")
    if (!col) return value === undefined
    col.groups = put(col.groups ?? [], b, value)
  } else if (item === itemId.title()) c.title = value ?? c.title
  else if (item === itemId.report()) c.report = value ?? ""
  else if (item === itemId.one()) c.one = value ?? ""
  else if (item === "asked") c.asked = value ?? c.asked
  else if (item === "alsoAsked") {
    if (value) c.alsoAsked = value
    else delete c.alsoAsked
  } else if (item === "project") c.project = value ?? ""
  else if (kind === "column") {
    const was = c.columns.find((col) => col.id === a)
    c.columns = put(c.columns, a, value && { ...value, ...(was?.groups ? { groups: was.groups } : value.kind === "grouping" ? { groups: [] } : {}) })
  } else if (kind === "row") {
    const was = c.rows.find((r) => r.id === a)
    c.rows = put(c.rows, a, value ? { ...value, cells: was?.cells ?? {} } : undefined)
  }
  return true
}

// A row named by another id from now on (the Library's), in the thread, its report's links, and the lists
// of a write in progress. A row the thread has under that id already takes the other's cells it lacks.
function rekeyRow(c: Thread, from: string, to: string, write?: { added: string[]; changed: Set<string> }) {
  const row = c.rows.find((r) => r.id === from)
  if (!row) return
  const twin = c.rows.find((r) => r.id === to)
  if (twin) {
    twin.cells = { ...row.cells, ...twin.cells }
    twin.is ??= row.is
    twin.foundBy ??= row.foundBy
    for (const [col, ids] of Object.entries(row.in ?? {})) twin.in = { ...twin.in, [col]: [...new Set([...(twin.in?.[col] ?? []), ...ids])] }
    c.rows.splice(c.rows.indexOf(row), 1)
  } else row.id = to
  c.report = c.report.split(`(owlit://library/${from})`).join(`(owlit://library/${to})`)
  if (!write) return
  const at = write.added.indexOf(from)
  if (at >= 0) {
    if (twin) write.added.splice(at, 1)
    else write.added[at] = to
  }
  for (const item of [...write.changed]) {
    const [kind, paper, rest] = item.split(":")
    if (paper !== from || (kind !== "row" && kind !== "cell")) continue
    write.changed.delete(item)
    write.changed.add(kind === "row" ? itemId.row(to) : itemId.cell(to, rest!))
  }
}

// A paper named in a report: [Short title](owlit://library/<id>), maybe with a page after the id
const LIBRARY_LINK = /\(owlit:\/\/library\/([^)\s#?]+)[^)\s]*\)/g

const refusal = (problems: string[]) => new RpcFailure(RpcErrorCode.InvalidParams, `owlit didn't write it:\n- ${problems.join("\n- ")}`)

// The entries an undo still in force took back: an undo undone (a redo) puts its entry back
function undoneOf(entries: Change[]): Set<string> {
  const undos = new Map<string, Change[]>()
  for (const e of entries) if (e.undoes) undos.set(e.undoes, [...(undos.get(e.undoes) ?? []), e])
  const memo = new Map<string, boolean>()
  const isUndone = (id: string): boolean => {
    if (!memo.has(id)) {
      memo.set(id, false)
      memo.set(id, (undos.get(id) ?? []).some((u) => !isUndone(u.id)))
    }
    return memo.get(id)!
  }
  return new Set(entries.filter((e) => isUndone(e.id)).map((e) => e.id))
}

// A logged search as a row's foundBy says it: a paper from X's reference list is cited by X, one from
// the papers citing X cites X
function foundByOf(query: string | undefined) {
  if (!query) return undefined
  const m = /^(references|cited_by|similar) of (.*)$/.exec(query)
  if (!m) return `search: ${query}`
  return m[1] === "references" ? `cited by ${m[2]}` : m[1] === "cited_by" ? `cites ${m[2]}` : `like ${m[2]}`
}

// A foundBy that names a citing paper by its year, turned the right way round when the years say it
// is backwards: a 2026 paper can't be cited by a 2022 one, so it cites it (agents mix the two up when
// the paper came from library_related cited_by). Left as it is without both years.
export function citingOrder(foundBy: string | undefined, year: number | undefined) {
  if (!foundBy || !year) return foundBy
  const m = /^(cited by|cites) (.*?\b(\d{4})\b.*)$/i.exec(foundBy)
  if (!m) return foundBy
  const other = Number(m[3])
  if (m[1].toLowerCase() === "cited by" && other < year) return `cites ${m[2]}`
  if (m[1].toLowerCase() === "cites" && other > year) return `cited by ${m[2]}`
  return foundBy
}

// The first sentence of a report's first paragraph, as plain words. "et al.", "e.g." and an initial
// don't end one.
function firstSentence(report: string) {
  const para = plainLine(report.split(/\n\s*\n/).find((p) => p.trim() && !/^\s*#/.test(p)) ?? "")
  for (const end of para.matchAll(/[.!?](?=\s)|[。！？]/g)) {
    const at = end.index + 1
    if (end[0] === "." && /(?:\bal|\be\.g|\bi\.e|\bcf|\bvs|\b[A-Z])\.$/.test(para.slice(0, at))) continue
    return para.slice(0, at)
  }
  return para
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
