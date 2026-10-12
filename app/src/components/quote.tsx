import { cn } from "@/lib/utils"

const SIZE = { detail: "text-detail", sm: "text-sm", body: "text-body" }
const CLAMP = { 1: "truncate", 3: "line-clamp-3" }

// A quoted passage: muted words behind a thin rule. The rule is at the right for words sent with a
// message, which sit under its bubble at the right.
export function Quote({
  size = "detail",
  clamp,
  side = "left",
  title,
  className,
  children,
}: {
  size?: keyof typeof SIZE
  clamp?: keyof typeof CLAMP
  side?: "left" | "right"
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <blockquote
      title={title}
      // The size goes first: merged after it, a font size would drop the line height
      className={cn(SIZE[size], "leading-relaxed text-pretty text-muted-foreground", side === "left" ? "border-l-2 pl-3" : "border-r-2 pr-3", clamp && CLAMP[clamp], className)}
    >
      {children}
    </blockquote>
  )
}
