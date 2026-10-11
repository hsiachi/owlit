import { useEffect, useState } from "react"
import { useDocumentState, useRegistry } from "@embedpdf/core/react"
import {
  PdfActionType,
  PdfAnnotationSubtype,
  PdfZoomMode,
  type PdfDestinationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfLinkAnnoObject,
} from "@embedpdf/models"
import { useScroll } from "@embedpdf/plugin-scroll/react"

// The links a PDF already carries, made clickable. Only internal jumps (a citation marker to its
// reference, "Section 3" to section 3): external links would leave the app, and that is a
// separate decision. A PDF without link annotations simply gets none.

// A rule under the text, never a fill: the glyphs are pixels we cannot redraw, and a rule
// cannot cover one. Fixed colours, because the page under them is white in both themes.
const LINK_RULE = "inset 0 -1px 0 0 color-mix(in oklch, var(--pdf-link) 40%, transparent)"
const LINK_RULE_HOVER = "inset 0 -2px 0 0 var(--pdf-link)"

// Where the reader was: a page and a point on it, so it survives a zoom
export interface ReturnMark {
  pageNumber: number
  pageCoordinates: { x: number; y: number }
}

// A little air above the destination, in PDF points
const LEAD = 12

export const TRAIL_DEPTH = 20

interface Hotspot {
  key: string
  // Percentages of the page box, so a hotspot needs to know nothing about zoom
  left: number
  top: number
  width: number
  height: number
  destination: PdfDestinationObject
}

function destinationOf(link: PdfLinkAnnoObject): PdfDestinationObject | null {
  const target = link.target
  if (!target) return null
  if (target.type === "destination") return target.destination
  if (target.action.type === PdfActionType.Goto) return target.action.destination
  return null
}

// undefined means the top of the page: fit modes name a page, not a line, and an XYZ target
// without a y reports 0, which in PDF space is the bottom of the page
function pointOf(doc: PdfDocumentObject, destination: PdfDestinationObject): ReturnMark["pageCoordinates"] | undefined {
  const page = doc.pages[destination.pageIndex]
  if (!page || destination.zoom.mode !== PdfZoomMode.XYZ) return undefined
  const { y } = destination.zoom.params
  if (!(y > 0)) return undefined
  // Destinations are in PDF user space (origin bottom-left); scrolling is top-left
  return { x: 0, y: Math.max(0, page.size.height - y - LEAD) }
}

// A page's links, read once per document: pages unmount and mount again as they scroll out of view and back
const linksRead = new WeakMap<PdfDocumentObject, Map<number, Promise<Hotspot[]>>>()

function pageLinks(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number): Promise<Hotspot[]> {
  let byPage = linksRead.get(doc)
  if (!byPage) linksRead.set(doc, (byPage = new Map()))
  let links = byPage.get(pageIndex)
  if (!links) {
    links = readLinks(engine, doc, pageIndex)
    byPage.set(pageIndex, links)
  }
  return links
}

async function readLinks(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number): Promise<Hotspot[]> {
  const page = doc.pages[pageIndex]
  // A rotated page would need every rect rotated too; it gets no links rather than wrong ones
  if (!page || page.rotation !== 0) return []
  // A page whose annotations do not read is a page without links
  const annotations = await engine.getPageAnnotations(doc, page).toPromise().catch(() => [])
  const found: Hotspot[] = []
  annotations.forEach((a, i) => {
    if (a.type !== PdfAnnotationSubtype.LINK) return
    const destination = destinationOf(a)
    if (!destination) return
    const { origin, size } = a.rect
    found.push({
      key: `${a.id ?? i}-${i}`,
      left: (origin.x / page.size.width) * 100,
      top: (origin.y / page.size.height) * 100,
      width: (size.width / page.size.width) * 100,
      height: (size.height / page.size.height) * 100,
      destination,
    })
  })
  return found
}

export function LinkLayer({ documentId, pageIndex, onFollow }: { documentId: string; pageIndex: number; onFollow: (mark: ReturnMark) => void }) {
  const { registry } = useRegistry()
  const { provides: scroll } = useScroll(documentId)
  // The document object, not the whole state, whose identity changes on every zoom step
  const doc = useDocumentState(documentId)?.document ?? null
  const [hotspots, setHotspots] = useState<Hotspot[]>([])

  useEffect(() => {
    if (!registry || !doc) return
    let live = true
    void pageLinks(registry.getEngine(), doc, pageIndex).then((found) => live && setHotspots(found))
    return () => {
      live = false
    }
  }, [registry, doc, pageIndex])

  if (!doc || hotspots.length === 0) return null

  return (
    // Above the interaction manager's overlay (z 10), or the pointer never reaches a hotspot
    <div className="pointer-events-none absolute inset-0 z-20">
      {hotspots.map((h) => (
        <button
          type="button"
          key={h.key}
          aria-label={`Go to page ${h.destination.pageIndex + 1}`}
          onClick={() => {
            if (!scroll) return
            const metrics = scroll.getMetrics()
            const here = metrics.pageVisibilityMetrics.find((p) => p.pageNumber === metrics.currentPage)
            onFollow({ pageNumber: metrics.currentPage, pageCoordinates: { x: 0, y: here?.original.pageY ?? 0 } })
            // Not smooth: a reference is usually pages away. Back makes the cut recoverable.
            scroll.scrollToPage({ pageNumber: h.destination.pageIndex + 1, pageCoordinates: pointOf(doc, h.destination), behavior: "instant" })
          }}
          style={{
            left: `${h.left}%`,
            top: `${h.top}%`,
            width: `${h.width}%`,
            height: `${h.height}%`,
            ["--link-rule" as string]: LINK_RULE,
            ["--link-rule-hover" as string]: LINK_RULE_HOVER,
          }}
          className="pointer-events-auto absolute cursor-pointer bg-transparent shadow-(--link-rule) outline-none hover:shadow-(--link-rule-hover)"
        />
      ))}
    </div>
  )
}
