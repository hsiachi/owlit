import { StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function StarButton({
  starred,
  onToggle,
  className,
  size = "icon-sm",
}: {
  starred: boolean
  onToggle: () => void
  className?: string
  size?: "icon-xs" | "icon-sm" | "icon"
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      aria-pressed={starred}
      aria-label={starred ? "Unstar" : "Star"}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn("text-muted-foreground hover:text-foreground", starred && "text-foreground", className)}
    >
      <StarIcon className={cn(starred && "fill-current")} />
    </Button>
  )
}
