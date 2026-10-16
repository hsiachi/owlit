import { t } from "@lingui/core/macro"
import { StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/icon-button"

// The small star after a starred paper's title, filled in ink: a filled star is clear without a colour,
// and the yellows are kept for waiting, comments and highlights
export function StarMark({ className }: { className?: string }) {
  return <StarIcon aria-label={t`Starred`} className={cn("size-3 shrink-0 fill-foreground text-foreground", className)} />
}

export function StarButton({
  starred,
  onToggle,
  className,
  size = "icon-sm",
}: {
  starred: boolean
  onToggle: () => void
  className?: string
  size?: "icon-xs" | "icon-sm"
}) {
  return (
    <IconButton
      label={starred ? t({ message: "Unstar", comment: "verb: unstar a paper" }) : t({ message: "Star", comment: "verb: star a paper" })}
      size={size}
      aria-pressed={starred}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(starred && "text-foreground hover:text-foreground", className)}
    >
      <StarIcon className={cn(starred && "fill-current")} />
    </IconButton>
  )
}
