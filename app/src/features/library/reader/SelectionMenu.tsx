import { useSelectionCapability } from "@embedpdf/plugin-selection/react"
import type { SelectionSelectionMenuProps } from "@embedpdf/plugin-selection/react"
import { copyText } from "@/lib/clipboard"
import { cleanPdfText } from "../lib/highlights"
import { useLibraryStore } from "../store"
import type { HighlightColor, PageRect } from "@owlit/protocol"
import { HighlightToolbar } from "./HighlightToolbar"
import { useReaderStore } from "./reader-store"
import { askAboutPassage } from "../actions"
import { floatOn } from "./float"

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

  return (
    // EmbedPDF stacks its menu wrapper at z 3, under the page's link hotspots (z 20): a toolbar over a line
    // with a citation gave the click to the citation, and Ask Owlit jumped the PDF to the references.
    // Raised over the links like the highlight popover (HighlightLayer's Anchor).
    <div {...menuWrapperProps} style={{ ...menuWrapperProps.style, zIndex: 30 }}>
      <div className="pointer-events-auto absolute" style={floatOn(rect.size.width / 2, 0, rect.size.height, placement.suggestTop)}>
        <HighlightToolbar
          onColor={(c) => void keep(c)}
          onCopy={async () => copyText(await selectedText())}
          onComment={async () => {
            const h = await keep(useLibraryStore.getState().lastColor)
            if (h) useReaderStore.getState().open(h.id, { commenting: true })
          }}
          onAsk={async () => {
            const text = await selectedText()
            if (!text) return
            const page = Math.min(...(sel?.getFormattedSelection() ?? []).map((p) => p.pageIndex)) + 1
            const rects = selectedRects()
            sel?.clear()
            askAboutPassage(paperId, { text, ...(Number.isFinite(page) ? { page } : {}) }, rects)
          }}
          onClose={() => sel?.clear()}
        />
      </div>
    </div>
  )
}
