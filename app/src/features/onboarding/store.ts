import { create } from "zustand"

// Help › How owlit works: the flow's four introduction steps again, over the app
interface IntroState {
  open: boolean
  show: () => void
  close: () => void
}

export const useIntro = create<IntroState>((set) => ({
  open: false,
  // The replay starts from its first step each time it is shown
  show: () => {
    useFlowPlace.getState().reset("replay")
    set({ open: true })
  },
  close: () => set({ open: false }),
}))

export const showIntro = () => useIntro.getState().show()

// Where the flow is, outside its component: a new interface language remounts every page (main.tsx), and
// choosing one in About you must leave the person there, not back at the welcome
export interface FlowPlace {
  index: number
  seen: number
  welcomed: boolean
}
const START: FlowPlace = { index: 0, seen: 0, welcomed: false }

export const useFlowPlace = create<Record<"first" | "replay", FlowPlace> & { set: (mode: "first" | "replay", patch: Partial<FlowPlace>) => void; reset: (mode: "first" | "replay") => void }>((set) => ({
  first: START,
  replay: START,
  set: (mode, patch) => set((s) => ({ [mode]: { ...s[mode], ...patch } })),
  reset: (mode) => set({ [mode]: START }),
}))
