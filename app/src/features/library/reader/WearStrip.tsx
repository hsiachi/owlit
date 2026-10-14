import { t } from "@lingui/core/macro"
import { Tip } from "@/components/tip"
import { useWearStore } from "./wear"

// A page reads as fully worn after this long at the top of the screen
const WORN_AFTER = 300

// The paper's pages as a thin strip down the reader's right edge: each page a segment, darker the longer
// the person stayed on it, with Owlit's tick where one of its answers cited a sentence. Hovering a page
// names it; a click goes there. Nothing shows for a paper nobody has read in yet. It stands clear of the
// edge, where the overlay scrollbar appears.
export function WearStrip({ pageCount, onPage }: { pageCount: number; onPage: (pageIndex: number) => void }) {
  const pages = useWearStore((s) => s.pages)
  const marks = useWearStore((s) => s.marks)
  const cited = new Set(marks.map((m) => m.page))
  if (!pageCount || (!Object.keys(pages).length && !cited.size)) return null
  return (
    <div aria-label={t`Where this paper was read`} className="pointer-events-none absolute inset-y-3 right-3 flex w-2.5 flex-col">
      {Array.from({ length: pageCount }, (_, i) => {
        const seconds = pages[i + 1] ?? 0
        const wear = seconds ? 0.12 + 0.48 * Math.min(1, seconds / WORN_AFTER) : 0
        const page = i + 1
        return (
          <Tip key={i} label={t({ message: `p. ${page}`, comment: "a page of a paper" })} side="left">
            <button type="button" aria-label={t`Go to page ${page}`} onClick={() => onPage(i)} className="group pointer-events-auto relative min-h-0 flex-1 cursor-pointer outline-none">
              <span
                aria-hidden
                className="absolute inset-y-px right-0 w-[3px] rounded-full bg-foreground transition-opacity group-hover:opacity-70!"
                style={{ opacity: wear }}
              />
              {cited.has(i) && <span aria-hidden className="absolute top-1/2 right-0 h-1 w-[3px] -translate-y-1/2 rounded-full bg-owlit-mark" />}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}
