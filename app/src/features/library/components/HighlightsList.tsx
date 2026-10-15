import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/copy-button"
import { GroupLabel } from "@/components/group-label"
import { ActionsOnRightClick, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { HIGHLIGHT_COLORS, HIGHLIGHT_MARK, highlightLabel, highlightsMarkdown } from "../lib/highlights"
import { usePaperHighlights } from "../lib/use-highlights"
import { deleteHighlight } from "../actions"
import { copyText } from "@/lib/clipboard"
import { showInPaper } from "../paper-view"
import { useReaderStore } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import type { Highlight } from "../types"

async function copy(text: string, done: string) {
  if (await copyText(text)) toast(done)
}

// Sits at the right end of the tab line while Highlights is open: the shared copy icon, since the four
// tabs leave the panel's default width no room for words ("Copy all" as a text button ran into the
// edge); pulled out by its own padding the way the tabs are (-ml-1.5), so it ends on the text's edge
export function CopyAllHighlights({ paperId }: { paperId: string }) {
  const highlights = usePaperHighlights(paperId)
  if (highlights.length === 0) return null
  return <CopyButton text={highlightsMarkdown(highlights)} label={t`Copy all as Markdown`} size="icon-sm" className="-mr-1.5" />
}

// A page's heading in the list, by its number from 1
const pageLabel = (page: number) => t`Page ${page}`

// A paper's highlights in reading order, grouped by page. A click jumps the reader to the passage;
// a highlight clicked in the PDF scrolls into view here.
export function HighlightsList({ paperId, onAddToNote }: { paperId: string; onAddToNote: (h: Highlight) => void }) {
  const highlights = usePaperHighlights(paperId)
  const pages = useMemo(() => {
    const groups = new Map<number, Highlight[]>()
    for (const h of highlights) groups.set(h.page, [...(groups.get(h.page) ?? []), h])
    return [...groups.entries()]
  }, [highlights])

  if (highlights.length === 0) {
    return <p className="text-detail text-muted-foreground">{t`Select text in the PDF to highlight it.`}</p>
  }

  return (
    <div>
      <div className="flex flex-col gap-6">
        {pages.map(([page, hs]) => (
          <section key={page}>
            <GroupLabel as="h3" flush>
              {pageLabel(page + 1)}
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
  const ref = useRef<HTMLLIElement>(null)

  // Clicked in the PDF: bring it into view here
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focused])

  const jump = () => showInPaper(h.paperId, { highlight: h }).catch(() => false)

  // The same menu from the ⋯ and from a right-click on the highlight
  const menu: MenuGroups = [
    [
      {
        label: t`Color`,
        childrenClassName: "w-36",
        children: HIGHLIGHT_COLORS.map((c) => ({
          label: highlightLabel(c),
          mark: <span aria-hidden className="size-3 rounded-full" style={{ background: HIGHLIGHT_MARK[c] }} />,
          checked: h.color === c,
          onSelect: () => updateHighlight(h.id, { color: c }),
        })),
      },
      {
        label: h.comment ? t`Edit comment` : t`Add comment`,
        // After the jump, which closes whatever popover was open
        onSelect: () => void jump().then(() => useReaderStore.getState().open(h.id, { commenting: true })),
      },
      { label: t({ message: "Copy", comment: "verb: copy the text" }), onSelect: () => copy(h.text, t`Highlight copied`) },
      { label: t`Add to note`, onSelect: onAddToNote },
    ],
    [
      {
        label: t({ message: "Delete", comment: "verb: delete a highlight" }),
        destructive: true,
        onSelect: () => deleteHighlight(h.id),
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
          {h.addedBy === "agent" && <span className="mt-1 block pl-[13px] text-xs text-muted-foreground">{t`Added by Owlit`}</span>}
        </button>
        <RowMenuButton groups={menu} label={t`Highlight actions`} className="absolute top-1.5 right-1.5" />
      </li>
    </ActionsOnRightClick>
  )
}
