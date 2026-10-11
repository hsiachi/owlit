import { useMemo } from "react"
import { useLibraryStore } from "../store"
import type { Highlight } from "../types"
import { paperHighlights } from "./highlights"

// A paper's highlights in reading order
export function usePaperHighlights(paperId: string) {
  const all = useLibraryStore((s) => s.highlights)
  return useMemo(() => paperHighlights(all, paperId), [all, paperId])
}

export function useHighlightCount(paperId: string) {
  return useLibraryStore((s) => Object.values(s.highlights).filter((h) => h.paperId === paperId).length)
}

// A paper's highlights under each page they cover, oldest first so newer ones draw on top. Worked out
// once for the reader, which hands each page its own.
export function useHighlightsByPage(paperId: string): ReadonlyMap<number, Highlight[]> {
  const all = useLibraryStore((s) => s.highlights)
  return useMemo(() => {
    const byPage = new Map<number, Highlight[]>()
    const own = Object.values(all)
      .filter((h) => h.paperId === paperId)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const h of own) {
      for (const page of new Set(h.rects.map((r) => r.page))) {
        const list = byPage.get(page)
        if (list) list.push(h)
        else byPage.set(page, [h])
      }
    }
    return byPage
  }, [all, paperId])
}
