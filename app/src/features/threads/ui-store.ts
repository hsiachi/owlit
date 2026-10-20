import { create } from "zustand"

// What the Threads pages show for now: which row is opened in place
interface ThreadsUi {
  peek: string | null
  set: (patch: Partial<Omit<ThreadsUi, "set">>) => void
}

export const useThreadsUi = create<ThreadsUi>()((set) => ({
  peek: null,
  set: (patch) => set(patch),
}))
