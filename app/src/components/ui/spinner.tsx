import { t } from "@lingui/core/macro"
import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

// Waits 300ms before it shows (index.css --animate-spinner), keeping its place meanwhile. Pass
// wait={false} where the wait already happened, as when it replaces an icon (useAfterWait).
function Spinner({ wait = true, className, ...props }: React.ComponentProps<"svg"> & { wait?: boolean }) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={t`Loading`} className={cn("size-4", wait ? "animate-spinner" : "animate-spin", className)} {...props} />
  )
}

export { Spinner }
