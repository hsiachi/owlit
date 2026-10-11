import { cn } from "@/lib/utils"
import { FoldChevron } from "@/components/fold"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

// A block of an answer that folds into one line (steps, a plan, the agents it handed work to): the line in
// `foreground` at 80% with a chevron after it, opening to what the block holds
export function FoldingBlock({
  open,
  onOpenChange,
  head,
  id,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  head: React.ReactNode
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible id={id} open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1.5 text-sm text-foreground/80 outline-none hover:text-foreground focus-key:text-foreground">
          {head}
          <FoldChevron open={open} className="text-muted-foreground" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

// The bordered list a block opens to
export function FoldingList({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 overflow-hidden rounded-lg border">{children}</div>
}

// One row of that list: a step, or an agent. A row that got something opens to it, with the hover fill.
export function StepRow({ open, onToggle, className, children }: { open?: boolean; onToggle?: () => void; className?: string; children: React.ReactNode }) {
  const row = "flex min-h-9 w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-muted-foreground"
  return onToggle ? (
    <button type="button" aria-expanded={open} onClick={onToggle} className={cn(row, "outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted", className)}>
      {children}
    </button>
  ) : (
    <div className={cn(row, className)}>{children}</div>
  )
}

// A row's chevron stays faintly in view, so what it opens to is easy to find
export function StepChevron({ open, className }: { open: boolean; className?: string }) {
  return <FoldChevron open={open} className={cn("opacity-55", open && "opacity-100", className)} />
}
