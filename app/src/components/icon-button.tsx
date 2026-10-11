import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"

// A square ghost button with a muted icon; its label is the tooltip, and the shortcut follows it
export function IconButton({
  label,
  shortcut,
  side,
  size = "icon-sm",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "variant" | "aria-label"> & {
  label: string
  // An id from SHORTCUT_GROUPS
  shortcut?: string
  side?: React.ComponentProps<typeof Tip>["side"]
  size?: "icon-xs" | "icon-sm" | "icon"
}) {
  return (
    <Tip label={label} shortcut={shortcut} side={side}>
      <Button variant="ghost" size={size} aria-label={label} className={cn("text-muted-foreground", className)} {...props} />
    </Tip>
  )
}
