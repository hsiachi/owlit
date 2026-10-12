import { cn } from "@/lib/utils"
import { NoteDot } from "@/components/marks"
import { STATUS_LABEL, type ChatStatus } from "@/features/chat/status"

// The slot before a chat's title, as Claude Code's session list draws it: a hollow ring while nothing is
// happening, filled once something is. The hollow ring keeps every title at the same start and lets a
// status fill in without moving the row. Each rung is one 8px fill: muted at work, Owlit's green once
// finished since the user looked, `warning` while it waits on them, red when broken; the chat list adds
// the word Waiting or Stopped at the row's end for the two that need the user, so neither rests on hue.
// Every mark is in the slot at all times, stacked; the status picks which one shows (index.css, Motion),
// so a fill grows from the ring's centre rather than popping in.
export function StatusRing({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span className={cn("status-slot grid size-5 shrink-0 place-items-center", className)} data-status={status} title={STATUS_LABEL[status] || undefined}>
      <span data-mark="ring" className="size-2 rounded-full border-[1.5px] border-muted-foreground/55" />
      <span data-mark="working" className={cn("size-2 rounded-full bg-muted-foreground", status === "working" && "animate-ring-breathe motion-reduce:animate-none")} />
      <NoteDot data-mark="finished" label={false} />
      <span data-mark="failed" className="size-2 rounded-full bg-destructive" />
      <span data-mark="waiting" className="size-2 rounded-full bg-warning" />
      {status !== "idle" && <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  )
}
