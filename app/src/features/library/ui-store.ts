import { create } from "zustand"

// Transient UI state for the Library page. Not persisted, but it lives outside the page
// component so filters, selection and scroll survive opening a paper and coming back.

export type StatusFilter = "all" | "starred" | "unread" | "reading" | "read"
export type SortKey = "addedAt" | "title" | "year" | "venue" | "status"

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

  // Selection in the table. activeId is the row the detail pane shows and the keyboard
  // cursor; anchorId is where a shift-range starts.
  selectedIds: string[]
  activeId: string | null
  anchorId: string | null
  detailOpen: boolean
  scrollTop: number

  addOpen: boolean
  editingId: string | null

  setQuery: (q: string) => void
  setFilter: (f: StatusFilter) => void
  toggleTag: (tag: string) => void
  clearTags: () => void
  setSort: (sort: Sort) => void
  sortBy: (key: SortKey) => void

  // Click semantics: plain click selects one, ⌘ toggles, ⇧ extends from the anchor
  select: (id: string, mode: "single" | "toggle" | "range", order: string[]) => void
  selectAll: (order: string[]) => void
  clearSelection: () => void
  setActive: (id: string | null) => void
  setDetailOpen: (open: boolean) => void
  setScrollTop: (top: number) => void
  setAddOpen: (open: boolean) => void
  setEditingId: (id: string | null) => void
}

const DEFAULT_SORT: Sort = { key: "addedAt", desc: true }

export const useUiStore = create<UiState>()((set, get) => ({
  query: "",
  filter: "all",
  tags: [],
  sort: DEFAULT_SORT,
  selectedIds: [],
  activeId: null,
  anchorId: null,
  detailOpen: false,
  scrollTop: 0,
  addOpen: false,
  editingId: null,

  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  toggleTag: (tag) =>
    set((s) => ({ tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag] })),
  clearTags: () => set({ tags: [] }),
  setSort: (sort) => set({ sort }),
  // Clicking the active column flips direction; a new column starts in its natural direction
  sortBy: (key) =>
    set((s) => ({
      sort:
        s.sort.key === key
          ? { key, desc: !s.sort.desc }
          : { key, desc: key === "addedAt" || key === "year" },
    })),

  select: (id, mode, order) => {
    const s = get()
    if (mode === "single") {
      set({ selectedIds: [id], activeId: id, anchorId: id, detailOpen: true })
      return
    }
    if (mode === "toggle") {
      const has = s.selectedIds.includes(id)
      const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
      set({
        selectedIds,
        activeId: has ? (selectedIds.at(-1) ?? null) : id,
        anchorId: id,
        detailOpen: selectedIds.length > 0,
      })
      return
    }
    const anchor = s.anchorId ?? s.activeId ?? id
    const a = order.indexOf(anchor)
    const b = order.indexOf(id)
    if (a < 0 || b < 0) {
      set({ selectedIds: [id], activeId: id, anchorId: id, detailOpen: true })
      return
    }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    set({ selectedIds: order.slice(lo, hi + 1), activeId: id, detailOpen: true })
  },
  selectAll: (order) => set({ selectedIds: order, detailOpen: order.length > 0 }),
  clearSelection: () => set({ selectedIds: [], activeId: null, anchorId: null, detailOpen: false }),
  setActive: (activeId) => set({ activeId }),
  setDetailOpen: (detailOpen) => set({ detailOpen }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setAddOpen: (addOpen) => set({ addOpen }),
  setEditingId: (editingId) => set({ editingId }),
}))
