import { cn } from "cn"
import { STATUS_LABEL, type ChatStatus } from "../status"

// The slot before a chat's title, as Claude Code's session list draws it: a hollow ring while nothing is
// happening, filled once something is. The hollow ring keeps every title at the same start and lets a
// status fill in without moving the row.
const FILL: Record<ChatStatus, string> = {
  idle: "border-[1.5px] border-muted-foreground/55",
  working: "bg-muted-foreground animate-ring-breathe motion-reduce:animate-none",
  waiting: "bg-warning",
  finished: "bg-note",
  failed: "bg-destructive",
}

export function StatusRing({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span className={cn("grid size-5 shrink-0 place-items-center", className)} title={STATUS_LABEL[status] || undefined}>
      <span className={cn("size-2 rounded-full", FILL[status])} />
      {status !== "idle" && <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  )
}
