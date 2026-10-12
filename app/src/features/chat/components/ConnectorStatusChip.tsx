import { cn } from "@/lib/utils"
import { isUnavailable, needsSignIn } from "../lib/connector-status"
import type { Connector } from "../types"

// Only states that need attention get a chip; a working agent stays quiet
export function ConnectorStatusChip({ c }: { c: Connector }) {
  if (needsSignIn(c)) return <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs leading-4 text-muted-foreground">Not signed in</span>
  if (!isUnavailable(c)) return null
  return (
    <span
      title={c.status === "error" ? c.error : undefined}
      className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs leading-4", c.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}
    >
      {c.status === "error" ? "Error" : "Not installed"}
    </span>
  )
}
