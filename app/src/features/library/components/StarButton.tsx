import { StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
  const label = starred ? "Unstar" : "Star"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-pressed={starred}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn("text-muted-foreground hover:text-foreground", starred && "text-star hover:text-star", className)}
        >
          <StarIcon className={cn(starred && "fill-current")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
