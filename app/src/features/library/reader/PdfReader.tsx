import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useState } from "react"
import { createPluginRegistration } from "@embedpdf/core"
import { EmbedPDF, useDocumentState, useRegistry } from "@embedpdf/core/react"
import { usePdfiumEngine } from "@embedpdf/engines/react"
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url"
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react"
import { GlobalPointerProvider, InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react"
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react"
import { Scroller, ScrollPluginPackage, useScrollCapability } from "@embedpdf/plugin-scroll/react"
import { SearchLayer, SearchPluginPackage } from "@embedpdf/plugin-search/react"
import { SelectionLayer, SelectionPluginPackage, useSelectionCapability } from "@embedpdf/plugin-selection/react"
import { TilingLayer, TilingPluginPackage } from "@embedpdf/plugin-tiling/react"
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react"
import { ZoomGestureWrapper, ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/react"
import { ExternalLinkIcon } from "lucide-react"
import { EmptyPlace } from "@/components/empty-place"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cleanPdfText } from "../lib/highlights"
import { useLibraryStore } from "../store"
import type { Highlight, Paper } from "@owlit/protocol"
import { useHighlightsByPage } from "../lib/use-highlights"
import { usePrefsStore } from "../prefs-store"
import { HighlightLayer } from "./HighlightLayer"
import { useHighlightHitTest } from "./highlight-hits"
import { LinkLayer, TRAIL_DEPTH, type ReturnMark } from "./LinkLayer"
import { boundsOf, locatePassage, type PassageTarget } from "./passages"
import { PassageRing } from "./PassageRing"
import { CitedLayer } from "./CitedLayer"
import { WearStrip } from "./WearStrip"
import { useReadWear } from "./wear"
import { usePositionMemory } from "./position"
import { ReaderControls } from "./ReaderControls"
import { useReaderStore } from "./reader-store"
import { SelectionMenu } from "./SelectionMenu"

// The PDF reader, composed from EmbedPDF's headless plugins so every pixel is owlit's own DOM
// and tokens. Highlights are owlit records that point at a page and rects; nothing is written
// into the PDF, which is why the annotation plugin is not used.

// The registry resolves order, but not missing dependencies: scroll needs viewport, zoom needs
// both, tiling needs render + scroll + viewport, selection needs the interaction manager.
const PLUGINS = [
  // Room around the pages so they read as sheets on the well, not as the well itself
  createPluginRegistration(ViewportPluginPackage, { viewportGap: 24 }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 16 }),
  createPluginRegistration(RenderPluginPackage),
  // Re-renders the visible region at the current scale, so text stays sharp when zoomed in
  createPluginRegistration(TilingPluginPackage),
  // Fit-width: a whole page squeezed into the pane is legible only as a picture
  createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
  // Popovers inside a page carry this attribute so clicks on them never start a text selection
  createPluginRegistration(InteractionManagerPluginPackage, { exclusionRules: { dataAttributes: ["data-reader-ui"] } }),
  createPluginRegistration(SelectionPluginPackage, { menuHeight: 44 }),
  createPluginRegistration(SearchPluginPackage),
]

type Engine = NonNullable<ReturnType<typeof usePdfiumEngine>["engine"]>

export function PdfReader({ paper }: { paper: Paper }) {
  // Above the per-paper remount: the engine carries a ~4.6 MB wasm module, so moving to the next
  // paper costs a fetch and a parse, not a boot. The wasm is served locally and font fallback
  // packs are off, so reading a paper makes no request besides the PDF itself.
  // worker: false runs pdfium on the main thread. With a worker the document never leaves
  // "loading" under the dev server (seen in owlit v4, not root-caused).
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl, worker: false, fontFallback: null })

  if (error) return <Message title={t`The PDF engine did not start`} detail={error.message} />
  if (isLoading || !engine) return <Loading />
  // Remounting per paper is more reliable than swapping documents under a live plugin tree
  return <Document key={paper.id} paper={paper} engine={engine} />
}

function Document({ paper, engine }: { paper: Paper; engine: Engine }) {
  const documentId = paper.id
  const url = paper.pdf?.url ?? ""
  // EmbedPDF keys its init effect on this array's identity; a fresh array tears the viewer down
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments: [{ url, documentId }] }),
      ...PLUGINS,
    ],
    [url, documentId],
  )

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      <Surface paper={paper} documentId={documentId} />
    </EmbedPDF>
  )
}

function Surface({ paper, documentId }: { paper: Paper; documentId: string }) {
  const doc = useDocumentState(documentId)
  const pdf = doc?.document ?? null
  const { registry } = useRegistry()
  const { provides: scrollCap } = useScrollCapability()
  const { provides: selectionCap } = useSelectionCapability()
  // Where following a link left from, most recent last; it belongs to this reading and dies with it
  const [trail, setTrail] = useState<ReturnMark[]>([])
  const setApi = useReaderStore((s) => s.setApi)
  const highlights = useHighlightsByPage(paper.id)

  usePositionMemory(documentId, paper)

  // What has been read of this paper: Owlit's cited sentences, the person's pages (wear.ts)
  const locateWear = useMemo(
    () => (registry && pdf && doc?.status === "loaded" ? (p: PassageTarget) => locatePassage(registry.getEngine(), pdf, p) : null),
    [registry, pdf, doc?.status],
  )
  useReadWear(paper.id, locateWear)

  useEffect(() => {
    if (!scrollCap) return
    const scroll = scrollCap.forDocument(documentId)
    const locate = (p: PassageTarget) => (registry && pdf ? locatePassage(registry.getEngine(), pdf, p) : Promise.resolve(null))
    const jumpToHighlight = (h: Highlight) => {
      const r = h.rects[0]
      useReaderStore.getState().close()
      scroll.scrollToPage({
        pageNumber: h.page + 1,
        pageCoordinates: { x: 0, y: r?.y ?? 0 },
        alignY: 30,
        behavior: "smooth",
      })
      useReaderStore.getState().flash(h.id)
    }
    setApi({
      paperId: paper.id,
      showPassage: async (p, mode) => {
        const at = await locate(p)
        if (!at || !at.rects.length) return false
        const box = boundsOf(at.rects)
        const ring = { passageId: p.id, page: at.page, box }
        if (mode === "hover") {
          useReaderStore.getState().setRing({ ...ring, pulse: false })
          return true
        }
        // Like a highlight reached from the list: in the upper part of the pane. The rings start once the
        // scroll has landed, or they play while the page is still moving.
        useReaderStore.getState().setRing(null)
        scroll.scrollToPage({ pageNumber: at.page + 1, pageCoordinates: { x: 0, y: box.y }, alignY: 25, behavior: "smooth" })
        setTimeout(() => useReaderStore.getState().setRing({ ...ring, pulse: true }), 450)
        return true
      },
      selectPassage: async (p) => {
        const at = await locate(p)
        if (!at || !selectionCap) return false
        const box = boundsOf(at.rects)
        useReaderStore.getState().setRing(null)
        scroll.scrollToPage({ pageNumber: at.page + 1, pageCoordinates: { x: 0, y: box.y }, alignY: 25, behavior: "smooth" })
        await selectionCap.forDocument(documentId).setSelection({ start: { page: at.page, index: at.from }, end: { page: at.page, index: at.to } }).toPromise()
        return true
      },
      jumpToHighlight,
      showPage: (page) => scroll.scrollToPage({ pageNumber: page + 1, behavior: "smooth" }),
      markPassage: async (p, color) => {
        const at = await locate(p)
        if (!at || !at.rects.length || !registry || !pdf) return null
        // The words as the PDF has them, like a highlight the user made; the quote if PDFium has none
        const [text] = await registry
          .getEngine()
          .getTextSlices(pdf, [{ pageIndex: at.page, charIndex: at.from, charCount: at.to - at.from + 1 }])
          .toPromise()
          .catch(() => [""])
        const h = useLibraryStore.getState().addHighlight({
          paperId: paper.id,
          page: at.page,
          rects: at.rects.map((r) => ({ ...r, page: at.page })),
          text: cleanPdfText([text ?? ""]) || p.start,
          color,
          addedBy: "agent",
        })
        jumpToHighlight(h)
        return h
      },
    })
    return () => setApi(null)
  }, [scrollCap, selectionCap, registry, pdf, documentId, setApi, paper.id])

  // Ready for jumps (whenReaderReady) once the pages are laid out and the saved place restored
  useEffect(() => {
    if (!scrollCap) return
    return scrollCap.onLayoutReady((e) => {
      if (e.documentId !== documentId || !e.isInitial) return
      setTimeout(() => {
        if (useReaderStore.getState().api?.paperId === paper.id) useReaderStore.setState({ ready: paper.id })
      }, 150)
    })
  }, [scrollCap, documentId, paper.id])

  // Leaving the paper closes whatever popover was open and drops any outline
  useEffect(
    () => () => {
      useReaderStore.getState().close()
      useReaderStore.getState().setRing(null)
    },
    [],
  )

  if (doc?.status === "error") {
    return (
      <Message
        title={t`This PDF could not be loaded`}
        detail={t`The server may not allow owlit to fetch it. It can still be opened in the browser.`}
        action={
          <Button variant="outline" size="sm" asChild>
            <a href={paper.pdf?.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              {t`Open in browser`}
            </a>
          </Button>
        }
      />
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      {/* Pages mount only once the document is in: render layers throw on a document still loading */}
      {doc?.status !== "loaded" ? (
        <Loading />
      ) : (
        <>
          <GlobalPointerProvider documentId={documentId}>
            {/* Viewport is the scroll box; ZoomGestureWrapper is the content inside it and must stay
                inside, or its inline-block shrinks the viewport to nothing before layout */}
            <Viewport documentId={documentId} className="h-full w-full overflow-auto">
              <ZoomGestureWrapper documentId={documentId}>
                <Scroller
                  documentId={documentId}
                  renderPage={({ pageIndex }) => (
                    <Page documentId={documentId} paperId={paper.id} pageIndex={pageIndex} highlights={highlights.get(pageIndex) ?? NONE} onFollow={(mark) => setTrail((t) => [...t, mark].slice(-TRAIL_DEPTH))} />
                  )}
                />
              </ZoomGestureWrapper>
            </Viewport>
          </GlobalPointerProvider>
          <ReaderControls documentId={documentId} back={trail.at(-1) ?? null} onBack={() => setTrail((t) => t.slice(0, -1))} />
          <WearStrip pageCount={pdf?.pageCount ?? 0} onPage={(i) => scrollCap?.forDocument(documentId).scrollToPage({ pageNumber: i + 1, behavior: "smooth" })} />
        </>
      )}
    </div>
  )
}

const NONE: Highlight[] = []

function Page({
  documentId,
  paperId,
  pageIndex,
  highlights,
  onFollow,
}: {
  documentId: string
  paperId: string
  pageIndex: number
  // The paper's highlights that cover this page
  highlights: Highlight[]
  onFollow: (mark: ReturnMark) => void
}) {
  const hit = useHighlightHitTest(documentId, highlights, pageIndex)
  const dim = usePrefsStore((s) => s.dimPdf)
  return (
    // The rendered page is an <img>: without this the browser starts dragging the picture,
    // cancels the pointer, and a text selection never ends
    <PagePointerProvider documentId={documentId} pageIndex={pageIndex} {...hit} onDragStart={(e) => e.preventDefault()} className="select-none [&_img]:[-webkit-user-drag:none]">
      <RenderLayer documentId={documentId} pageIndex={pageIndex} />
      <TilingLayer documentId={documentId} pageIndex={pageIndex} />
      {/* The page is white in both themes; a hairline gives it an edge on the light well */}
      <div className="pointer-events-none absolute inset-0 border border-(--pdf-page-edge)" />
      <SearchLayer documentId={documentId} pageIndex={pageIndex} highlightColor="var(--pdf-search)" activeHighlightColor="var(--pdf-search-active)" />
      <HighlightLayer documentId={documentId} paperId={paperId} pageIndex={pageIndex} highlights={highlights} />
      <PassageRing documentId={documentId} pageIndex={pageIndex} />
      {/* Dark theme only: a shade over the page and its marks alike, so their colours keep their relation */}
      {dim && <div className="pointer-events-none absolute inset-0 hidden bg-black/12 dark:block" />}
      <SelectionLayer
        documentId={documentId}
        pageIndex={pageIndex}
        textStyle={{ background: "var(--pdf-selection)" }}
        selectionMenu={(props) => <SelectionMenu {...props} documentId={documentId} paperId={paperId} />}
      />
      {/* Last, so its hotspots sit above the selection layer and get the click */}
      <LinkLayer documentId={documentId} pageIndex={pageIndex} onFollow={onFollow} />
      {/* In the margin, above the links: Owlit's cited sentences answer the pointer */}
      <CitedLayer documentId={documentId} pageIndex={pageIndex} />
    </PagePointerProvider>
  )
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-muted-foreground"><Spinner /></div>
}

function Message({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <EmptyPlace title={title} detail={detail} className="m-auto p-6">
      {action}
    </EmptyPlace>
  )
}
