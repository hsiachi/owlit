import { create } from "zustand"
import { persist } from "zustand/middleware"

// Panel and navigation state for Docs; the open folders and the last doc survive a reload
interface DocsUiState {
  expanded: Record<string, boolean>
  // Where "New doc" lands: the folder last clicked, or the open doc's folder ("" is the workspace root)
  targetFolder: string
  // A folder row the user clicked last, shown as selected until a doc is opened
  selectedFolder: string | null
  lastDocId: string | null
  query: string
  // The row being renamed in place, by file id or folder path
  renaming: string | null

  setExpanded: (path: string, open: boolean) => void
  expandTo: (path: string) => void
  selectFolder: (path: string | null) => void
  openedDoc: (id: string, folder: string) => void
  setQuery: (query: string) => void
  setRenaming: (key: string | null) => void
}

export const useDocsUiStore = create<DocsUiState>()(
  persist(
    (set) => ({
      expanded: { writing: true, notes: true },
      targetFolder: "",
      selectedFolder: null,
      lastDocId: null,
      query: "",
      renaming: null,

      setExpanded: (path, open) => set((s) => ({ expanded: { ...s.expanded, [path]: open } })),
      // Opens every folder on the way to a path so its row is visible
      expandTo: (path) =>
        set((s) => {
          const parts = path.split("/")
          const expanded = { ...s.expanded }
          for (let i = 1; i <= parts.length; i++) expanded[parts.slice(0, i).join("/")] = true
          return { expanded }
        }),
      selectFolder: (path) => set(path === null ? { selectedFolder: null } : { selectedFolder: path, targetFolder: path }),
      openedDoc: (id, folder) => set({ lastDocId: id, targetFolder: folder, selectedFolder: null }),
      setQuery: (query) => set({ query }),
      setRenaming: (renaming) => set({ renaming }),
    }),
    {
      name: "owlit-docs-ui",
      partialize: (s) => ({ expanded: s.expanded, lastDocId: s.lastDocId }),
    },
  ),
)
