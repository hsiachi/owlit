import { cn } from "@/lib/utils"
import { Info } from "@/components/info"

// The 12px muted label over a group of rows, 4px above them. It takes the rows' side padding, so it
// lines up with their text; `flush` drops it where the rows' text already starts at the edge.
export function GroupLabel({
  as: Tag = "h2",
  flush,
  info,
  id,
  className,
  children,
}: {
  as?: "h2" | "h3" | "div"
  flush?: boolean
  // An explanation behind an info icon after the words
  info?: React.ReactNode
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tag id={id} className={cn("mb-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground", !flush && "px-2.5", className)}>
      {children}
      {info && <Info>{info}</Info>}
    </Tag>
  )
}
