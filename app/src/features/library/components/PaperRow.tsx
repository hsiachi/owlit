import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

// One paper, drawn the same way wherever owlit lists papers: a mark slot, its title, its details in
// muted text, and a slot at the right end for what can be done with it. As a row it is one 36px line: the
// title takes what's left and is cut, the details keep their width so they line up in a column at the
// right, and the end slot keeps a fixed width, so nothing moves when its buttons appear on hover. Nothing
// sits inside the title. `below` is a second line, for a problem or a text match.
export function PaperRow({
  mark,
  title,
  meta,
  slot,
  below,
  className,
  ...rest
}: { mark?: ReactNode; title: ReactNode; meta?: ReactNode; slot?: ReactNode; below?: ReactNode } & Omit<ComponentProps<"div">, "title" | "slot">) {
  return (
    <div {...rest} className={cn("group/row cursor-default rounded-md pr-1 pl-2.5 text-sm select-none hover:bg-muted", below ? "py-1.5" : "", className)}>
      <div className={cn("flex items-center gap-3", below ? "h-6" : "h-9")}>
        {mark}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta && <span className="max-w-[45%] shrink-0 truncate text-detail text-muted-foreground">{meta}</span>}
        {slot}
      </div>
      {below}
    </div>
  )
}
