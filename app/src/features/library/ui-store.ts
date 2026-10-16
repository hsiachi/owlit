import { create } from "zustand"
import { type PickMode, range, toggle } from "@/lib/multi-select"

// Transient UI state for the Library pages. Not persisted, but it lives outside the page
// components so filters, selection and scroll survive opening a paper and coming back. The open peek
// survives only a trip into its own paper, so Back is one step out, to the card; leaving the list for
// anywhere else folds it (lib/use-list-keys.ts).

// "needs": papers whose publisher wants the user (a check, a sign-in) before it hands over the PDF;
// "no-pdf": every paper owlit looked for and has no PDF of, Needs you ones among them
export type StatusFilter = "all" | "starred" | "unread" | "reading" | "read" | "needs" | "no-pdf"
// thread: grouped by the thread a paper came from, newest added first in each
export type SortKey = "addedAt" | "title" | "authors" | "year" | "venue" | "citations" | "thread"

export interface Sort {
  key: SortKey
  desc: boolean
}

interface UiState {
  query: string
  filter: StatusFilter
  // Tag filter: a paper must carry every selected tag
  tags: string[]
  // Only these papers, under a name for its chip (an import's "From this import")
  only: { ids: string[]; label: string } | null
  sort: Sort

  // selectedIds is the selection; cursorId is the keyboard cursor and the row a plain click
  // last landed on; anchorId is where a shift-range starts; peekId is the row opened in place
  selectedIds: string[]
  cursorId: string | null
  anchorId: string | null
  peekId: string | null
  // The paper being opened from the list, until the list has been left for it
  leavingFor: string | null
  scrollTop: number

  editingId: string | null

  setQuery: (q: string) => void
  setFilter: (f: StatusFilter) => void
  toggleTag: (tag: string) => void
  showTag: (tag: string) => void
  // The list narrowed to these papers, everything else cleared, until the chip is taken off
  showOnly: (ids: string[], label: string) => void
  clearOnly: () => void
  sortBy: (key: SortKey) => void

  // A plain click selects the row and opens or folds its peek; ⌘ toggles and ⇧ extends
  // the selection without peeking
  click: (id: string, mode: PickMode, order: string[]) => void
  moveCursor: (id: string, extend: boolean, order: string[]) => void
  togglePeek: (id: string) => void
  closePeek: () => void
  // Right-click on an unselected row acts on that row alone, so it becomes the selection
  selectForMenu: (id: string) => void
  // Opening a paper from the list: its peek, if open, waits for the way back
  leaveFor: (id: string) => void
  // The list page is going: the peek folds unless the list was left for its paper
  leaveList: () => void
  // The cursor on the paper just opened, so ↑↓ carry on from it; nothing selected, and no peek but its own
  placeCursor: (id: string) => void
  // One paper shown whatever narrowed the list: search, filter and tags cleared, its row selected and peeked
  revealPaper: (id: string) => void
  selectAll: (order: string[]) => void
  clearSelection: () => void
  setScrollTop: (top: number) => void
  setEditingId: (id: string | null) => void
}

// Dates and years read newest first; words read A to Z
const naturalDesc = (key: SortKey) => key === "addedAt" || key === "year" || key === "citations" || key === "thread"

export const useLibraryUi = create<UiState>()((set, get) => ({
  query: "",
  filter: "all",
  tags: [],
  only: null,
  sort: { key: "addedAt", desc: true },
  selectedIds: [],
  cursorId: null,
  anchorId: null,
  peekId: null,
  leavingFor: null,
  scrollTop: 0,
  editingId: null,

  setQuery: (query) => set({ query, peekId: null }),
  setFilter: (filter) => set({ filter, peekId: null }),
  toggleTag: (tag) =>
    set((s) => ({ tags: toggle(s.tags, tag), peekId: null })),
  // Clicking a tag chip shows everything carrying that tag
  showTag: (tag) => set({ tags: [tag], filter: "all", query: "", peekId: null, selectedIds: [] }),
  showOnly: (ids, label) => set({ only: { ids, label }, tags: [], filter: "all", query: "", peekId: null, selectedIds: [] }),
  clearOnly: () => set({ only: null, peekId: null }),
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
  leaveFor: (id) => set({ leavingFor: id }),
  leaveList: () => set((s) => ({ peekId: s.leavingFor && s.leavingFor === s.peekId ? s.peekId : null, leavingFor: null })),
  placeCursor: (id) => set((s) => ({ cursorId: id, anchorId: id, selectedIds: [], peekId: s.peekId === id ? id : null })),
  revealPaper: (id) => set({ query: "", filter: "all", tags: [], only: null, selectedIds: [id], cursorId: id, anchorId: id, peekId: id }),
  selectAll: (order) => set({ selectedIds: order, peekId: null }),
  clearSelection: () => set({ selectedIds: [], anchorId: null, peekId: null }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setEditingId: (editingId) => set({ editingId }),
}))
