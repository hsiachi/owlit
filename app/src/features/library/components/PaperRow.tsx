import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

// One paper, drawn the same way wherever owlit lists papers: a mark slot, its title, its details in
// muted text, and a slot at the right end for what can be done with it. As a row it is one 36px line: the
// title takes what's left and is cut, the details keep their width so they line up in a column at the
// right, and the end slot keeps a fixed width, so nothing moves when its buttons appear on hover. Nothing
// sits inside the title. `below` is a second line, for a problem or a text match.
//
// `open` is the row as the first line of its card (PaperList): the whole title, wrapped, its first line
// where the row's one line was, so the paper stays under the pointer; the mark slot and the details give way
// (the card says them below), and the title underlines on hover, since a click on it opens the paper.
export function PaperRow({
  mark,
  title,
  meta,
  slot,
  below,
  open,
  className,
  ...rest
}: { mark?: ReactNode; title: ReactNode; meta?: ReactNode; slot?: ReactNode; below?: ReactNode; open?: boolean } & Omit<ComponentProps<"div">, "title" | "slot">) {
  return (
    <div {...rest} className={cn("group/row cursor-default rounded-md pr-1 pl-2.5 text-sm select-none", !open && "hover:bg-muted", below && !open ? "py-1.5" : "", className)}>
      <div className={cn("flex gap-3", open ? "items-start py-2 leading-5" : cn("items-center", below ? "h-6" : "h-9"))}>
        {mark && (
          <span
            className={cn(
              "flex shrink-0 overflow-hidden transition-[width,margin,opacity] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none",
              open ? "-mr-3 w-0 opacity-0" : "w-4",
            )}
          >
            {mark}
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1",
            open ? "font-medium text-balance decoration-foreground/30 underline-offset-3 group-hover/row:underline" : "truncate",
          )}
        >
          {title}
        </span>
        {meta && !open && <span className="max-w-[45%] shrink-0 truncate text-detail text-muted-foreground">{meta}</span>}
        {slot && <span className={cn("flex shrink-0", open && "-my-0.5")}>{slot}</span>}
      </div>
      {below}
    </div>
  )
}
