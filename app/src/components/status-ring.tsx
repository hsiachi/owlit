import { cn } from "@/lib/utils"
import { NoteDot, StoppedDot, WaitingDot } from "@/components/marks"
import { STATUS_LABEL, type ChatStatus } from "@/features/chat/status"

// The slot before a chat's title: empty while nothing is happening, a mark once something is. The slot
// keeps its width when empty, so every title starts at the same place and a status fills in without
// moving the row. Each rung is one 8px fill: muted at work, Owlit's green once
// finished since the user looked, `warning` while it waits on them, red when broken; the chat list adds
// the word Waiting or Stopped at the row's end for the two that need the user, so neither rests on hue.
// Every mark is in the slot at all times, stacked; the status picks which one shows (index.css, Motion),
// so a fill grows from the slot's centre rather than popping in.
export function StatusRing({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span className={cn("status-slot grid size-5 shrink-0 place-items-center", className)} data-status={status} title={STATUS_LABEL[status] || undefined}>
      <span data-mark="working" className={cn("size-2 rounded-full bg-muted-foreground", status === "working" && "animate-ring-breathe motion-reduce:animate-none")} />
      <NoteDot data-mark="finished" label={false} />
      <StoppedDot data-mark="failed" />
      <WaitingDot data-mark="waiting" />
      {status !== "idle" && <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  )
}
