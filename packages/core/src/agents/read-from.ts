import type { ReadFrom } from "@owlit/protocol"
import { citationsIn } from "../library/wear.ts"

// What agents read of the library through library_read, by who asked ("chat:<id>", "run:<id>"), so a
// chat's answer can say what it was built from when its turn ends. Kept in memory only: what a turn read
// is written into its answer (readFrom), and a restart in the middle of a turn loses only that line.
export interface LibraryRead {
  asker: string
  paperId: string
  part: "text" | "digest" | "note"
  pages?: string
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
// came. A paper's text read is full, its digest alone is digest; one only cited is abstract when owlit has
// its text (the turn went on its details or abstract), none when it hasn't. `canonical` folds the ids a
// paper goes by into one; `hasText` says whether owlit has its text.
export async function readFromOf(
  reads: readonly LibraryRead[],
  answer: string,
  canonical: (id: string) => Promise<string>,
  hasText: (id: string) => Promise<boolean>,
): Promise<ReadFrom[]> {
  const parts = new Map<string, Set<LibraryRead["part"]>>()
  for (const r of reads) {
    // The user's own note on a paper isn't the paper
    if (r.part === "note") continue
    const id = await canonical(r.paperId)
    parts.set(id, (parts.get(id) ?? new Set()).add(r.part))
  }
  for (const c of citationsIn(answer)) {
    const id = await canonical(c.paperId)
    if (!parts.has(id)) parts.set(id, new Set())
  }
  const out: ReadFrom[] = []
  for (const [paperId, read] of parts) {
    const depth = read.has("text") ? "full" : read.has("digest") ? "digest" : (await hasText(paperId)) ? "abstract" : "none"
    out.push({ paperId, depth })
  }
  return out
}
