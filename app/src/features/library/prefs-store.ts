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
  // In the dark theme, a white page under a 12% shade, so it doesn't glare beside the dark panel
  dimPdf: boolean
  setLayout: (layout: Layout) => void
  setPanelOpen: (open: boolean) => void
  setPanelWidth: (width: number) => void
  setPanelTab: (tab: PanelTab) => void
  setDimPdf: (dim: boolean) => void
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      layout: "table",
      panelOpen: true,
      panelWidth: PANEL_DEFAULT,
      panelTab: "notes",
      dimPdf: true,
      setLayout: (layout) => set({ layout }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setPanelWidth: (panelWidth) => set({ panelWidth }),
      setPanelTab: (panelTab) => set({ panelTab }),
      setDimPdf: (dimPdf) => set({ dimPdf }),
    }),
    {
      name: "owlit-paper-page",
      version: 2,
      // Version 1 opened on About, so nearly everyone has it stored without having picked it
      migrate: (state, version) => {
        const s = state as PrefsState
        return version < 2 && s.panelTab === "about" ? { ...s, panelTab: "notes" } : s
      },
    },
  ),
)
