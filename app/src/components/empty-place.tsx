import { cn } from "@/lib/utils"

// A place with nothing in it yet, or a thing that is missing: a 15px medium line and a muted sentence,
// centred in a narrow column, then what to do (`children`).
export function EmptyPlace({
  title,
  detail,
  className,
  children,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <p className="font-medium text-body">{title}</p>
      {detail && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">{detail}</p>}
      {children && <div className="mt-4 flex w-full flex-col items-center gap-2">{children}</div>}
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
        "flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-foreground/15 px-14 py-10 text-center transition-colors",
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
