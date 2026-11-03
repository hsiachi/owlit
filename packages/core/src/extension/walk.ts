import type { WalkStep } from "@owlit/protocol"
import type { Library } from "../library/library.ts"

// The walk through the papers whose pages the extension couldn't open, which the user downloads by hand
// in their browser one at a time: owlit holds where it stands, and the extension shows each paper's page
// in one tab with a card that says which of how many it is. It moves on when the user presses Next paper
// or Skip there, and past a paper once it has its PDF, by whatever way it came.
//
// In memory, one at a time: a new walk replaces the one going on, and a restart or another workspace
// forgets it. The papers' own records say what came of each, so the Library's block offers what is left.
export class ManualWalk {
  private walk: { library: Library; ids: string[]; at: number } | null = null

  // A walk through these papers, in this order; its first step, or undefined when none of them is left to
  // download (each has its PDF, left the library or has no DOI to open its page by)
  async start(library: Library, ids: string[]): Promise<Extract<WalkStep, { kind: "paper" }> | undefined> {
    this.walk = { library, ids: [...new Set(ids)], at: 0 }
    const step = await this.step(library)
    if (step?.kind === "paper") return step
    this.walk = null
    return undefined
  }

  // Where the walk stands, past the papers that need nothing any more; done once none is left, and the
  // walk is forgotten then. null when no walk is on for this library.
  async step(library: Library): Promise<WalkStep | null> {
    const walk = this.walk
    if (!walk || walk.library !== library) return null
    const papers = await Promise.all(walk.ids.map((id) => library.get(id)))
    // Another step may have moved it while the papers were read
    if (this.walk !== walk) return this.step(library)
    while (walk.at < walk.ids.length) {
      const paper = papers[walk.at]
      if (paper && !paper.pdf && paper.ids.doi) break
      walk.at++
    }
    const saved = papers.filter((p) => p?.pdf).length
    const total = walk.ids.length
    if (walk.at >= total) {
      this.walk = null
      return { kind: "done", saved, total }
    }
    const paper = papers[walk.at]!
    return { kind: "paper", paperId: paper.id, url: `https://doi.org/${paper.ids.doi}`, n: walk.at + 1, total, saved }
  }

  // On from this paper; with skip, the user found no PDF on its page, which its record keeps. Moved past
  // before the record is written, so a press that comes twice moves one paper, not two.
  async next(library: Library, paperId: string, skip: boolean): Promise<WalkStep | null> {
    const walk = this.walk
    if (!walk || walk.library !== library) return null
    if (walk.ids[walk.at] === paperId) {
      walk.at++
      if (skip) await library.noteSkipped(paperId)
    }
    return this.step(library)
  }
}
