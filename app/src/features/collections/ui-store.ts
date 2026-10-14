import { create } from "zustand"

// What the Collections pages show for now: which collection's name is being edited, and which row is
// opened in place
interface CollectionsUi {
  renaming: string | null
  peek: string | null
  set: (patch: Partial<Omit<CollectionsUi, "set">>) => void
}

export const useCollectionsUi = create<CollectionsUi>()((set) => ({
  renaming: null,
  peek: null,
  set: (patch) => set(patch),
}))
