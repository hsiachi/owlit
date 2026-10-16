import { useEffect, useMemo, useRef } from "react"
import { useDocumentState } from "@embedpdf/core/react"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { askAboutPassage, deleteHighlight } from "../actions"
import { HIGHLIGHT_MARK, HIGHLIGHT_VAR } from "../lib/highlights"
import { useLibraryStore } from "../store"
import type { Highlight } from "@owlit/protocol"
import { floatOn } from "./float"
import { HighlightToolbar } from "./HighlightToolbar"
import { boundsOf } from "./passages"
import { useReaderStore } from "./reader-store"
import { useAgentWindow } from "@/features/agent/store"

// Highlights are drawn with multiply, so they tint the page like a marker and the glyphs under
// them stay black. The layer has no z-index on purpose: a stacking context of its own would
// isolate the blend from the page it is meant to tint.

// `highlights` are the ones that cover this page. Each page follows the open, flashing and hovered
// highlight only while it is one of its own, so moving the pointer redraws one page, not every page.
export function HighlightLayer({ documentId, paperId, pageIndex, highlights }: { documentId: string; paperId: string; pageIndex: number; highlights: Highlight[] }) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const ids = useMemo(() => new Set(highlights.map((h) => h.id)), [highlights])
  const own = (id: string | null) => (id && ids.has(id) ? id : null)
  const activeId = useReaderStore((s) => own(s.activeId))
  const flashId = useReaderStore((s) => own(s.flashId))
  const hoverId = useReaderStore((s) => own(s.hoverId))
  const anyActive = useReaderStore((s) => !!s.activeId)

  // The popover and the comment preview sit on the page where the highlight starts
  const active = highlights.find((h) => h.id === activeId && h.page === pageIndex)
  const hovered = !anyActive ? highlights.find((h) => h.id === hoverId && h.page === pageIndex && h.comment) : undefined
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
  const b = boundsOf(highlight.rects.filter((r) => r.page === pageIndex))
  // Above the highlight when there is room on the page, else below it
  return (
    <div className="absolute z-30" style={floatOn((b.x + b.w / 2) * scale, b.y * scale, (b.y + b.h) * scale, b.y * scale > 64)}>
      {children}
    </div>
  )
}

function ActivePopover({ highlight, pageIndex, scale }: { highlight: Highlight; pageIndex: number; scale: number }) {
  const commenting = useReaderStore((s) => s.commenting)
  const { open, close } = useReaderStore.getState()
  const updateHighlight = useLibraryStore((s) => s.updateHighlight)
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
            close()
            deleteHighlight(highlight.id)
          }}
          onAsk={() => {
            close()
            askAboutPassage(highlight.paperId, { text: highlight.text, page: highlight.page + 1 })
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
