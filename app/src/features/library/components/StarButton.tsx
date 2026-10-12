import { StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/icon-button"

// The small amber mark after a starred paper's title
export function StarMark({ className }: { className?: string }) {
  return <StarIcon aria-label="Starred" className={cn("size-3 shrink-0 fill-star text-star", className)} />
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
      label={starred ? "Unstar" : "Star"}
      size={size}
      aria-pressed={starred}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(starred && "text-star hover:text-star", className)}
    >
      <StarIcon className={cn(starred && "fill-current")} />
    </IconButton>
  )
}
