import { create } from "zustand"

// Help › How owlit works: the flow's four introduction steps again, over the app
interface IntroState {
  open: boolean
  show: () => void
  close: () => void
}

export const useIntro = create<IntroState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

export const showIntro = () => useIntro.getState().show()
