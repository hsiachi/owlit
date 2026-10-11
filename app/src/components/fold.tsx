import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// The chevron of anything that folds: it points right, and down while open
export function FoldChevron({ open, className }: { open: boolean; className?: string }) {
  return <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90", className)} />
}

// A fold ("Sources · 4 docs", "5 changes", "Show 4 more"): a 13px muted text button with the chevron
export function FoldButton({ open, onClick, className, children }: { open: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-detail text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted",
        className,
      )}
    >
      <FoldChevron open={open} />
      {children}
    </button>
  )
}
