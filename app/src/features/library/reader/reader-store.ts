import { create } from "zustand"
import type { Highlight, HighlightColor, Rect } from "../types"
import type { PassageTarget } from "./passages"

// What the open reader and the details panel say to each other. Lives outside both so the
// Highlights tab can ask the reader to jump without either knowing how the other is built.

export interface ReaderApi {
  // The paper this reader shows
  paperId: string
  // Scroll so the highlight sits in the upper part of the pane, then flash it
  jumpToHighlight: (h: Highlight) => void
  // Outline a passage where it is (hover), or scroll to it and ring it twice (jump). False if not found.
  showPassage: (p: PassageTarget, mode: "hover" | "jump") => Promise<boolean>
  // Select a passage, which brings up the highlight popover on it
  selectPassage: (p: PassageTarget) => Promise<boolean>
  // Scroll to the top of a 0-based page
  showPage: (page: number) => void
  // Highlight a passage as an agent asked to, then jump to it; null if not found
  markPassage: (p: PassageTarget, color: HighlightColor) => Promise<Highlight | null>
}

// A passage outlined in the PDF: the box around its lines. `pulse` rings it twice and lets it go.
interface Ring {
  passageId: string
  page: number
  box: Rect
  pulse: boolean
}

interface ReaderState {
  api: ReaderApi | null
  // The paper whose reader has laid out its pages and gone back to where the user was; until then a
  // jump would land somewhere else
  ready: string | null
  // The highlight whose popover is open in the reader
  activeId: string | null
  // Open the active highlight's popover with its comment field
  commenting: boolean
  // Briefly emphasised after a jump from the list
  flashId: string | null
  // The highlight the list should bring into view, set when one is clicked in the PDF
  focusId: string | null
  // Under the pointer, for showing its comment
  hoverId: string | null
  ring: Ring | null
  // A passage to jump to once the reader is ready (opening a paper from a passage link)
  pendingPassage: PassageTarget | null

  setApi: (api: ReaderApi | null) => void
  open: (id: string, opts?: { commenting?: boolean }) => void
  close: () => void
  flash: (id: string) => void
  setRing: (ring: Ring | null) => void
  // Drops the hover outline, but not a pulse in progress
  clearHoverRing: (passageId?: string) => void
}

let flashTimer: ReturnType<typeof setTimeout> | undefined
let ringTimer: ReturnType<typeof setTimeout> | undefined

export const useReaderStore = create<ReaderState>()((set) => ({
  api: null,
  ready: null,
  activeId: null,
  commenting: false,
  flashId: null,
  focusId: null,
  hoverId: null,
  ring: null,
  pendingPassage: null,

  setApi: (api) => set((s) => ({ api, ready: api && s.ready === api.paperId ? s.ready : null })),
  open: (id, opts) => set({ activeId: id, commenting: !!opts?.commenting, focusId: id }),
  close: () => set({ activeId: null, commenting: false, hoverId: null }),
  flash: (id) => {
    clearTimeout(flashTimer)
    set({ flashId: id })
    flashTimer = setTimeout(() => set({ flashId: null }), 1200)
  },
  setRing: (ring) => {
    clearTimeout(ringTimer)
    set({ ring })
    if (ring?.pulse) ringTimer = setTimeout(() => set((s) => (s.ring === ring ? { ring: null } : s)), 1700)
  },
  clearHoverRing: (passageId) => set((s) => (s.ring && !s.ring.pulse && (!passageId || s.ring.passageId === passageId) ? { ring: null } : s)),
}))
