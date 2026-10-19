import { isPerson, type JournalEntry } from "@owlit/protocol"
import { readJsonl } from "../fs-util.ts"

// What the person has done with each paper, summed from the journal. The journal keeps raw events,
// never scores: whatever weighs them (whether a paper counts as read, what an agent is told) does so
// here, where it can change without rewriting anyone's history.

// Two minutes on the paper, its PDF or Owlit's digest of it, is reading it; a highlight, a note or a star
// is too, at any length
export const READ_AFTER_SECONDS = 120

export interface PaperReading {
  paperId: string
  // Seconds with the paper itself in view, and with Owlit's digest of it
  pdfSeconds: number
  digestSeconds: number
  // Seconds each page spent at the top, by 1-based page, counting only stays of 5 seconds or more
  pages: Record<number, number>
  // How many times it was opened
  visits: number
  highlights: number
  noted: boolean
  // Starred at some point, even if the star was taken off again
  starred: boolean
  firstAt: number
  lastAt: number
  // Read by the person, not only opened
  read: boolean
}

// alias: where a paper that changed id (a local PDF that got its DOI) lives now
export function readingOf(entries: Iterable<JournalEntry>, alias: (paperId: string) => string = (id) => id): Map<string, PaperReading> {
  const papers = new Map<string, PaperReading & { opened: number; closed: number }>()
  const paper = (id: string, at: number) => {
    const key = alias(id)
    let p = papers.get(key)
    if (!p) {
      p = { paperId: key, pdfSeconds: 0, digestSeconds: 0, pages: {}, visits: 0, highlights: 0, noted: false, starred: false, firstAt: at, lastAt: at, read: false, opened: 0, closed: 0 }
      papers.set(key, p)
    }
    p.firstAt = Math.min(p.firstAt, at)
    p.lastAt = Math.max(p.lastAt, at)
    return p
  }
  for (const e of entries) {
    if (!isPerson(e.actor)) continue
    switch (e.kind) {
      case "paper.opened":
        paper(e.paperId, e.at).opened++
        break
      case "paper.closed":
        paper(e.paperId, e.at).closed++
        break
      case "paper.focus":
        if (e.view === "pdf") paper(e.paperId, e.at).pdfSeconds += e.seconds
        else paper(e.paperId, e.at).digestSeconds += e.seconds
        break
      case "paper.dwell": {
        const p = paper(e.paperId, e.at)
        p.pages[e.page] = (p.pages[e.page] ?? 0) + e.seconds
        break
      }
      case "highlight.added":
        paper(e.paperId, e.at).highlights++
        break
      case "note.edited":
        paper(e.paperId, e.at).noted = true
        break
      case "paper.marked": {
        const p = paper(e.paperId, e.at)
        if (e.mark.what === "starred" && e.mark.to) p.starred = true
        break
      }
    }
  }
  const out = new Map<string, PaperReading>()
  for (const { opened, closed, ...p } of papers.values()) {
    // Journals from before paper.opened was kept have only the closing
    p.visits = Math.max(opened, closed)
    p.read = p.pdfSeconds + p.digestSeconds >= READ_AFTER_SECONDS || p.highlights > 0 || p.noted || p.starred
    out.set(p.paperId, p)
  }
  return out
}

// Read in full, beyond read: the pages that stayed at the top of the screen cover most of the paper
// (references and appendices are usually the rest). Without a page count, a long stay on the PDF does.
export const FULL_SHARE = 0.6
export const FULL_SECONDS_UNCOUNTED = 15 * 60

export function readInFull(reading: Pick<PaperReading, "pages" | "pdfSeconds"> | undefined, pageCount: number | null) {
  if (!reading) return false
  if (!pageCount) return reading.pdfSeconds >= FULL_SECONDS_UNCOUNTED
  return Object.keys(reading.pages).length >= Math.max(2, Math.ceil(pageCount * FULL_SHARE))
}

// Whether the visit to a paper that ended at `closedAt` is the one that made it read in full: it is now,
// and wasn't before that visit began. A paper becomes read in full once.
export function fullReadAt(entries: readonly JournalEntry[], paperId: string, closedAt: number, pageCount: number | null, alias?: (id: string) => string) {
  const opened = entries.findLast((e) => isPerson(e.actor) && e.kind === "paper.opened" && (alias?.(e.paperId) ?? e.paperId) === paperId && e.at <= closedAt)?.at
  if (opened === undefined) return false
  const before = readingOf(
    entries.filter((e) => e.at < opened),
    alias,
  ).get(paperId)
  // What the leaving settled comes with the closing, a moment either side of it
  const after = readingOf(
    entries.filter((e) => e.at <= closedAt + 5000),
    alias,
  ).get(paperId)
  return readInFull(after, pageCount) && !readInFull(before, pageCount)
}

// The entries of a journal file in order; a line that doesn't parse (a write cut short) is skipped
export const readJournal = (file: string) => readJsonl<JournalEntry>(file)
