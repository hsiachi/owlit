import type { PaperView } from "@owlit/protocol"

// Reading time sent in pieces of this much, so a crash or a closed lid loses little of it
export const FOCUS_EVERY = 30_000
// How long a page must stay at the top before the stay counts
export const DWELL_MIN = 5_000

export type ReadingEvent =
  | { kind: "paper.focus"; paperId: string; view: PaperView; seconds: number }
  | { kind: "paper.dwell"; paperId: string; page: number; seconds: number }

// The time spent on one open paper, turned into paper.focus and paper.dwell. The caller ticks it only
// while the person is reading (window in front, not away) and settles it when they leave the paper,
// the view or the window.
export class ReadingClock {
  // Time not yet sent
  private focusMs = 0
  // This stay of the page at the top, and how much of it was sent
  private pageMs = 0
  private pageSent = 0

  readonly paperId: string
  // null while there is nothing to read (no PDF yet and the digest not shown)
  private view: PaperView | null
  private page: number
  private emit: (event: ReadingEvent) => void

  constructor(paperId: string, view: PaperView | null, page: number, emit: (event: ReadingEvent) => void) {
    this.paperId = paperId
    this.view = view
    this.page = page
    this.emit = emit
  }

  tick(ms: number) {
    if (!this.view) return
    this.focusMs += ms
    // A page is at the top only while the PDF is the side in view
    if (this.view === "pdf") this.pageMs += ms
    if (this.focusMs >= FOCUS_EVERY) this.settle()
  }

  // A page turn ends the page's stay but not the reading time, which keeps its 30-second pieces
  setPage(page: number) {
    if (page === this.page) return
    this.settleDwell()
    this.page = page
    this.pageMs = this.pageSent = 0
  }

  setView(view: PaperView | null) {
    if (view === this.view) return
    this.settle()
    this.view = view
    // Back on the PDF later is a new stay of whatever page is at the top
    this.pageMs = this.pageSent = 0
  }

  settle() {
    const seconds = Math.round(this.focusMs / 1000)
    if (seconds > 0 && this.view) this.emit({ kind: "paper.focus", paperId: this.paperId, view: this.view, seconds })
    this.focusMs = 0
    this.settleDwell()
  }

  private settleDwell() {
    const dwell = Math.round((this.pageMs - this.pageSent) / 1000)
    if (this.pageMs >= DWELL_MIN && dwell > 0) {
      this.emit({ kind: "paper.dwell", paperId: this.paperId, page: this.page, seconds: dwell })
      this.pageSent = this.pageMs
    }
  }
}
