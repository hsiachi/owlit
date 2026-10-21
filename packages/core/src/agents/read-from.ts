import type { ReadFrom } from "@owlit/protocol"
import { citationsIn } from "../library/wear.ts"

// What agents read of the library through library_read, by who asked ("chat:<id>", or "agent"), so a
// chat's answer can say what it was built from when its turn ends. Kept in memory only: what a turn read
// is written into its answer (readFrom), and a restart in the middle of a turn loses only that line.
export interface LibraryRead {
  asker: string
  paperId: string
  part: "text" | "digest" | "note"
  pages?: string
  // A section asked for by a word from its heading; a read with neither pages nor section is the whole text
  section?: string
  at: number
}

// Reads older than this are forgotten as new ones come: no turn runs that long, and runs (whose reads no
// answer collects yet) don't pile up
const KEEP_MS = 6 * 60 * 60 * 1000

export class ReadLog {
  private reads: LibraryRead[] = []

  record(read: LibraryRead) {
    const cutoff = read.at - KEEP_MS
    if (this.reads[0] && this.reads[0].at < cutoff) this.reads = this.reads.filter((r) => r.at >= cutoff)
    this.reads.push(read)
  }

  since(asker: string, at: number): LibraryRead[] {
    return this.reads.filter((r) => r.asker === asker && r.at >= at)
  }
}

// What an answer was built from: each paper the turn read or the answer cites, once, in the order they
// came, on the one scale (protocol ReadDepth). A paper's whole text read is full; pages or a section of
// it is part, with the pages when the reads named them all; its digest alone is digest; one only cited
// is abstract when its record has one (the turn went on its details) and title when it hasn't. `canonical`
// folds the ids a paper goes by into one; `hasAbstract` says whether the paper's record has an abstract.
export async function readFromOf(
  reads: readonly LibraryRead[],
  answer: string,
  canonical: (id: string) => Promise<string>,
  hasAbstract: (id: string) => Promise<boolean>,
): Promise<ReadFrom[]> {
  const byPaper = new Map<string, LibraryRead[]>()
  for (const r of reads) {
    // The user's own note on a paper isn't the paper
    if (r.part === "note") continue
    const id = await canonical(r.paperId)
    byPaper.set(id, [...(byPaper.get(id) ?? []), r])
  }
  for (const c of citationsIn(answer)) {
    const id = await canonical(c.paperId)
    if (!byPaper.has(id)) byPaper.set(id, [])
  }
  const out: ReadFrom[] = []
  for (const [paperId, read] of byPaper) {
    const depth = textDepthOf(read)
    if (depth === "full") out.push({ paperId, depth })
    else if (depth === "part") {
      const text = read.filter((r) => r.part === "text")
      const pages = text.every((r) => r.pages) ? pageList(text.map((r) => r.pages!)) : undefined
      out.push({ paperId, depth, ...(pages ? { pages } : {}) })
    } else out.push({ paperId, depth: read.some((r) => r.part === "digest") ? "digest" : (await hasAbstract(paperId)) ? "abstract" : "title" })
  }
  return out
}

// How far reads of one paper went into its text: the whole of it (a read naming neither pages nor a
// section), part of it, or none
export function textDepthOf(reads: readonly LibraryRead[]): "full" | "part" | undefined {
  const text = reads.filter((r) => r.part === "text")
  if (text.some((r) => !r.pages && !r.section)) return "full"
  return text.length ? "part" : undefined
}

// Pages as library_read takes them ("3", "3-5", "2,7"), several reads' together, as one list of runs:
// "2–5, 7". Undefined when one can't be read as pages.
export function pageList(specs: string[]): string | undefined {
  const sorted = pageNumbers(specs)
  if (!sorted) return undefined
  const runs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!
    while (sorted[i + 1] === sorted[i]! + 1) i++
    runs.push(sorted[i] === start ? `${start}` : `${start}–${sorted[i]}`)
  }
  return runs.join(", ") || undefined
}

// The pages several specs name ("3-5", "2,7", or pageList's "2–5, 7"), each once and in order; undefined
// when one can't be read as pages
export function pageNumbers(specs: string[]): number[] | undefined {
  const pages = new Set<number>()
  for (const part of specs.flatMap((s) => s.split(","))) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part)
    if (!m) return undefined
    const from = Number(m[1])
    const to = Number(m[2] ?? m[1])
    // A range wider than any paper is a mistake, not pages
    if (to < from || to - from > 2000) return undefined
    for (let p = from; p <= to; p++) pages.add(p)
  }
  return [...pages].sort((a, b) => a - b)
}
