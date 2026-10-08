import { create } from "zustand"

// Transient UI state for the Library pages. Not persisted, but it lives outside the page
// components so filters, selection, the open peek and scroll survive opening a paper and coming back.

export type StatusFilter = "all" | "starred" | "unread" | "reading" | "read"
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
  clearTags: () => void
  sortBy: (key: SortKey) => void

  // A plain click selects the row and opens or folds its peek; ⌘ toggles and ⇧ extends
  // the selection without peeking
  click: (id: string, mode: "single" | "toggle" | "range", order: string[]) => void
  moveCursor: (id: string, extend: boolean, order: string[]) => void
  togglePeek: (id: string) => void
  closePeek: () => void
  selectAll: (order: string[]) => void
  clearSelection: () => void
  setCursor: (id: string | null) => void
  setScrollTop: (top: number) => void
  setEditingId: (id: string | null) => void
}

// Dates and years read newest first; words read A to Z
const naturalDesc = (key: SortKey) => key === "addedAt" || key === "year"

function range(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return order.slice(lo, hi + 1)
}

export const useUiStore = create<UiState>()((set, get) => ({
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
  clearTags: () => set({ tags: [] }),
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
      const has = s.selectedIds.includes(id)
      set({
        selectedIds: has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
        cursorId: id,
        anchorId: id,
        peekId: null,
      })
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
  selectAll: (order) => set({ selectedIds: order, peekId: null }),
  clearSelection: () => set({ selectedIds: [], anchorId: null, peekId: null }),
  setCursor: (cursorId) => set({ cursorId }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setEditingId: (editingId) => set({ editingId }),
}))
