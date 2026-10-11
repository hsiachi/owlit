import { useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { GroupLabel } from "@/components/group-label"
import { Button } from "@/components/ui/button"
import { ActionsOnRightClick, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { HIGHLIGHT_COLORS, HIGHLIGHT_LABEL, HIGHLIGHT_MARK, highlightsMarkdown, paperHighlights } from "../lib/highlights"
import { copyText } from "@/lib/clipboard"
import { useReaderStore } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import type { Highlight } from "../types"
import { toastUndo } from "@/lib/toast"

async function copy(text: string, done: string) {
  if (await copyText(text)) toast(done)
}

// Sits at the right end of the tab line while Highlights is open
export function CopyAllHighlights({ paperId }: { paperId: string }) {
  const all = useLibraryStore((s) => s.highlights)
  const highlights = useMemo(() => paperHighlights(all, paperId), [all, paperId])
  if (highlights.length === 0) return null
  return (
    <Button variant="ghost" size="sm" className="-mr-2 font-normal text-muted-foreground" onClick={() => copy(highlightsMarkdown(highlights), "Highlights copied as Markdown")}>
      Copy all
    </Button>
  )
}

export function useHighlightCount(paperId: string) {
  return useLibraryStore((s) => Object.values(s.highlights).filter((h) => h.paperId === paperId).length)
}

// A paper's highlights in reading order, grouped by page. A click jumps the reader to the passage;
// a highlight clicked in the PDF scrolls into view here.
export function HighlightsList({ paperId, onAddToNote }: { paperId: string; onAddToNote: (h: Highlight) => void }) {
  const all = useLibraryStore((s) => s.highlights)
  const highlights = useMemo(() => paperHighlights(all, paperId), [all, paperId])
  const pages = useMemo(() => {
    const groups = new Map<number, Highlight[]>()
    for (const h of highlights) groups.set(h.page, [...(groups.get(h.page) ?? []), h])
    return [...groups.entries()]
  }, [highlights])

  if (highlights.length === 0) {
    return <p className="text-detail text-muted-foreground">Select text in the PDF to highlight it.</p>
  }

  return (
    <div>
      <div className="flex flex-col gap-6">
        {pages.map(([page, hs]) => (
          <section key={page}>
            <GroupLabel as="h3" flush>
              Page {page + 1}
            </GroupLabel>
            <ul className="-mx-2 flex flex-col gap-0.5">
              {hs.map((h) => (
                <HighlightItem key={h.id} highlight={h} onAddToNote={() => onAddToNote(h)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function HighlightItem({ highlight: h, onAddToNote }: { highlight: Highlight; onAddToNote: () => void }) {
  const active = useReaderStore((s) => s.activeId === h.id)
  const focused = useReaderStore((s) => s.focusId === h.id)
  const updateHighlight = useLibraryStore((s) => s.updateHighlight)
  const removeHighlight = useLibraryStore((s) => s.removeHighlight)
  const restoreHighlight = useLibraryStore((s) => s.restoreHighlight)
  const ref = useRef<HTMLLIElement>(null)

  // Clicked in the PDF: bring it into view here
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focused])

  const jump = () => useReaderStore.getState().api?.jumpToHighlight(h)

  // The same menu from the ⋯ and from a right-click on the highlight
  const menu: MenuGroups = [
    [
      {
        label: "Color",
        childrenClassName: "w-36",
        children: HIGHLIGHT_COLORS.map((c) => ({
          label: HIGHLIGHT_LABEL[c],
          mark: <span aria-hidden className="size-3 rounded-full" style={{ background: HIGHLIGHT_MARK[c] }} />,
          checked: h.color === c,
          onSelect: () => updateHighlight(h.id, { color: c }),
        })),
      },
      {
        label: h.comment ? "Edit comment" : "Add comment",
        onSelect: () => {
          jump()
          useReaderStore.getState().open(h.id, { commenting: true })
        },
      },
      { label: "Copy", onSelect: () => copy(h.text, "Highlight copied") },
      { label: "Add to note", onSelect: onAddToNote },
    ],
    [
      {
        label: "Delete",
        destructive: true,
        onSelect: () => {
          const removed = removeHighlight(h.id)
          if (removed) toastUndo("Highlight deleted", () => restoreHighlight(removed))
        },
      },
    ],
  ]

  return (
    <ActionsOnRightClick groups={menu}>
      <li ref={ref} className={cn("group/row relative rounded-md hover:bg-accent has-[[data-state=open]]:bg-accent data-[state=open]:bg-accent", active && "bg-accent")}>
        <button type="button" onClick={jump} className="block w-full rounded-md px-2 py-1.5 pr-9 text-left outline-none focus-key:bg-accent">
          <span className="flex gap-2.5">
            <span aria-hidden className="w-[3px] shrink-0 rounded-full" style={{ background: HIGHLIGHT_MARK[h.color] }} />
            <span className="line-clamp-4 text-sm leading-relaxed">{h.text}</span>
          </span>
          {h.comment && <span className="mt-1 block pl-[13px] text-sm leading-relaxed whitespace-pre-wrap text-foreground">{h.comment}</span>}
          {h.addedBy === "agent" && <span className="mt-1 block pl-[13px] text-xs text-muted-foreground">Added by Owlit</span>}
        </button>
        <RowMenuButton groups={menu} label="Highlight actions" className="absolute top-1.5 right-1.5" />
      </li>
    </ActionsOnRightClick>
  )
}
