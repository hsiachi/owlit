import { cn } from "@/lib/utils"

// A card with hairline dividers and one line per row: dialog content, Settings sections, Waiting on you,
// the welcome choices. Rows bring their own height and padding.
export function BorderedList({ as: Tag = "div", className, children }: { as?: "div" | "ul"; className?: string; children: React.ReactNode }) {
  return <Tag className={cn("divide-y overflow-hidden rounded-lg border bg-card", className)}>{children}</Tag>
}
