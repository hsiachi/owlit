import type { JournalEntry } from "@owlit/protocol"
import { readFile } from "node:fs/promises"

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
    if (e.actor !== "user") continue
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

// The entries of a journal file in order; a line that doesn't parse (a write cut short) is skipped
export async function readJournal(file: string): Promise<JournalEntry[]> {
  const text = await readFile(file, "utf8").catch(() => "")
  const entries: JournalEntry[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as JournalEntry)
    } catch {
      continue
    }
  }
  return entries
}
