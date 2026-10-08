import { create } from "zustand"

// The ⌘K palette is one for the whole app; any place can open it
interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const usePaletteStore = create<PaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
