import { useDocumentState } from "@embedpdf/core/react"
import { cn } from "@/lib/utils"
import { useReaderStore } from "./reader-store"

// Air between a passage's text and its outline, in screen pixels
const PAD = 4

// The outline around a passage something points at: shown while the item is hovered, rung twice when
// it is clicked. It never stays: the PDF itself gets no lasting mark. Fixed colour, since the page is white
// in both themes.
export function PassageRing({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const ring = useReaderStore((s) => (s.ring?.page === pageIndex ? s.ring : null))
  if (!ring) return null
  const { box } = ring
  return (
    <div
      key={`${ring.passageId}-${ring.pulse}`}
      aria-hidden
      className={cn("pointer-events-none absolute rounded-[5px] border-2 border-(--pdf-link)", ring.pulse && "animate-passage-ring")}
      style={{ left: box.x * scale - PAD, top: box.y * scale - PAD, width: box.w * scale + 2 * PAD, height: box.h * scale + 2 * PAD }}
    />
  )
}
