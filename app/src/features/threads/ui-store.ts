import { create } from "zustand"

// What the Threads pages show for now: which row is opened in place, and the row a link in the report
// last pointed at (`at` tells two clicks on the same link apart, so each rings it again)
interface ThreadsUi {
  peek: string | null
  ring: { id: string; at: number } | null
  set: (patch: Partial<Omit<ThreadsUi, "set">>) => void
}

export const useThreadsUi = create<ThreadsUi>()((set) => ({
  peek: null,
  ring: null,
  set: (patch) => set(patch),
}))
