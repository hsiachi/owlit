import { create } from "zustand"
import { persist } from "zustand/middleware"
import { newId } from "@/lib/id"
import { isDesktop } from "@/lib/rpc"
import type { LibraryClient } from "./client"
import { MockLibraryClient } from "./mock-client"
import { RpcLibraryClient } from "./rpc-client"
import { seedPapers } from "./mocks/papers"
import type { Highlight, HighlightColor, Paper, PaperNote, ReadingPosition, ReadStatus, ResolvedPaper } from "./types"
import { normalizeTag } from "./lib/tags"

export const libraryClient: LibraryClient = isDesktop ? new RpcLibraryClient() : new MockLibraryClient()

// In the desktop app papers live in the workspace (library/papers/ and .owlit/papers/, through
// ./disk); in a plain browser (pnpm dev:web) seeded papers are kept in localStorage as before.

interface LibraryState {
  papers: Record<string, Paper>
  // Ids papers had before they moved (a local file given its DOI): old → new
  aliases: Record<string, string>
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
  setPosition: (id: string, position: ReadingPosition) => void

  addHighlight: (h: Omit<Highlight, "id" | "createdAt">) => Highlight
  updateHighlight: (id: string, patch: Partial<Pick<Highlight, "color" | "comment">>) => void
  // Returns what was removed so the caller can offer undo
  removeHighlight: (id: string) => Highlight | undefined
  restoreHighlight: (h: Highlight) => void
  // The colour a new highlight gets when none was picked, e.g. from Comment
  lastColor: HighlightColor

  setNote: (paperId: string, content: string) => void
}

// A removed paper's highlights and note, held until the session ends so Undo brings them back too
const removedWith = new Map<string, { highlights: Highlight[]; note?: PaperNote }>()

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      papers: isDesktop ? {} : Object.fromEntries(seedPapers.map((p) => [p.id, p])),
      aliases: {},
      highlights: {},
      notes: {},

      addPaper: (resolved, addedBy = "user") => {
        const paper: Paper = {
          // The library's id when a lookup gave one (doi-…, arxiv-…)
          id: resolved.id ?? newId(),
          title: resolved.title,
          authors: resolved.authors,
          year: resolved.year,
          venue: resolved.venue,
          abstract: resolved.abstract,
          ids: resolved.ids,
          pdf: resolved.pdf,
          kind: resolved.kind,
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
            const own = Object.values(highlights).filter((h) => h.paperId === id)
            removedWith.set(id, { highlights: own, note: notes[id] })
            delete papers[id]
            delete notes[id]
            for (const h of own) delete highlights[h.id]
          }
          return { papers, highlights, notes }
        })
        return removed
      },

      restorePapers: (papers) =>
        set((s) => {
          const highlights = { ...s.highlights }
          const notes = { ...s.notes }
          for (const p of papers) {
            const kept = removedWith.get(p.id)
            if (!kept) continue
            for (const h of kept.highlights) highlights[h.id] = h
            if (kept.note) notes[p.id] = kept.note
            removedWith.delete(p.id)
          }
          return { papers: { ...s.papers, ...Object.fromEntries(papers.map((p) => [p.id, p])) }, highlights, notes }
        }),

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

      setPosition: (id, position) =>
        set((s) => {
          const p = s.papers[id]
          if (!p || (p.position?.page === position.page && p.position.y === position.y)) return s
          return { papers: { ...s.papers, [id]: { ...p, position } } }
        }),

      addHighlight: (h) => {
        const highlight: Highlight = { ...h, id: newId(), createdAt: Date.now() }
        set((s) => ({ highlights: { ...s.highlights, [highlight.id]: highlight }, lastColor: highlight.color }))
        return highlight
      },

      updateHighlight: (id, patch) =>
        set((s) => {
          const h = s.highlights[id]
          if (!h) return s
          return {
            highlights: { ...s.highlights, [id]: { ...h, ...patch } },
            lastColor: patch.color ?? s.lastColor,
          }
        }),

      removeHighlight: (id) => {
        const removed = get().highlights[id]
        if (!removed) return undefined
        set((s) => {
          const highlights = { ...s.highlights }
          delete highlights[id]
          return { highlights }
        })
        return removed
      },

      restoreHighlight: (h) => set((s) => ({ highlights: { ...s.highlights, [h.id]: h } })),

      lastColor: "yellow",

      setNote: (paperId, content) =>
        set((s) => ({
          notes: { ...s.notes, [paperId]: { paperId, content, updatedAt: Date.now() } },
        })),
    }),
    {
      name: "owlit-library",
      version: 2,
      // In the desktop app the library is the workspace's: only the last highlight colour is this profile's
      partialize: (s) => (isDesktop ? { lastColor: s.lastColor } : s) as LibraryState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LibraryState>
        return isDesktop ? { ...current, lastColor: p.lastColor ?? current.lastColor } : { ...current, ...p }
      },
      // v1 kept only a page number; it becomes the top of that page
      migrate: (persisted, version) => {
        const state = persisted as { papers?: Record<string, Paper & { lastPage?: number }> }
        if (version < 2 && state.papers) {
          for (const p of Object.values(state.papers)) {
            if (p.lastPage) p.position = { page: p.lastPage, y: 0 }
            delete p.lastPage
          }
        }
        return state as LibraryState
      },
    },
  ),
)

// All tags in use, most used first
export function collectTags(papers: Record<string, Paper>): string[] {
  const counts = new Map<string, number>()
  for (const p of Object.values(papers)) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}
