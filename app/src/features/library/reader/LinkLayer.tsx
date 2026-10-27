import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { CARD_CLOSE_DELAY, CARD_OPEN_DELAY } from "@/components/citation"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { appearanceOf, useSettings } from "@/features/settings/store"
import { linkPreview, type PageLink, type Preview as LinkPreview } from "./link-preview"

// The links a PDF already carries, made clickable. Only internal jumps (a citation marker to its
// reference, "Section 3" to section 3): external links would leave the app, and that is a
// separate decision. A PDF without link annotations simply gets none. Resting on one shows where it
// goes (link-preview.ts), so a reference can be read without leaving the page.

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
  // The same box in PDF points, to read the link's own words
  rect: PageLink["rect"]
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
      rect: { x: origin.x, y: origin.y, w: size.width, h: size.height },
      destination,
    })
  })
  return found
}

// A link's name for a screen reader, by the page number it goes to
const goToPage = (page: number) => t`Go to page ${page}`

export function LinkLayer({ documentId, pageIndex, onFollow }: { documentId: string; pageIndex: number; onFollow: (mark: ReturnMark) => void }) {
  const { registry } = useRegistry()
  const { provides: scroll } = useScroll(documentId)
  const state = useDocumentState(documentId)
  // Effects key on the document object, not the whole state, whose identity changes on every zoom step
  const doc = state?.document ?? null
  const zoom = state?.scale ?? 1
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

  const follow = (h: Hotspot) => {
    if (!scroll) return
    const metrics = scroll.getMetrics()
    const here = metrics.pageVisibilityMetrics.find((p) => p.pageNumber === metrics.currentPage)
    onFollow({ pageNumber: metrics.currentPage, pageCoordinates: { x: 0, y: here?.original.pageY ?? 0 } })
    // Not smooth: a reference is usually pages away. Back makes the cut recoverable.
    scroll.scrollToPage({ pageNumber: h.destination.pageIndex + 1, pageCoordinates: pointOf(doc, h.destination), behavior: "instant" })
  }

  return (
    // Above the interaction manager's overlay (z 10), or the pointer never reaches a hotspot
    <div className="pointer-events-none absolute inset-0 z-20">
      {hotspots.map((h) => (
        <LinkSpot
          key={h.key}
          documentId={documentId}
          doc={doc}
          pageIndex={pageIndex}
          hotspot={h}
          onArrive={(link) => registry && void linkPreview(registry.getEngine(), doc, link, zoom)}
          onFollow={() => follow(h)}
        />
      ))}
    </div>
  )
}

function LinkSpot({
  documentId,
  doc,
  pageIndex,
  hotspot: h,
  onArrive,
  onFollow,
}: {
  documentId: string
  doc: PdfDocumentObject
  pageIndex: number
  hotspot: Hotspot
  // The pointer reached the link: its preview starts now, during the card's open delay
  onArrive: (link: PageLink) => void
  onFollow: () => void
}) {
  // Closed by a click, or the card stays over the page the link just jumped to
  const [open, setOpen] = useState(false)
  // A press that starts on the link (a selection dragged from it) keeps the card shut until the pointer leaves
  const held = useRef(false)
  const link = useMemo<PageLink>(() => ({ pageIndex, rect: h.rect, destination: h.destination }), [pageIndex, h])
  const follow = () => {
    setOpen(false)
    onFollow()
  }
  return (
    <HoverCard open={open} onOpenChange={(next) => setOpen(next && !held.current)} openDelay={CARD_OPEN_DELAY} closeDelay={CARD_CLOSE_DELAY}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={goToPage(h.destination.pageIndex + 1)}
          onClick={follow}
          onPointerEnter={(e) => {
            // A selection dragged across the link: preventDefault keeps Radix from starting the card's timer
            if (e.buttons) return e.preventDefault()
            onArrive(link)
          }}
          onPointerDown={() => {
            held.current = true
            setOpen(false)
          }}
          onPointerLeave={() => (held.current = false)}
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
      </HoverCardTrigger>
      {/* Above the text, the way the eye came: the lines below are the ones still to read */}
      <HoverCardContent data-reader-ui side="top" className="menu-surface w-auto max-w-none rounded-xl p-1.5">
        <Preview documentId={documentId} doc={doc} link={link} onFollow={follow} />
      </HoverCardContent>
    </HoverCard>
  )
}

// What the link points at; a click on it follows the link. A destination with no place on its page says
// only which page.
function Preview({ documentId, doc, link, onFollow }: { documentId: string; doc: PdfDocumentObject; link: PageLink; onFollow: () => void }) {
  const { registry } = useRegistry()
  const zoom = useDocumentState(documentId)?.scale ?? 1
  const dim = useSettings((s) => appearanceOf(s.view).dimPdf !== false)
  // undefined while it is made
  const [shown, setShown] = useState<LinkPreview | null>()

  useEffect(() => {
    if (!registry) return
    let live = true
    void linkPreview(registry.getEngine(), doc, link, zoom).then((p) => live && setShown(p))
    return () => {
      live = false
    }
  }, [registry, doc, link, zoom])

  const page = link.destination.pageIndex + 1
  if (shown === undefined) return null
  if (shown === null) return <p className="px-1.5 py-0.5 text-detail text-muted-foreground">{t`Page ${page}`}</p>
  return (
    <button type="button" aria-label={goToPage(page)} onClick={onFollow} className="relative block cursor-pointer overflow-hidden rounded-md">
      <img src={shown.url} alt="" draggable={false} style={{ width: shown.width, height: shown.height }} className="block" />
      {/* The page's own shade in the dark theme, so the cut matches the page it came from */}
      {dim && <div className="pointer-events-none absolute inset-0 hidden bg-black/12 dark:block" />}
    </button>
  )
}
