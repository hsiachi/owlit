import { create } from "zustand"
import { onWorkspaceOpened } from "@/lib/workspace"

// The tour through the example workspace: which stop is showing, if any. It starts by itself only once,
// when the example the user chose on the first-launch flow opens; Help › Take the tour starts it again.
interface TourState {
  stop: number | null
  // Help › Take the tour asks before leaving the person's own workspace for the example
  asking: boolean
  start: () => void
  go: (stop: number) => void
  end: () => void
}

export const useTour = create<TourState>((set) => ({
  stop: null,
  asking: false,
  start: () => set({ stop: 0 }),
  go: (stop) => set({ stop }),
  end: () => set({ stop: null }),
}))

let pending = false

// Called before the example is created: the tour begins once it has opened. The returned cancel is for when
// creating it fails, or the next folder the user opens would get the example's tour.
export function tourWhenExampleOpens() {
  pending = true
  return () => {
    pending = false
  }
}

onWorkspaceOpened(() => {
  if (!pending) return
  pending = false
  useTour.getState().start()
})

export const isExample = (name?: string) => !!name && /^Owlit Example( \d+)?$/.test(name)
