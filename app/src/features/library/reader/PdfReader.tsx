import { useEffect, useMemo, useRef, useState } from "react"
import { createPluginRegistration } from "@embedpdf/core"
import { EmbedPDF, useDocumentState } from "@embedpdf/core/react"
import { usePdfiumEngine } from "@embedpdf/engines/react"
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url"
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react"
import { GlobalPointerProvider, InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react"
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react"
import { Scroller, ScrollPluginPackage, useScrollCapability } from "@embedpdf/plugin-scroll/react"
import { SearchLayer, SearchPluginPackage } from "@embedpdf/plugin-search/react"
import { SelectionLayer, SelectionPluginPackage } from "@embedpdf/plugin-selection/react"
import { TilingLayer, TilingPluginPackage } from "@embedpdf/plugin-tiling/react"
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react"
import { ZoomGestureWrapper, ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/react"
import { ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { Paper } from "../types"
import { HighlightLayer, useHighlightHitTest } from "./HighlightLayer"
import { LinkLayer, TRAIL_DEPTH, type ReturnMark } from "./LinkLayer"
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

  if (error) return <Message title="The PDF engine did not start" detail={error.message} />
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
  const { provides: scrollCap } = useScrollCapability()
  // Where following a link left from, most recent last; it belongs to this reading and dies with it
  const [trail, setTrail] = useState<ReturnMark[]>([])
  const setApi = useReaderStore((s) => s.setApi)

  usePositionMemory(documentId, paper)

  useEffect(() => {
    if (!scrollCap) return
    const scroll = scrollCap.forDocument(documentId)
    setApi({
      jumpToHighlight: (h) => {
        const r = h.rects[0]
        useReaderStore.getState().close()
        scroll.scrollToPage({
          pageNumber: h.page + 1,
          pageCoordinates: { x: 0, y: r?.y ?? 0 },
          alignY: 30,
          behavior: "smooth",
        })
        useReaderStore.getState().flash(h.id)
      },
    })
    return () => setApi(null)
  }, [scrollCap, documentId, setApi])

  // Leaving the paper closes whatever popover was open
  useEffect(() => () => useReaderStore.getState().close(), [])

  if (doc?.status === "error") {
    return (
      <Message
        title="This PDF could not be loaded"
        detail="The server may not allow owlit to fetch it. It can still be opened in the browser."
        action={
          <Button variant="outline" size="sm" asChild>
            <a href={paper.pdf?.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Open in browser
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
                    <Page documentId={documentId} paperId={paper.id} pageIndex={pageIndex} onFollow={(mark) => setTrail((t) => [...t, mark].slice(-TRAIL_DEPTH))} />
                  )}
                />
              </ZoomGestureWrapper>
            </Viewport>
          </GlobalPointerProvider>
          <ReaderControls documentId={documentId} back={trail.at(-1) ?? null} onBack={() => setTrail((t) => t.slice(0, -1))} />
        </>
      )}
    </div>
  )
}

function Page({ documentId, paperId, pageIndex, onFollow }: { documentId: string; paperId: string; pageIndex: number; onFollow: (mark: ReturnMark) => void }) {
  const hit = useHighlightHitTest(documentId, paperId, pageIndex)
  return (
    // The rendered page is an <img>: without this the browser starts dragging the picture,
    // cancels the pointer, and a text selection never ends
    <PagePointerProvider documentId={documentId} pageIndex={pageIndex} {...hit} onDragStart={(e) => e.preventDefault()} className="select-none [&_img]:[-webkit-user-drag:none]">
      <RenderLayer documentId={documentId} pageIndex={pageIndex} />
      <TilingLayer documentId={documentId} pageIndex={pageIndex} />
      {/* The page is white in both themes; a hairline gives it an edge on the light well */}
      <div className="pointer-events-none absolute inset-0 border border-(--pdf-page-edge)" />
      <SearchLayer documentId={documentId} pageIndex={pageIndex} highlightColor="var(--pdf-search)" activeHighlightColor="var(--pdf-search-active)" />
      <HighlightLayer documentId={documentId} paperId={paperId} pageIndex={pageIndex} />
      <SelectionLayer
        documentId={documentId}
        pageIndex={pageIndex}
        textStyle={{ background: "var(--pdf-selection)" }}
        selectionMenu={(props) => <SelectionMenu {...props} documentId={documentId} paperId={paperId} />}
      />
      {/* Last, so its hotspots sit above the selection layer and get the click */}
      <LinkLayer documentId={documentId} pageIndex={pageIndex} onFollow={onFollow} />
    </PagePointerProvider>
  )
}

function Loading() {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // A spinner that flashes for a fast load is noise; wait a beat before showing one
  useEffect(() => {
    timer.current = setTimeout(() => setShow(true), 300)
    return () => clearTimeout(timer.current)
  }, [])
  return <div className="flex h-full items-center justify-center text-muted-foreground">{show && <Spinner />}</div>
}

function Message({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
