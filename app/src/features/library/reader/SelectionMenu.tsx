import { useSelectionCapability } from "@embedpdf/plugin-selection/react"
import type { SelectionSelectionMenuProps } from "@embedpdf/plugin-selection/react"
import { copyText } from "@/lib/clipboard"
import { cleanPdfText } from "../lib/highlights"
import { useLibraryStore } from "../store"
import type { HighlightColor, PageRect } from "../types"
import { HighlightToolbar } from "./HighlightToolbar"
import { useReaderStore } from "./reader-store"
import { useAgentWindow } from "@/features/agent/store"
import { paperMentionable } from "@/features/docs/lib/mentions"

// Space between the selection and the popover
const GAP = 8

// Floats over a fresh selection. A colour keeps it as a highlight; Comment keeps it in the last
// colour used and opens the comment field on it.
export function SelectionMenu({ rect, menuWrapperProps, placement, documentId, paperId }: SelectionSelectionMenuProps & { documentId: string; paperId: string }) {
  const { provides: selection } = useSelectionCapability()
  const addHighlight = useLibraryStore((s) => s.addHighlight)
  const sel = selection?.forDocument(documentId)

  const selectedText = async () => cleanPdfText((await sel?.getSelectedText().toPromise()) ?? [])

  const selectedRects = (): PageRect[] =>
    (sel?.getFormattedSelection() ?? []).flatMap((p) =>
      p.segmentRects.map((r) => ({ page: p.pageIndex, x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height })),
    )

  const keep = async (color: HighlightColor) => {
    if (!sel) return null
    const parts = sel.getFormattedSelection()
    const rects = selectedRects()
    if (rects.length === 0) return null
    const text = await selectedText()
    const h = addHighlight({ paperId, page: Math.min(...parts.map((p) => p.pageIndex)), rects, text, color })
    sel.clear()
    return h
  }

  const above = placement.suggestTop
  return (
    <div {...menuWrapperProps}>
      <div
        className="pointer-events-auto absolute"
        style={{
          left: rect.size.width / 2,
          top: above ? -GAP : rect.size.height + GAP,
          transform: `translate(-50%, ${above ? "-100%" : "0"})`,
        }}
      >
        <HighlightToolbar
          onColor={(c) => void keep(c)}
          onCopy={async () => copyText(await selectedText())}
          onComment={async () => {
            const h = await keep(useLibraryStore.getState().lastColor)
            if (h) useReaderStore.getState().open(h.id, { commenting: true })
          }}
          onAsk={async () => {
            const paper = useLibraryStore.getState().papers[paperId]
            const text = await selectedText()
            if (!paper || !text) return
            const page = Math.min(...(sel?.getFormattedSelection() ?? []).map((p) => p.pageIndex)) + 1
            const rects = selectedRects()
            sel?.clear()
            useAgentWindow.getState().open({ text, source: paperMentionable(paper), ...(Number.isFinite(page) ? { page } : {}) }, rects.length ? { paperId, rects } : undefined)
          }}
          onClose={() => sel?.clear()}
        />
      </div>
    </div>
  )
}
