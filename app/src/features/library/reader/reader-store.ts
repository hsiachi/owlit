import { create } from "zustand"
import type { Highlight } from "../types"

// What the open reader and the details panel say to each other. Lives outside both so the
// Highlights tab can ask the reader to jump without either knowing how the other is built.

export interface ReaderApi {
  // Scroll so the highlight sits in the upper part of the pane, then flash it
  jumpToHighlight: (h: Highlight) => void
}

interface ReaderState {
  api: ReaderApi | null
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

  setApi: (api: ReaderApi | null) => void
  open: (id: string, opts?: { commenting?: boolean }) => void
  close: () => void
  flash: (id: string) => void
}

let flashTimer: ReturnType<typeof setTimeout> | undefined

export const useReaderStore = create<ReaderState>()((set) => ({
  api: null,
  activeId: null,
  commenting: false,
  flashId: null,
  focusId: null,
  hoverId: null,

  setApi: (api) => set({ api }),
  open: (id, opts) => set({ activeId: id, commenting: !!opts?.commenting, focusId: id }),
  close: () => set({ activeId: null, commenting: false, hoverId: null }),
  flash: (id) => {
    clearTimeout(flashTimer)
    set({ flashId: id })
    flashTimer = setTimeout(() => set({ flashId: null }), 1200)
  },
}))
