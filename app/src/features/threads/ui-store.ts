import { create } from "zustand"

// What the Threads pages show for now: which thread's name is being edited, and which row is
// opened in place
interface ThreadsUi {
  renaming: string | null
  peek: string | null
  set: (patch: Partial<Omit<ThreadsUi, "set">>) => void
}

export const useThreadsUi = create<ThreadsUi>()((set) => ({
  renaming: null,
  peek: null,
  set: (patch) => set(patch),
}))
