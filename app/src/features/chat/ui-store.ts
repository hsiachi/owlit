import { create } from "zustand"

// Transient UI state shared across chat components
interface UiState {
  connectorsDialogOpen: boolean
  setConnectorsDialogOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  connectorsDialogOpen: false,
  setConnectorsDialogOpen: (connectorsDialogOpen) => set({ connectorsDialogOpen }),
}))
