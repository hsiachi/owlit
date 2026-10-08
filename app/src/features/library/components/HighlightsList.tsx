import { useEffect, useMemo, useRef } from "react"
import { CheckIcon, EllipsisVerticalIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HIGHLIGHT_COLORS, HIGHLIGHT_LABEL, HIGHLIGHT_MARK, highlightsMarkdown, paperHighlights } from "../lib/highlights"
import { copyText } from "../lib/clipboard"
import { useReaderStore } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import type { Highlight } from "../types"

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
    return <p className="text-[13px] text-muted-foreground">Select text in the PDF to highlight it.</p>
  }

  return (
    <div>
      <div className="flex flex-col gap-6">
        {pages.map(([page, hs]) => (
          <section key={page}>
            <h3 className="mb-1.5 text-xs text-muted-foreground">Page {page + 1}</h3>
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

  return (
    <li ref={ref} className={cn("group/hl relative rounded-md hover:bg-accent has-[[data-state=open]]:bg-accent", active && "bg-accent")}>
      <button type="button" onClick={jump} className="block w-full rounded-md px-2 py-1.5 pr-9 text-left outline-none focus-key:bg-accent">
        <span className="flex gap-2.5">
          <span aria-hidden className="w-[3px] shrink-0 rounded-full" style={{ background: HIGHLIGHT_MARK[h.color] }} />
          <span className="line-clamp-4 text-sm leading-relaxed">{h.text}</span>
        </span>
        {h.comment && <span className="mt-1 block pl-[13px] text-sm leading-relaxed whitespace-pre-wrap text-foreground">{h.comment}</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Highlight actions"
            className="absolute top-1 right-1 text-muted-foreground opacity-0 group-hover/hl:opacity-100 focus-key:opacity-100 data-[state=open]:opacity-100"
          >
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {HIGHLIGHT_COLORS.map((c) => (
                <DropdownMenuItem key={c} onSelect={() => updateHighlight(h.id, { color: c })}>
                  <span aria-hidden className="size-3 rounded-full" style={{ background: HIGHLIGHT_MARK[c] }} />
                  {HIGHLIGHT_LABEL[c]}
                  {h.color === c && <CheckIcon className="ml-auto text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => {
              jump()
              useReaderStore.getState().open(h.id, { commenting: true })
            }}
          >
            {h.comment ? "Edit comment" : "Add comment"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(h.text, "Highlight copied")}>Copy</DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddToNote}>Add to note</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              const removed = removeHighlight(h.id)
              if (removed) toast("Highlight deleted", { action: { label: "Undo", onClick: () => restoreHighlight(removed) } })
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
