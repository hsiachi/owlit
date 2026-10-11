import { keysFor } from "@/app/shortcuts"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// What a tooltip says: the label, then the shortcut as a key, from the one table of shortcuts
export function TipLabel({ label, shortcut }: { label: React.ReactNode; shortcut?: string }) {
  return (
    <>
      {label}
      {shortcut && <Kbd>{keysFor(shortcut)}</Kbd>}
    </>
  )
}

// A tooltip on the one element it wraps
export function Tip({
  label,
  shortcut,
  side,
  className,
  children,
}: {
  label: React.ReactNode
  // An id from SHORTCUT_GROUPS
  shortcut?: string
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={className}>
        <TipLabel label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  )
}
