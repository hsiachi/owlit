import { create } from "zustand"
import { persist } from "zustand/middleware"

// "a/b/c" → ["a", "a/b", "a/b/c"]; nothing for the workspace root
const ancestors = (path: string) => (path ? path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")) : [])

// Panel and navigation state for Docs; the open folders and the last doc survive a reload
interface DocsUiState {
  expanded: Record<string, boolean>
  // Folders opened only to show the open doc; they close again when the user moves to a doc elsewhere
  autoOpened: string[]
  // Where "New doc" lands: the folder last clicked, or the open doc's folder ("" is the workspace root)
  targetFolder: string
  // A folder row the user clicked last, shown as selected until a doc is opened
  selectedFolder: string | null
  lastDocId: string | null
  // The row being renamed in place, by file id or folder path
  renaming: string | null
  // The agent note shown open under its paragraph, at most one at a time
  openNote: { docId: string; noteId: string } | null
  // Rows picked with ⌘- or ⇧-click to act on together, by row key (see rowKey); the anchor is where a
  // ⇧-click range starts
  picked: string[]
  pickAnchor: string | null
  // The doc whose Versions dialog is open
  versionsOf: string | null

  setExpanded: (path: string, open: boolean) => void
  expandTo: (path: string) => void
  revealDoc: (folder: string) => void
  selectFolder: (path: string | null) => void
  openedDoc: (id: string, folder: string) => void
  setRenaming: (key: string | null) => void
  setOpenNote: (docId: string, noteId: string | null) => void
  setPicked: (picked: string[], anchor?: string | null) => void
  // The rows an action on one row covers: every picked row when it is one of several picked, else the row alone
  actingOn: (key: string) => string[]
  showVersions: (docId: string | null) => void
}

// How a tree row is named in `renaming` and `picked`: a file by its id, a folder by its path
export const rowKey = { file: (id: string) => id, folder: (path: string) => `folder:${path}` }
export const folderOfKey = (key: string) => (key.startsWith("folder:") ? key.slice("folder:".length) : null)

export const useDocsUiStore = create<DocsUiState>()(
  persist(
    (set, get) => ({
      expanded: { writing: true, notes: true },
      autoOpened: [],
      targetFolder: "",
      selectedFolder: null,
      lastDocId: null,
      renaming: null,
      openNote: null,
      picked: [],
      pickAnchor: null,
      versionsOf: null,

      // A folder the user opens or closes is theirs: it stays as they left it
      setExpanded: (path, open) => set((s) => ({ expanded: { ...s.expanded, [path]: open }, autoOpened: s.autoOpened.filter((p) => p !== path) })),
      // Opens every folder on the way to a path so its row is visible
      expandTo: (path) =>
        set((s) => {
          const way = ancestors(path)
          const expanded = { ...s.expanded }
          for (const p of way) expanded[p] = true
          return { expanded, autoOpened: s.autoOpened.filter((p) => !way.includes(p)) }
        }),
      // Opens the way to the open doc's folder, and closes folders opened only for a doc the user has left
      revealDoc: (folder) =>
        set((s) => {
          const way = ancestors(folder)
          const expanded = { ...s.expanded }
          const autoOpened: string[] = []
          for (const p of s.autoOpened) {
            if (way.includes(p)) autoOpened.push(p)
            else expanded[p] = false
          }
          for (const p of way)
            if (!expanded[p]) {
              expanded[p] = true
              autoOpened.push(p)
            }
          return { expanded, autoOpened }
        }),
      selectFolder: (path) => set(path === null ? { selectedFolder: null } : { selectedFolder: path, targetFolder: path }),
      openedDoc: (id, folder) => set({ lastDocId: id, targetFolder: folder, selectedFolder: null }),
      setRenaming: (renaming) => set({ renaming }),
      setOpenNote: (docId, noteId) => set({ openNote: noteId ? { docId, noteId } : null }),
      setPicked: (picked, anchor) => set((s) => ({ picked, pickAnchor: anchor === undefined ? s.pickAnchor : anchor })),
      actingOn: (key) => {
        const { picked } = get()
        return picked.length > 1 && picked.includes(key) ? picked : [key]
      },
      showVersions: (versionsOf) => set({ versionsOf }),
    }),
    {
      name: "owlit-docs-ui",
      partialize: (s) => ({ expanded: s.expanded, autoOpened: s.autoOpened, lastDocId: s.lastDocId }),
    },
  ),
)
