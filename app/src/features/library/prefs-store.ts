import { create } from "zustand"
import { persist } from "zustand/middleware"

// How the paper page is laid out, remembered across papers and sessions
export type PanelTab = "notes" | "highlights" | "about"

export const PANEL_DEFAULT = 380
export const PANEL_MIN = 320

interface PrefsState {
  panelOpen: boolean
  panelWidth: number
  // The tab last used, so someone taking notes keeps Notes open from paper to paper
  panelTab: PanelTab
  setPanelOpen: (open: boolean) => void
  setPanelWidth: (width: number) => void
  setPanelTab: (tab: PanelTab) => void
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      panelOpen: true,
      panelWidth: PANEL_DEFAULT,
      panelTab: "about",
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setPanelWidth: (panelWidth) => set({ panelWidth }),
      setPanelTab: (panelTab) => set({ panelTab }),
    }),
    { name: "owlit-paper-page", version: 1 },
  ),
)
