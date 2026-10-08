import { useEffect, useRef } from "react"
import { useScrollCapability } from "@embedpdf/plugin-scroll/react"
import { useLibraryStore } from "../store"
import type { Paper, ReadingPosition } from "../types"

// Reopen a paper where it was left, and keep track of where that is. Nothing is shown for it:
// the paper is simply there.
export function usePositionMemory(documentId: string, paper: Paper) {
  // The capability, not useScroll's per-document scope, which is a new object on every render
  const { provides: scrollCap } = useScrollCapability()
  const setPosition = useLibraryStore((s) => s.setPosition)
  // Read once: the saved position is where to start, not something to follow while reading
  const initial = useRef(paper.position)
  // Saving waits for the restore, or the first layout (page 1) would overwrite the saved place
  const restored = useRef(false)
  const pending = useRef<ReadingPosition | null>(null)

  useEffect(() => {
    if (!scrollCap) return
    return scrollCap.onLayoutReady((e) => {
      if (e.documentId !== documentId || !e.isInitial) return
      const pos = initial.current
      if (pos && (pos.page > 1 || pos.y > 0)) {
        scrollCap.forDocument(documentId).scrollToPage({ pageNumber: pos.page, pageCoordinates: { x: 0, y: pos.y }, behavior: "instant" })
      }
      // Let the jump land before listening, so its own scroll events are not mistaken for reading
      requestAnimationFrame(() => (restored.current = true))
    })
  }, [scrollCap, documentId])

  useEffect(() => {
    if (!scrollCap) return
    const scroll = scrollCap.forDocument(documentId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      if (pending.current) setPosition(paper.id, pending.current)
      pending.current = null
    }
    const off = scroll.onScroll((m) => {
      if (!restored.current) return
      // The top of the screen: the first visible page and how far down it the view starts
      const top = [...m.pageVisibilityMetrics].sort((a, b) => a.pageNumber - b.pageNumber)[0]
      if (!top) return
      pending.current = { page: top.pageNumber, y: Math.round(top.original.pageY) }
      clearTimeout(timer)
      timer = setTimeout(flush, 400)
    })
    return () => {
      off()
      clearTimeout(timer)
      flush()
    }
  }, [scrollCap, documentId, paper.id, setPosition])
}
