import { cn } from "cn"
import type { Mentionable } from "../../types"
import { SourceIcon } from "../source-icons"

// Read-only chip used when echoing mentions in sent messages
export function MentionBadge({ item, className }: { item: Mentionable; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-64 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-foreground",
        className,
      )}
      title={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}
    >
      <SourceIcon kind={item.kind} className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{item.title}</span>
    </span>
  )
}
