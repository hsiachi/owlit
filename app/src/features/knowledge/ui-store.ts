import { create } from "zustand"

// Transient state of the Knowledge pages: what is being renamed, split or edited right now
interface KnowledgeUi {
  query: string
  renaming: string | null
  splitting: string | null
  // "topic/line" or "topic/question"
  editing: string | null
  // The line whose history is open under it
  open: string | null
  setQuery: (query: string) => void
  set: (patch: Partial<Omit<KnowledgeUi, "set" | "setQuery">>) => void
}

export const useKnowledgeUi = create<KnowledgeUi>()((set) => ({
  query: "",
  renaming: null,
  splitting: null,
  editing: null,
  open: null,
  setQuery: (query) => set({ query }),
  set: (patch) => set(patch),
}))
