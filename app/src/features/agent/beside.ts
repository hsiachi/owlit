import { create } from "zustand"
import { useAgentWindow } from "./store"

// The right slot of the window holds one thing: the docked agent panel, a paper beside the doc, or
// nothing. A citation clicked in a doc opens its paper there, at the sentence, so a claim can be checked
// with the doc still in view; opening the agent panel (⇧⌘J) puts the paper away, and opening a paper puts
// the panel away. Neither is kept across a restart.
export interface PaperBeside {
  paperId: string
  // 1-based, as the citation's link names it
  page?: number
  // The sentence the citation rests on, ringed in the reader
  quote?: string
  // The citation it was opened from, for Esc to put the cursor back there
  from?: { docId: string; pos: number }
}

interface BesideState {
  paper: PaperBeside | null
  open: (paper: PaperBeside) => void
  close: () => void
}

export const useBeside = create<BesideState>()((set) => ({
  paper: null,
  open: (paper) => {
    if (useAgentWindow.getState().stage === "open") useAgentWindow.getState().close()
    set({ paper })
  },
  close: () => set({ paper: null }),
}))

// The panel coming back takes the slot
useAgentWindow.subscribe((s, prev) => {
  if (s.stage === "open" && prev.stage !== "open" && useBeside.getState().paper) useBeside.getState().close()
})

// The window at least this wide has room for the doc's column and the paper beside it; narrower, a
// citation opens the paper's own page
export const BESIDE_MIN_WINDOW = 1100
