import { useRef } from "react"
import { useDocumentState } from "@embedpdf/core/react"
import type { Highlight } from "../types"
import { useReaderStore } from "./reader-store"

// Clicks and hovers on highlights, read off the page itself so a drag that starts on a highlight
// still selects text. A press that does not move is a click.
export function useHighlightHitTest(documentId: string, highlights: Highlight[], pageIndex: number) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const down = useRef<{ x: number; y: number } | null>(null)

  const hitAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - box.left) / scale
    const y = (e.clientY - box.top) / scale
    const pad = 1.5
    // Newest first, so overlapping highlights resolve to the one drawn last
    for (let i = highlights.length - 1; i >= 0; i--) {
      const h = highlights[i]
      if (h.rects.some((r) => r.page === pageIndex && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad)) return h
    }
    return null
  }

  const onReaderUi = (e: React.PointerEvent) => e.target instanceof HTMLElement && !!e.target.closest("[data-reader-ui], button")

  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      down.current = e.button === 0 && !onReaderUi(e) ? { x: e.clientX, y: e.clientY } : null
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const start = down.current
      down.current = null
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
      const h = hitAt(e)
      if (h) useReaderStore.getState().open(h.id)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons !== 0 || onReaderUi(e)) return
      const id = hitAt(e)?.id ?? null
      if (useReaderStore.getState().hoverId !== id) useReaderStore.setState({ hoverId: id })
    },
    onPointerLeave: () => {
      if (useReaderStore.getState().hoverId) useReaderStore.setState({ hoverId: null })
    },
  }
}
