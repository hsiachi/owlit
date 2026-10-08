import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { LibraryClient } from "./client"
import { MockLibraryClient } from "./mock-client"
import { seedPapers } from "./mocks/papers"
import type { Highlight, Paper, PaperNote, ReadStatus, ResolvedPaper } from "./types"

export const libraryClient: LibraryClient = new MockLibraryClient()

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

interface LibraryState {
  papers: Record<string, Paper>
  highlights: Record<string, Highlight>
  notes: Record<string, PaperNote>

  addPaper: (resolved: ResolvedPaper, addedBy?: Paper["addedBy"]) => Paper
  updatePaper: (id: string, patch: Partial<Omit<Paper, "id">>) => void
  // Returns what was removed so the caller can offer undo
  removePapers: (ids: string[]) => Paper[]
  restorePapers: (papers: Paper[]) => void

  toggleStar: (id: string) => void
  setStarred: (ids: string[], starred: boolean) => void
  setStatus: (ids: string[], status: ReadStatus) => void
  setTags: (id: string, tags: string[]) => void
  addTag: (ids: string[], tag: string) => void
  removeTag: (ids: string[], tag: string) => void
  // Called when the PDF is opened: records the time and moves unread → reading
  markOpened: (id: string) => void
  setLastPage: (id: string, page: number) => void

  setNote: (paperId: string, content: string) => void
}

const normalizeTag = (tag: string) => tag.trim().toLowerCase().replace(/\s+/g, "-")

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      papers: Object.fromEntries(seedPapers.map((p) => [p.id, p])),
      highlights: {},
      notes: {},

      addPaper: (resolved, addedBy = "user") => {
        const paper: Paper = {
          id: newId(),
          title: resolved.title,
          authors: resolved.authors,
          year: resolved.year,
          venue: resolved.venue,
          abstract: resolved.abstract,
          ids: resolved.ids,
          pdf: resolved.pdf,
          addedAt: Date.now(),
          addedBy,
          starred: false,
          status: "unread",
          tags: [],
        }
        set((s) => ({ papers: { ...s.papers, [paper.id]: paper } }))
        return paper
      },

      updatePaper: (id, patch) =>
        set((s) => {
          const p = s.papers[id]
          if (!p) return s
          return { papers: { ...s.papers, [id]: { ...p, ...patch } } }
        }),

      removePapers: (ids) => {
        const removed = ids.map((id) => get().papers[id]).filter((p): p is Paper => !!p)
        set((s) => {
          const papers = { ...s.papers }
          const highlights = { ...s.highlights }
          const notes = { ...s.notes }
          for (const id of ids) {
            delete papers[id]
            delete notes[id]
            for (const h of Object.values(highlights)) if (h.paperId === id) delete highlights[h.id]
          }
          return { papers, highlights, notes }
        })
        return removed
      },

      restorePapers: (papers) =>
        set((s) => ({
          papers: { ...s.papers, ...Object.fromEntries(papers.map((p) => [p.id, p])) },
        })),

      toggleStar: (id) =>
        set((s) => {
          const p = s.papers[id]
          if (!p) return s
          return { papers: { ...s.papers, [id]: { ...p, starred: !p.starred } } }
        }),

      setStarred: (ids, starred) =>
        set((s) => {
          const papers = { ...s.papers }
          for (const id of ids) if (papers[id]) papers[id] = { ...papers[id], starred }
          return { papers }
        }),

      setStatus: (ids, status) =>
        set((s) => {
          const papers = { ...s.papers }
          for (const id of ids) if (papers[id]) papers[id] = { ...papers[id], status }
          return { papers }
        }),

      setTags: (id, tags) =>
        set((s) => {
          const p = s.papers[id]
          if (!p) return s
          const clean = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)))
          return { papers: { ...s.papers, [id]: { ...p, tags: clean } } }
        }),

      addTag: (ids, tag) => {
        const t = normalizeTag(tag)
        if (!t) return
        set((s) => {
          const papers = { ...s.papers }
          for (const id of ids) {
            const p = papers[id]
            if (p && !p.tags.includes(t)) papers[id] = { ...p, tags: [...p.tags, t] }
          }
          return { papers }
        })
      },

      removeTag: (ids, tag) =>
        set((s) => {
          const papers = { ...s.papers }
          for (const id of ids) {
            const p = papers[id]
            if (p && p.tags.includes(tag)) papers[id] = { ...p, tags: p.tags.filter((x) => x !== tag) }
          }
          return { papers }
        }),

      markOpened: (id) =>
        set((s) => {
          const p = s.papers[id]
          if (!p) return s
          return {
            papers: {
              ...s.papers,
              [id]: {
                ...p,
                lastOpenedAt: Date.now(),
                status: p.status === "unread" ? "reading" : p.status,
              },
            },
          }
        }),

      setLastPage: (id, page) =>
        set((s) => {
          const p = s.papers[id]
          if (!p || p.lastPage === page) return s
          return { papers: { ...s.papers, [id]: { ...p, lastPage: page } } }
        }),

      setNote: (paperId, content) =>
        set((s) => ({
          notes: { ...s.notes, [paperId]: { paperId, content, updatedAt: Date.now() } },
        })),
    }),
    { name: "owlit-library", version: 1 },
  ),
)

// All tags in use, most used first
export function collectTags(papers: Record<string, Paper>): string[] {
  const counts = new Map<string, number>()
  for (const p of Object.values(papers)) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}
