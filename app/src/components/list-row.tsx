import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

type RowProps = {
  // A muted kind icon, or a mark (a note dot) in the same slot
  icon?: React.ComponentType<{ className?: string }>
  mark?: React.ReactNode
  title: React.ReactNode
  // One muted detail inline after the title, and one at the right end (a date, a chevron)
  detail?: React.ReactNode
  end?: React.ReactNode
  // 32px where a list runs long or sits tight
  size?: "default" | "sm"
  className?: string
  titleClassName?: string
} & Omit<React.HTMLAttributes<HTMLElement>, "title">

// A row in a list: a link with `to`, else a button. 36px, the title, the inline detail, the right detail;
// it fills on hover and while it holds keyboard focus.
export function ListRow({ icon: Icon, mark, title, detail, end, size = "default", className, titleClassName, to, ...props }: RowProps & { to?: string }) {
  const classes = cn(
    "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none hover:bg-muted focus-key:bg-muted",
    size === "sm" ? "h-8" : "h-9",
    className,
  )
  const content = (
    <>
      {(Icon || mark) && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{Icon ? <Icon className="size-4" /> : mark}</span>}
      {/* The title keeps most of the row; the detail takes what is left */}
      <span className={cn("truncate", detail ? "max-w-[60%] shrink-0" : "min-w-0 flex-1", titleClassName)}>{title}</span>
      {detail && <span className="min-w-0 flex-1 truncate text-detail text-muted-foreground">{detail}</span>}
      {end && <span className="flex shrink-0 items-center text-detail text-muted-foreground">{end}</span>}
    </>
  )
  if (to)
    return (
      <Link to={to} className={classes} {...props}>
        {content}
      </Link>
    )
  return (
    <button type="button" className={classes} {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  )
}
