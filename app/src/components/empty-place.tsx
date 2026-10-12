import { cn } from "@/lib/utils"

// A place with nothing in it yet, or a thing that is missing: a 15px medium line and a muted sentence,
// centred in a narrow column, then what to do (`children`) and at most one 13px line (`note`). At panel
// size (the paper page's Knowledge tab) the two lines step down to 14px and 13px.
export function EmptyPlace({
  title,
  detail,
  note,
  size = "page",
  className,
  children,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  note?: React.ReactNode
  size?: "page" | "panel"
  className?: string
  children?: React.ReactNode
}) {
  const panel = size === "panel"
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <p className={cn("font-medium", panel ? "text-sm" : "text-body")}>{title}</p>
      {detail && (
        <p className={cn("leading-relaxed text-pretty text-muted-foreground", panel ? "mt-1 max-w-64 text-detail" : "mt-1.5 max-w-sm text-sm")}>{detail}</p>
      )}
      {children && <div className="mt-4 flex w-full flex-col items-center gap-2">{children}</div>}
      {note && <div className="mt-4 text-detail text-muted-foreground">{note}</div>}
    </div>
  )
}

// Where something can be added and nothing is: the same two lines in a dashed card, then one or two small
// buttons, primary first. The page around it takes the drop; `active` while a file is over the card itself.
export function DropCard({
  title,
  detail,
  actions,
  active,
  className,
  children,
}: {
  title: React.ReactNode
  detail: React.ReactNode
  actions?: React.ReactNode
  active?: boolean
  className?: string
  // More lines under the sentence (a fix that is one click away)
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/15 px-14 py-10 text-center transition-colors",
        active && "border-foreground/30 bg-muted",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-body font-medium">{title}</p>
      <p className="max-w-72 text-sm text-muted-foreground">{detail}</p>
      {children}
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </div>
  )
}
