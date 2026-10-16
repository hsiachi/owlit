import { cn } from "@/lib/utils"
import { Unfold } from "@/components/unfold"

// The parts of a ruled table (the Library's, a thread's): a tinted header row, a hairline under each
// row, no grid, and a card that unfolds under a row in a full-width row of its own.

// A header cell. The tint sits on a layer inside the cell's padding, so the sticky header stays opaque over
// scrolled rows and a 4px band of sheet separates it from the first row's hover fill; the first and last
// cells round the band's ends.
export function HeadCell({ first, last, className, children, ...props }: { first?: boolean; last?: boolean } & React.ComponentProps<"th">) {
  return (
    <th className={cn("sticky top-0 z-10 h-9 border-b-4 border-background bg-background px-2.5 text-left text-xs font-medium text-muted-foreground", className)} {...props}>
      <span aria-hidden className={cn("absolute inset-0 -z-10 bg-muted", first && "rounded-l-md", last && "rounded-r-md")} />
      {children}
    </th>
  )
}

// The card a row opens into, for the peek inside a TablePeekRow
export const tablePeekCard = "my-1.5 rounded-xl border bg-card px-4 pt-3.5 pb-3 shadow-sm"

// A row's card: a full-width row under it that unfolds, the row staying where it was as the card's title
// line. Every row has one, closed and empty until opened, so a card can fold away again. The card
// overhangs the row by 6px a side, so the fold's clip box is widened by as much. `pinned`, in a table that
// scrolls sideways inside an `@container`, keeps the card as wide as the visible part and there while it scrolls.
export function TablePeekRow({ open, span, pinned, children }: { open: boolean; span: number; pinned?: boolean; children: React.ReactNode }) {
  const unfold = (
    <Unfold open={open} innerClassName="-mx-1.5 px-1.5">
      {children}
    </Unfold>
  )
  return (
    <tr>
      <td colSpan={span} className="px-1.5">
        {/* Outside the fold, whose clip box would hold it still */}
        {pinned ? <div className="sticky left-1.5 w-[calc(100cqw-12px)]">{unfold}</div> : unfold}
      </td>
    </tr>
  )
}
