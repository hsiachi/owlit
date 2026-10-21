import { isOwlit, isPerson, type Change, type CitationCounts, type CitationState, type DocCitation, type DocCitations, type OwlitReading, type ReadFrom } from "@owlit/protocol"
import path from "node:path"
import { pageList, pageNumbers, type LibraryRead } from "../agents/read-from.ts"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { citesOtherIn, placeOf } from "../library/passage.ts"
import { citationSpans, type Citation } from "../library/wear.ts"
import { Serial } from "../util.ts"

// What Owlit had read of a paper when it wrote a citation of it: its whole text, part of it (the pages
// and sections when the reads named them), or its digest. Empty: nothing.
export interface KeptRead {
  full?: true
  part?: true
  pages?: number[]
  sections?: string[]
  digest?: true
}

// One citation as a doc's writes brought it, keyed by the link as written (paper, page, sentence)
export interface Kept extends Citation {
  by: "owlit" | "person" | "other"
  at: number
  changeId: string
  chatId?: string
  // Owlit's only
  read?: KeptRead
  // Owlit wrote it from a chat with no turn running here: its reads were in a core that has gone
  readsLost?: true
  // When the doc stopped holding it. Kept a while, so an undo or a restore that brings the text back
  // brings back who wrote it
  gone?: number
}

interface Stored {
  version: 1
  docs: Record<string, Kept[]>
}

// As long as the change log keeps what an undo needs (changes/log.ts KEEP_MS)
const GONE_MS = 30 * 24 * 3_600_000

const keyOf = (c: Citation) => `${c.paperId}#${c.page ?? ""}\n${c.quote ?? ""}`

export interface CitationServices {
  // The library reads core saw a chat make, in memory (agents/read-from.ts ReadLog)
  reads: (chatId: string) => LibraryRead[]
  // Whether the chat has a turn running in this core
  answering: (chatId: string) => boolean
  // What the chat's finished answers recorded they were built from, but the one named (the reply the
  // write belongs to: its readFrom, set when its turn ends, may hold reads made after the write)
  answered: (chatId: string, exceptReply?: string) => Promise<ReadFrom[]>
  // The Library's id for a paper, by any id it goes by
  canonical: (id: string) => Promise<string | undefined>
  // A paper's abstract, whether owlit has its text.md, and the text itself
  paper: (libraryId: string) => Promise<{ abstract?: string; hasText: boolean; text: () => Promise<string | null> }>
}

// .owlit/citations.json: who put each citation into each doc and, for Owlit's, what core saw it read of
// the paper by then, so the doc's Markdown stays plain. Kept apart from the change log, which drops a
// doc's entries after 30 days or 200 writes. Filled from the change log's doc entries in the order they
// are recorded (Recorder's written), one at a time; a citation's state is worked out when asked.
export class Citations {
  private readonly file: string
  private readonly services: CitationServices
  private readonly turn = new Serial((error) => console.error("[core] couldn't keep a doc's citations", error))
  private stored?: Stored
  // The doc a write took away, so the same write bringing it in elsewhere (a move) takes its citations
  private leaving?: { writeId: string; path: string }

  constructor(owlitDir: string, services: CitationServices) {
    this.file = path.join(owlitDir, "citations.json")
    this.services = services
  }

  // A doc's change, as the change log records it. The reads are taken now: the read log moves on.
  written(change: Change, before: string | null, after: string | null) {
    if (change.target.kind !== "doc") return
    const by = isOwlit(change.actor) ? "owlit" : isPerson(change.actor) ? "person" : "other"
    const chatId = change.origin.chatId
    const reads = by === "owlit" && chatId ? this.services.reads(chatId).filter((r) => r.at <= change.at) : []
    const lost = by === "owlit" && (!chatId || !this.services.answering(chatId))
    void this.turn.run(() => this.apply(change, by, before, after, reads, lost))
  }

  // Settles once every write so far is kept
  get idle() {
    return this.turn.idle
  }

  private async apply(change: Change, by: Kept["by"], before: string | null, after: string | null, reads: LibraryRead[], lost: boolean) {
    const stored = await this.load()
    const was = JSON.stringify(stored)
    const rel = change.target.path
    const writeId = change.origin.writeId
    if (after === null) {
      for (const k of stored.docs[rel] ?? []) k.gone ??= change.at
      this.leaving = writeId ? { writeId, path: rel } : undefined
    } else {
      if (before === null && writeId && this.leaving?.writeId === writeId && this.leaving.path !== rel) {
        stored.docs[rel] = [...(stored.docs[rel] ?? []), ...(stored.docs[this.leaving.path] ?? [])]
        delete stored.docs[this.leaving.path]
      }
      this.leaving = undefined
      const kept = stored.docs[rel] ?? []
      const now = citationSpans(after)
      const here = new Set(now.map(keyOf))
      const known = new Set(kept.map(keyOf))
      // Those the text held before the write and owlit has no record of were there before it kept any:
      // their author is unknown, not this write's
      const old = new Set(before ? citationSpans(before).map(keyOf) : [])
      for (const k of kept) {
        if (here.has(keyOf(k))) delete k.gone
        else k.gone ??= change.at
      }
      const reading = new Map<string, KeptRead>()
      for (const c of now) {
        const key = keyOf(c)
        if (known.has(key) || old.has(key)) continue
        known.add(key)
        const chatId = change.origin.chatId
        const k: Kept = { paperId: c.paperId, ...(c.page ? { page: c.page } : {}), ...(c.quote ? { quote: c.quote } : {}), by, at: change.at, changeId: change.id, ...(chatId ? { chatId } : {}) }
        if (by === "owlit") {
          const id = (await this.services.canonical(c.paperId)) ?? c.paperId
          if (!reading.has(id)) reading.set(id, await this.readOf(id, reads, chatId, change.origin.replyId))
          const read = reading.get(id)!
          if (Object.keys(read).length) k.read = read
          if (lost) k.readsLost = true
        }
        kept.push(k)
      }
      stored.docs[rel] = kept
    }
    for (const [doc, kept] of Object.entries(stored.docs)) {
      const left = kept.filter((k) => k.gone === undefined || change.at - k.gone < GONE_MS)
      if (left.length) stored.docs[doc] = left
      else delete stored.docs[doc]
    }
    if (JSON.stringify(stored) !== was) await writeJsonAtomic(this.file, stored)
  }

  // What Owlit had read of one paper: the turn's reads core saw, with what the chat's earlier answers
  // recorded (those outlive a restart; the read log doesn't)
  private async readOf(id: string, reads: LibraryRead[], chatId: string | undefined, replyId: string | undefined): Promise<KeptRead> {
    const read: KeptRead = {}
    const pages = new Set<number>()
    const sections = new Set<string>()
    for (const r of reads) {
      if (r.part === "note" || ((await this.services.canonical(r.paperId)) ?? r.paperId) !== id) continue
      if (r.part === "digest") read.digest = true
      else if (!r.pages && !r.section) read.full = true
      else {
        read.part = true
        for (const p of (r.pages && pageNumbers([r.pages])) || []) pages.add(p)
        if (r.section) sections.add(r.section)
      }
    }
    for (const r of chatId ? await this.services.answered(chatId, replyId) : []) {
      if (((await this.services.canonical(r.paperId)) ?? r.paperId) !== id) continue
      if (r.depth === "full") read.full = true
      else if (r.depth === "digest") read.digest = true
      else if (r.depth === "part") {
        read.part = true
        for (const p of (r.pages && pageNumbers([r.pages])) || []) pages.add(p)
      }
    }
    if (pages.size) read.pages = [...pages].sort((a, b) => a - b)
    if (sections.size) read.sections = [...sections]
    return read
  }

  // Every citation in a doc's text with what it rests on, and the counts. text: the doc as the window
  // has it, which may be ahead of what was last written
  of(rel: string, text: string): Promise<DocCitations> {
    return this.turn.run(async () => {
      const kept = new Map(((await this.load()).docs[rel] ?? []).map((k) => [keyOf(k), k]))
      // Each paper once; its text only for a citation with a sentence to look for
      const papers = new Map<string, Promise<{ paper: Paper; text: () => Promise<string | null> }>>()
      const texts = new Map<string, Promise<string | null>>()
      const citations: DocCitation[] = []
      for (const c of citationSpans(text)) {
        let found = papers.get(c.paperId)
        if (!found) papers.set(c.paperId, (found = this.paper(c.paperId)))
        const { paper, text: read } = await found
        if (c.quote && paper.hasText && !texts.has(c.paperId)) texts.set(c.paperId, read())
        citations.push(stateOf(c, kept.get(keyOf(c)), { ...paper, text: (await texts.get(c.paperId)) ?? null }))
      }
      return { citations, counts: countsOf(citations) }
    })
  }

  private async paper(paperId: string): Promise<{ paper: Paper; text: () => Promise<string | null> }> {
    const libraryId = await this.services.canonical(paperId)
    if (!libraryId) return { paper: { hasText: false, text: null }, text: async () => null }
    const { abstract, hasText, text } = await this.services.paper(libraryId)
    return { paper: { libraryId, ...(abstract ? { abstract } : {}), hasText, text: null }, text }
  }

  private async load(): Promise<Stored> {
    if (!this.stored) {
      const kept = await readJson<Stored>(this.file).catch(() => undefined)
      this.stored = kept?.version === 1 && kept.docs && typeof kept.docs === "object" ? kept : { version: 1, docs: {} }
    }
    return this.stored
  }
}

// text: read only for a citation with a sentence; null otherwise, or when owlit has none
interface Paper {
  libraryId?: string
  abstract?: string
  hasText: boolean
  text: string | null
}

// A citation's state (protocol CitationState), from the paper and what was kept of the write that brought it
export function stateOf(c: Citation & { from: number; to: number }, kept: Kept | undefined, paper: Paper): DocCitation {
  const by = kept?.by ?? "unknown"
  const passage = c.quote ? placeOf(c.quote, paper) : null
  const citesOther = c.quote ? citesOtherIn(c.quote, paper.text) : []
  const read = by === "owlit" ? kept?.read : undefined
  let state: CitationState | null
  if (by === "person") state = null
  else if (c.quote) {
    if (passage?.abstract) state = "abstract"
    else if (!passage) state = paper.hasText ? "not-found" : "no-text"
    else state = read && covers(read, passage.page, passage.section) ? "read" : "in-paper"
  } else if (read) state = "whole"
  else state = by === "owlit" && !kept?.readsLost ? "not-read" : "bare"
  return {
    from: c.from,
    to: c.to,
    paperId: c.paperId,
    ...(c.page ? { page: c.page } : {}),
    ...(c.quote ? { quote: c.quote } : {}),
    ...(paper.libraryId ? { libraryId: paper.libraryId } : {}),
    by,
    state,
    ...(passage ? { passage } : {}),
    hasText: paper.hasText,
    ...(read ? { owlitRead: readingOf(read) } : {}),
    ...(citesOther.length ? { citesOther } : {}),
    ...(kept?.chatId ? { chatId: kept.chatId } : {}),
    ...(kept ? { at: kept.at } : {}),
  }
}

// Whether Owlit's reads took in the place a sentence is: the whole text, its page, or a section asked for
// by a word of the heading it sits under
function covers(read: KeptRead, page: number | undefined, section: string | undefined) {
  if (read.full) return true
  if (page !== undefined && read.pages?.includes(page)) return true
  const heading = section?.toLowerCase()
  return !!heading && !!read.sections?.some((s) => s.trim() && heading.includes(s.trim().toLowerCase()))
}

function readingOf(read: KeptRead): OwlitReading {
  if (read.full) return { depth: "full" }
  if (read.part) {
    const pages = read.pages?.length ? pageList(read.pages.map(String)) : undefined
    return { depth: "part", ...(pages ? { pages } : {}) }
  }
  return { depth: "digest" }
}

export function countsOf(citations: DocCitation[]): CitationCounts {
  const n = (state: CitationState | null) => citations.filter((c) => c.state === state).length
  const counts = { read: n("read"), inPaper: n("in-paper"), abstract: n("abstract"), notFound: n("not-found"), noText: n("no-text"), whole: n("whole"), notRead: n("not-read"), bare: n("bare") }
  return {
    total: citations.length,
    ...counts,
    person: n(null),
    notReadInPaper: counts.abstract + counts.notFound + counts.noText + counts.notRead + counts.bare,
  }
}
