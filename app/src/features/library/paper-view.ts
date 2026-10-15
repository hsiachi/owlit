import { useEffect } from "react"
import { create } from "zustand"
import { quoteTarget } from "./reader/passages"
import { whenReaderReady, type ReaderApi } from "./reader/reader-store"
import { useLibraryStore } from "./store"
import type { Highlight } from "./types"

export type PaperView = "digest" | "pdf"

// The digest or the PDF, for the paper last opened. A paper with a digest opens on it, since most of the
// time the digest is enough; the choice holds until the next paper. Kept outside the page so that going
// to a place in the paper from anywhere (showInPaper) can turn it to the PDF, even before the page is open.
interface PaperViewState {
  paperId: string | null
  view: PaperView
  setView: (paperId: string, view: PaperView) => void
}

export const usePaperView = create<PaperViewState>()((set) => ({
  paperId: null,
  view: "pdf",
  setView: (paperId, view) => set({ paperId, view }),
}))

// What the paper's page shows
export function usePaperViewOf(paperId: string, hasDigest: boolean, known: boolean): PaperView {
  const chosen = usePaperView((s) => (s.paperId === paperId ? s.view : null))
  // Settled when the paper opens: a digest that arrives while the PDF is being read doesn't take its place
  // (once the library has the paper: after a reload it arrives a moment later)
  useEffect(() => {
    if (known) usePaperView.setState((s) => (s.paperId === paperId ? s : { paperId, view: hasDigest ? "digest" : "pdf" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, known])
  return chosen ?? (hasDigest ? "digest" : "pdf")
}

// The paper's reader with its PDF in view, once it has laid out its pages. The PDF stays loaded under the
// digest, so turning to it doesn't load it again. A paper without a PDF never gets a reader: refused at
// once, in a sentence an agent can read.
export function pdfReader(paperId: string): Promise<ReaderApi> {
  const paper = useLibraryStore.getState().papers[paperId]
  if (!paper?.pdf) return Promise.reject(new Error(`${paper?.title ?? "That paper"} has no PDF in owlit yet.`))
  usePaperView.getState().setView(paperId, "pdf")
  return whenReaderReady(paperId)
}

export interface PaperPlace {
  // 1-based, as links write it
  page?: number
  // Words of the paper, found wherever they are on the page (or anywhere, without one)
  quote?: string
  highlight?: Highlight
}

// Goes to a place in a paper, from anywhere: a link, an agent, the tour, the digest, a highlight in the
// list. Turns the paper to its PDF and, once the reader is ready, rings the quoted passage or else scrolls
// to the page; with no place, only turns it. Resolves whether the passage was found (true when none was
// asked for). Opening the paper's page is the caller's: this works whether it is open already or opening.
export async function showInPaper(paperId: string, { page, quote, highlight }: PaperPlace = {}): Promise<boolean> {
  const reader = pdfReader(paperId)
  if (!page && !quote && !highlight) {
    reader.catch(() => undefined)
    return true
  }
  const api = await reader
  if (highlight) {
    api.jumpToHighlight(highlight)
    return true
  }
  // A quote that isn't found still lands on its page
  if (quote && (await api.showPassage(quoteTarget(quote, page), "jump"))) return true
  if (page) api.showPage(page - 1)
  return !quote
}
