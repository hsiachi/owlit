import { useEffect, useRef, useState } from "react"
import { useDocumentState } from "@embedpdf/core/react"
import { useScroll, useScrollCapability } from "@embedpdf/plugin-scroll/react"
import { useSearch, useSearchCapability } from "@embedpdf/plugin-search/react"
import { useZoom, ZoomMode } from "@embedpdf/plugin-zoom/react"
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ReturnMark } from "./LinkLayer"

// Zoom and find float over the page instead of sitting in a toolbar above it: no band of chrome
// before the document starts, and the controls rest on the thing they act on.

// Floating material, the same as menus (popover surface, hairline ring, soft shadow), fully rounded. z-30 keeps it above
// the selection layer and the interaction overlay (z 10) and the link layer (z 20).
const PILL = "z-30 flex h-8 items-center gap-0.5 rounded-full bg-popover p-1 text-xs text-muted-foreground shadow-md ring-1 ring-foreground/8 dark:ring-foreground/14"
const ITEM = "flex h-6 items-center rounded-full transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
const ICON = cn(ITEM, "w-6 justify-center [&_svg]:size-3.5")

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ReaderControls({ documentId, back, onBack }: { documentId: string; back: ReturnMark | null; onBack: () => void }) {
  const [searching, setSearching] = useState(false)

  // ⌘F finds in the paper rather than in the page around it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <div className="pointer-events-none absolute top-3 right-3 z-30 flex">
        <div className="pointer-events-auto">
          {searching ? (
            <SearchPill documentId={documentId} onClose={() => setSearching(false)} />
          ) : (
            <div className={PILL}>
              <ZoomReadout documentId={documentId} />
              <Tip label="Find in paper">
                <button type="button" aria-label="Find in paper" onClick={() => setSearching(true)} className={ICON}>
                  <SearchIcon />
                </button>
              </Tip>
            </div>
          )}
        </div>
      </div>
      <PageIndicator documentId={documentId} back={back} onBack={onBack} />
    </>
  )
}

// The readout is the control: it cycles fit width → 100% → fit page. ⌘ + wheel and pinch zoom
// freely, so there is no stepper. The number is muted while a fit mode is in force.
function ZoomReadout({ documentId }: { documentId: string }) {
  const { state, provides } = useZoom(documentId)
  const isMode = typeof state.zoomLevel === "string"
  const next = state.zoomLevel === ZoomMode.FitWidth ? 1 : state.zoomLevel === ZoomMode.FitPage ? ZoomMode.FitWidth : ZoomMode.FitPage
  const label = state.zoomLevel === ZoomMode.FitWidth ? "Fit width · click for 100%" : state.zoomLevel === ZoomMode.FitPage ? "Fit page · click to fit width" : "Click to fit the page"
  return (
    <Tip label={label}>
      <button type="button" onClick={() => provides?.requestZoom(next)} className={cn(ITEM, "px-2 tabular-nums", !isMode && "text-foreground")}>
        {Math.round(state.currentZoomLevel * 100)}%
      </button>
    </Tip>
  )
}

// Find opens in place of the zoom pill, so everything floating over the page stays one object
function SearchPill({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { state, provides } = useSearch(documentId)
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)


  useEffect(() => {
    input.current?.focus()
  }, [])

  // The search plugin only marks the current match; bringing it into view is ours to do. Stable
  // capabilities here, since the per-document scopes are new objects on every render.
  const { provides: searchCap } = useSearchCapability()
  const { provides: scrollCap } = useScrollCapability()

  useEffect(() => {
    if (!searchCap) return
    searchCap.startSearch(documentId)
    return () => searchCap.stopSearch(documentId)
  }, [searchCap, documentId])

  useEffect(() => {
    if (!searchCap || !scrollCap) return
    return searchCap.onActiveResultChange((e) => {
      if (e.documentId !== documentId) return
      const r = searchCap.getState(documentId).results[e.index]
      if (!r) return
      scrollCap.forDocument(documentId).scrollToPage({
        pageNumber: r.pageIndex + 1,
        pageCoordinates: { x: 0, y: r.rects[0]?.origin.y ?? 0 },
        alignY: 40,
        behavior: "instant",
      })
    })
  }, [searchCap, scrollCap, documentId])

  // Start from where the reader is: the first match on or after the current page
  useEffect(() => {
    if (!searchCap || !scrollCap || !query.trim()) return
    const timer = setTimeout(() => {
      searchCap
        .forDocument(documentId)
        .searchAllPages(query)
        .toPromise()
        .then(({ results }) => {
          const here = scrollCap.forDocument(documentId).getCurrentPage() - 1
          const i = results.findIndex((r) => r.pageIndex >= here)
          if (results.length) searchCap.forDocument(documentId).goToResult(i >= 0 ? i : 0)
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [searchCap, scrollCap, documentId, query])

  const total = state.total
  const active = state.activeResultIndex >= 0 ? state.activeResultIndex + 1 : 0

  return (
    <div className={cn(PILL, "pl-3")}>
      <SearchIcon className="size-3.5 shrink-0" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
          if (e.key === "Enter") {
            e.preventDefault()
            if (e.shiftKey) provides?.previousResult()
            else provides?.nextResult()
          }
        }}
        placeholder="Find in paper"
        className="h-6 w-40 bg-transparent px-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {/* No "0/0" before anything is typed; it reads as a failed search */}
      {query.trim() !== "" && <span className="shrink-0 px-1 tabular-nums">{total === 0 ? "None" : `${active} of ${total}`}</span>}
      <Tip label="Previous match">
        <button type="button" aria-label="Previous match" onClick={() => provides?.previousResult()} disabled={total === 0} className={ICON}>
          <ChevronUpIcon />
        </button>
      </Tip>
      <Tip label="Next match">
        <button type="button" aria-label="Next match" onClick={() => provides?.nextResult()} disabled={total === 0} className={ICON}>
          <ChevronDownIcon />
        </button>
      </Tip>
      <Tip label="Close">
        <button type="button" aria-label="Close find" onClick={onClose} className={ICON}>
          <XIcon />
        </button>
      </Tip>
    </div>
  )
}

// True while the document scrolls and for a moment after
// (The capability, not the per-document scope: the scope is a new object on every render.)
function useScrolling(documentId: string) {
  const { provides } = useScrollCapability()
  const [scrolling, setScrolling] = useState(true)
  useEffect(() => {
    if (!provides) return
    let timer = setTimeout(() => setScrolling(false), 1500)
    const off = provides.onScroll((e) => {
      if (e.documentId !== documentId) return
      setScrolling(true)
      clearTimeout(timer)
      timer = setTimeout(() => setScrolling(false), 1200)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [provides, documentId])
  return scrolling
}

// Where you are, and once a link has moved you, the way back: "← 4" names the page it returns to.
// The total comes from the document; useScroll's own count reads 0 until the first page change.
function PageIndicator({ documentId, back, onBack }: { documentId: string; back: ReturnMark | null; onBack: () => void }) {
  const { state, provides } = useScroll(documentId)
  const total = useDocumentState(documentId)?.document?.pageCount ?? 0
  const scrolling = useScrolling(documentId)
  const [hovered, setHovered] = useState(false)
  if (!total) return null
  // It sits on the text, so it shows while the reader is moving and steps back once they stop.
  // A way back stays in view until it is used.
  const shown = scrolling || hovered || !!back
  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(PILL, "absolute bottom-3 left-1/2 -translate-x-1/2 transition-opacity duration-300", !shown && "opacity-0")}
    >
      {back && (
        <>
          <Tip label={`Back to page ${back.pageNumber}`}>
            <button
              type="button"
              onClick={() => {
                provides?.scrollToPage({ ...back, behavior: "instant" })
                onBack()
              }}
              className={cn(ITEM, "gap-1 px-2 tabular-nums [&_svg]:size-3.5")}
            >
              <ArrowLeftIcon />
              {back.pageNumber}
            </button>
          </Tip>
          <span className="h-3.5 w-px bg-border" />
        </>
      )}
      <span className="px-2 tabular-nums">
        {state.currentPage} / {total}
      </span>
    </div>
  )
}
