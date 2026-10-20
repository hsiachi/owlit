import { create } from "zustand"
import { persist } from "zustand/middleware"

// How the Library and the paper page are laid out, remembered across papers and sessions
export type PanelTab = "notes" | "highlights" | "about"
export type Layout = "list" | "table"

export const PANEL_DEFAULT = 380
export const PANEL_MIN = 320

interface PrefsState {
  // All papers as a list or a table
  layout: Layout
  panelOpen: boolean
  panelWidth: number
  // The tab last used, so someone taking notes keeps Notes open from paper to paper. Notes first: About
  // repeats the title, authors and abstract the page beside it already shows.
  panelTab: PanelTab
  setLayout: (layout: Layout) => void
  setPanelOpen: (open: boolean) => void
  setPanelWidth: (width: number) => void
  setPanelTab: (tab: PanelTab) => void
}

// Version 2 of this store kept Dim PDF pages, which core keeps with the rest of Appearance: one turned off
// there is handed to core once (settings/store.ts)
let dimPdfOff = false
export function takeDimPdfOff() {
  const off = dimPdfOff
  dimPdfOff = false
  return off
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      layout: "table",
      panelOpen: true,
      panelWidth: PANEL_DEFAULT,
      panelTab: "notes",
      setLayout: (layout) => set({ layout }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setPanelWidth: (panelWidth) => set({ panelWidth }),
      setPanelTab: (panelTab) => set({ panelTab }),
    }),
    {
      name: "owlit-paper-page",
      version: 3,
      // Version 1 opened on About, so nearly everyone has it stored without having picked it
      migrate: (state, version) => {
        const { dimPdf, ...s } = state as PrefsState & { dimPdf?: boolean }
        if (version < 3 && dimPdf === false) dimPdfOff = true
        return version < 2 && s.panelTab === "about" ? { ...s, panelTab: "notes" } : s
      },
    },
  ),
)
