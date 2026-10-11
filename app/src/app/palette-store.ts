import { create } from "zustand"

// The ⌘K palette is one for the whole app; any place can open it
export const usePaletteStore = create<{ open: boolean }>(() => ({ open: false }))
export const openPalette = () => usePaletteStore.setState({ open: true })
export const closePalette = () => usePaletteStore.setState({ open: false })
