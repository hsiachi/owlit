import { useEffect, useMemo, useRef } from "react"
import { useDocumentState } from "@embedpdf/core/react"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { HIGHLIGHT_MARK, HIGHLIGHT_VAR } from "../lib/highlights"
import { useLibraryStore } from "../store"
import type { Highlight, PageRect } from "../types"
import { HighlightToolbar } from "./HighlightToolbar"
import { useReaderStore } from "./reader-store"
import { useAgentWindow } from "@/features/agent/store"
import { paperMentionable } from "@/features/docs/lib/mentions"
import { toastUndo } from "@/lib/toast"

// Highlights are drawn with multiply, so they tint the page like a marker and the glyphs under
// them stay black. The layer has no z-index on purpose: a stacking context of its own would
// isolate the blend from the page it is meant to tint.

const GAP = 8

function usePageHighlights(paperId: string, pageIndex: number) {
  const all = useLibraryStore((s) => s.highlights)
  return useMemo(
    () =>
      Object.values(all)
        .filter((h) => h.paperId === paperId && h.rects.some((r) => r.page === pageIndex))
        .sort((a, b) => a.createdAt - b.createdAt),
    [all, paperId, pageIndex],
  )
}

function bounds(rects: PageRect[]) {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

export function HighlightLayer({ documentId, paperId, pageIndex }: { documentId: string; paperId: string; pageIndex: number }) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const highlights = usePageHighlights(paperId, pageIndex)
  const activeId = useReaderStore((s) => s.activeId)
  const flashId = useReaderStore((s) => s.flashId)
  const hoverId = useReaderStore((s) => s.hoverId)

  // The popover and the comment preview sit on the page where the highlight starts
  const active = highlights.find((h) => h.id === activeId && h.page === pageIndex)
  const hovered = !activeId ? highlights.find((h) => h.id === hoverId && h.page === pageIndex && h.comment) : undefined
  // A passage sent to Owlit and not asked about yet stays drawn as the selection it was
  const asking = useAgentWindow((s) =>
    s.stage !== "closed" && s.selection && s.selectionRects?.paperId === paperId ? s.selectionRects.rects : undefined,
  )

  return (
    <>
      <div className="pointer-events-none absolute inset-0">
        {asking
          ?.filter((r) => r.page === pageIndex)
          .map((r, i) => (
            <div
              key={`asking-${i}`}
              className="absolute"
              style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale, background: "var(--pdf-selection)", mixBlendMode: "multiply" }}
            />
          ))}
        {highlights.flatMap((h) =>
          h.rects
            .filter((r) => r.page === pageIndex)
            .map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className={cn("absolute rounded-[2px]", flashId === h.id && "animate-highlight-flash")}
                style={{
                  left: r.x * scale,
                  top: r.y * scale,
                  width: r.w * scale,
                  height: r.h * scale,
                  // Under the pointer or open, a step deeper, so a highlight reads as something to click
                  background:
                    h.id === hoverId || h.id === activeId
                      ? `color-mix(in oklch, ${HIGHLIGHT_VAR[h.color]} 70%, ${HIGHLIGHT_MARK[h.color]})`
                      : HIGHLIGHT_VAR[h.color],
                  mixBlendMode: "multiply",
                }}
              />
            )),
        )}
      </div>
      {active && <ActivePopover highlight={active} pageIndex={pageIndex} scale={scale} />}
      {hovered && <CommentPreview highlight={hovered} pageIndex={pageIndex} scale={scale} />}
    </>
  )
}

// Above the page's own layers: selection (1), the interaction overlay (10) and links (20)
function Anchor({ highlight, pageIndex, scale, children }: { highlight: Highlight; pageIndex: number; scale: number; children: React.ReactNode }) {
  const b = bounds(highlight.rects.filter((r) => r.page === pageIndex))
  // Above the highlight when there is room on the page, else below it
  const above = b.y * scale > 64
  return (
    <div
      className="absolute z-30"
      style={{
        left: (b.x + b.w / 2) * scale,
        top: above ? b.y * scale - GAP : (b.y + b.h) * scale + GAP,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
      }}
    >
      {children}
    </div>
  )
}

function ActivePopover({ highlight, pageIndex, scale }: { highlight: Highlight; pageIndex: number; scale: number }) {
  const commenting = useReaderStore((s) => s.commenting)
  const { open, close } = useReaderStore.getState()
  const updateHighlight = useLibraryStore((s) => s.updateHighlight)
  const removeHighlight = useLibraryStore((s) => s.removeHighlight)
  const restoreHighlight = useLibraryStore((s) => s.restoreHighlight)
  const ref = useRef<HTMLDivElement>(null)

  // A press anywhere outside closes it; a press on another highlight then opens that one
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      if (e.target instanceof HTMLElement && e.target.closest("[data-radix-popper-content-wrapper]")) return
      close()
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [close])

  return (
    <Anchor highlight={highlight} pageIndex={pageIndex} scale={scale}>
      <div ref={ref}>
        <HighlightToolbar
          color={highlight.color}
          onColor={(color) => updateHighlight(highlight.id, { color })}
          onCopy={() => copyText(highlight.text)}
          onComment={() => open(highlight.id, { commenting: !commenting })}
          comment={highlight.comment}
          commenting={commenting}
          onCommentChange={(text) => updateHighlight(highlight.id, { comment: text.trim() ? text : undefined })}
          onDelete={() => {
            const removed = removeHighlight(highlight.id)
            close()
            if (removed) toastUndo("Highlight deleted", () => restoreHighlight(removed))
          }}
          onAsk={() => {
            const paper = useLibraryStore.getState().papers[highlight.paperId]
            if (!paper) return
            close()
            useAgentWindow.getState().open({ text: highlight.text, source: paperMentionable(paper), page: highlight.page + 1 })
          }}
          onClose={close}
        />
      </div>
    </Anchor>
  )
}

// A commented highlight shows its comment on hover; nothing marks it on the page otherwise
function CommentPreview({ highlight, pageIndex, scale }: { highlight: Highlight; pageIndex: number; scale: number }) {
  return (
    <Anchor highlight={highlight} pageIndex={pageIndex} scale={scale}>
      <div data-reader-ui className="menu-surface pointer-events-none w-max max-w-72 rounded-xl px-3 py-2 text-detail leading-normal whitespace-pre-wrap text-popover-foreground">
        {highlight.comment}
      </div>
    </Anchor>
  )
}

// Clicks and hovers on highlights, read off the page itself so a drag that starts on a highlight
// still selects text. A press that does not move is a click.
export function useHighlightHitTest(documentId: string, paperId: string, pageIndex: number) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const highlights = usePageHighlights(paperId, pageIndex)
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
