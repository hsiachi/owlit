import { create } from "zustand"
import { type PickMode, range, toggle } from "@/lib/multi-select"

// Transient UI state for the Library pages. Not persisted, but it lives outside the page
// components so filters, selection and scroll survive opening a paper and coming back. The open peek
// does not: the list pages fold it when they are left (LibraryPage, UpNextPage).

// "needs": papers whose publisher wants the user (a check, a sign-in) before it hands over the PDF
export type StatusFilter = "all" | "starred" | "unread" | "reading" | "read" | "needs"
export type SortKey = "addedAt" | "title" | "authors" | "year" | "venue"

export interface Sort {
  key: SortKey
  desc: boolean
}

interface UiState {
  query: string
  filter: StatusFilter
  // Tag filter: a paper must carry every selected tag
  tags: string[]
  sort: Sort

  // selectedIds is the selection; cursorId is the keyboard cursor and the row a plain click
  // last landed on; anchorId is where a shift-range starts; peekId is the row opened in place
  selectedIds: string[]
  cursorId: string | null
  anchorId: string | null
  peekId: string | null
  scrollTop: number

  editingId: string | null

  setQuery: (q: string) => void
  setFilter: (f: StatusFilter) => void
  toggleTag: (tag: string) => void
  showTag: (tag: string) => void
  sortBy: (key: SortKey) => void

  // A plain click selects the row and opens or folds its peek; ⌘ toggles and ⇧ extends
  // the selection without peeking
  click: (id: string, mode: PickMode, order: string[]) => void
  moveCursor: (id: string, extend: boolean, order: string[]) => void
  togglePeek: (id: string) => void
  closePeek: () => void
  // Right-click on an unselected row acts on that row alone, so it becomes the selection
  selectForMenu: (id: string) => void
  // The cursor on a row with nothing selected or peeked: the paper just opened, so ↑↓ carry on from it
  placeCursor: (id: string) => void
  // One paper shown whatever narrowed the list: search, filter and tags cleared, its row selected and peeked
  revealPaper: (id: string) => void
  selectAll: (order: string[]) => void
  clearSelection: () => void
  setScrollTop: (top: number) => void
  setEditingId: (id: string | null) => void
}

// Dates and years read newest first; words read A to Z
const naturalDesc = (key: SortKey) => key === "addedAt" || key === "year"

export const useLibraryUi = create<UiState>()((set, get) => ({
  query: "",
  filter: "all",
  tags: [],
  sort: { key: "addedAt", desc: true },
  selectedIds: [],
  cursorId: null,
  anchorId: null,
  peekId: null,
  scrollTop: 0,
  editingId: null,

  setQuery: (query) => set({ query, peekId: null }),
  setFilter: (filter) => set({ filter, peekId: null }),
  toggleTag: (tag) =>
    set((s) => ({ tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag], peekId: null })),
  // Clicking a tag chip shows everything carrying that tag
  showTag: (tag) => set({ tags: [tag], filter: "all", query: "", peekId: null, selectedIds: [] }),
  // Picking the current key again flips the direction; a new key starts in its natural direction
  sortBy: (key) =>
    set((s) => ({ sort: s.sort.key === key ? { key, desc: !s.sort.desc } : { key, desc: naturalDesc(key) } })),

  click: (id, mode, order) => {
    const s = get()
    if (mode === "single") {
      set({ selectedIds: [id], cursorId: id, anchorId: id, peekId: s.peekId === id ? null : id })
      return
    }
    if (mode === "toggle") {
      set({ selectedIds: toggle(s.selectedIds, id), cursorId: id, anchorId: id, peekId: null })
      return
    }
    set({ selectedIds: range(order, s.anchorId ?? s.cursorId ?? id, id), cursorId: id, peekId: null })
  },
  // Arrow keys move the cursor; a peek that is open follows it, so ↑↓ pages through abstracts
  moveCursor: (id, extend, order) => {
    const s = get()
    if (extend) {
      set({ selectedIds: range(order, s.anchorId ?? s.cursorId ?? id, id), cursorId: id, peekId: null })
      return
    }
    set({ selectedIds: [id], cursorId: id, anchorId: id, peekId: s.peekId ? id : null })
  },
  togglePeek: (id) => set((s) => ({ peekId: s.peekId === id ? null : id, selectedIds: [id], cursorId: id, anchorId: id })),
  closePeek: () => set({ peekId: null }),
  selectForMenu: (id) => set((s) => (s.selectedIds.includes(id) ? s : { selectedIds: [id], cursorId: id, anchorId: id })),
  placeCursor: (id) => set({ cursorId: id, anchorId: id, selectedIds: [], peekId: null }),
  revealPaper: (id) => set({ query: "", filter: "all", tags: [], selectedIds: [id], cursorId: id, anchorId: id, peekId: id }),
  selectAll: (order) => set({ selectedIds: order, peekId: null }),
  clearSelection: () => set({ selectedIds: [], anchorId: null, peekId: null }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setEditingId: (editingId) => set({ editingId }),
}))
