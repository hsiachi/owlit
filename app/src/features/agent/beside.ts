import { useSyncExternalStore } from "react"
import { create } from "zustand"
import { PAGE_MIN, PANEL_WIDTH, useAgentWindow } from "./store"

// The right of the window holds the docked agent panel, a paper beside the doc, or nothing; on a window
// at least BOTH_MIN_WINDOW wide, the paper and the panel together. A citation clicked in a doc opens its
// paper there, at the sentence, so a claim can be checked with the doc still in view. On a narrower
// window the two take turns: opening the agent panel (⇧⌘J) puts the paper away, and opening a paper puts
// the panel away. On a wide one a citation opens beside the doc while the chat stays docked, since
// checking Owlit's claim while talking to Owlit about it is when both are wanted. Neither is kept across
// a restart.
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
  // The paper's width while the panel is docked beside it; alone, it takes the panel's width
  width: number
  open: (paper: PaperBeside) => void
  close: () => void
  setWidth: (width: number) => void
}

// The window at least this wide has room for the doc's column and the paper beside it; narrower, a
// citation opens the paper's own page
export const BESIDE_MIN_WINDOW = 1100
// At least this wide, for the doc's column (PAGE_MIN), the paper and the agent panel at their usual widths
const BOTH_MIN_WINDOW = 1400
// The narrowest the paper gets beside the panel
const PAPER_MIN = 320

// Room for both: the window is wide enough, and a panel widened by hand still leaves the doc its column
// and the paper its least width (the panel keeps the width the person gave it)
export const wideForBoth = () => window.innerWidth >= Math.max(BOTH_MIN_WINDOW, PAGE_MIN + PAPER_MIN + useAgentWindow.getState().panelWidth)

export const useBeside = create<BesideState>()((set) => ({
  paper: null,
  width: PANEL_WIDTH,
  open: (paper) => {
    if (useAgentWindow.getState().stage === "open" && !wideForBoth()) useAgentWindow.getState().close()
    set({ paper })
  },
  close: () => set({ paper: null }),
  setWidth: (width) => set({ width: Math.round(Math.max(PAPER_MIN, width)) }),
}))

// The panel coming back takes the slot, unless there is room for both
useAgentWindow.subscribe((s, prev) => {
  if (s.stage === "open" && prev.stage !== "open" && useBeside.getState().paper && !wideForBoth()) useBeside.getState().close()
})

const onResize = (change: () => void) => {
  window.addEventListener("resize", change)
  const off = useAgentWindow.subscribe((s, prev) => s.panelWidth !== prev.panelWidth && change())
  return () => {
    window.removeEventListener("resize", change)
    off()
  }
}

// Whether there is room for the paper and the docked panel together, following the window's and the
// panel's widths. A window narrowed past it while both are open shows the panel; the paper comes back when
// it widens or the panel closes.
export const useWideForBoth = () => useSyncExternalStore(onResize, wideForBoth)

// Whether the paper beside shows next to a docked panel or alone in the slot; null: it isn't shown.
// docked: the agent panel is docked.
export function besideShown(hasPaper: boolean, docked: boolean, wide: boolean): "alone" | "with-panel" | null {
  if (!hasPaper) return null
  if (!docked) return "alone"
  return wide ? "with-panel" : null
}
