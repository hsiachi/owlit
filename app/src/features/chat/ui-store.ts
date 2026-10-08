import { create } from "zustand"

// Transient UI state shared across chat components
interface UiState {
  connectorsDialogOpen: boolean
  searchOpen: boolean
  setConnectorsDialogOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  connectorsDialogOpen: false,
  searchOpen: false,
  setConnectorsDialogOpen: (connectorsDialogOpen) => set({ connectorsDialogOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}))
