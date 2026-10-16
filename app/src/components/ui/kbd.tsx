import { cn } from "@/lib/utils"

// The return arrows aren't in the interface font, and the fallback draws them about a pixel high beside ⌘
// and letters (their ink stops above the baseline), so they are set a pixel lower. One run of text, so the
// keys keep their spacing.
const RETURN = /([↵↩])/
function lowerReturn(children: React.ReactNode) {
  if (typeof children !== "string" || !RETURN.test(children)) return children
  return <span>{children.split(RETURN).map((part, i) => (RETURN.test(part) ? <span key={i} className="relative top-px">{part}</span> : part))}</span>
}

function Kbd({ className, children, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    >
      {lowerReturn(children)}
    </kbd>
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
