import { cn } from "@/lib/utils"
import { NoteDot, WaitingShield } from "@/components/marks"
import { STATUS_LABEL, type ChatStatus } from "@/features/chat/status"

// The slot before a chat's title, as Claude Code's session list draws it: a hollow ring while nothing is
// happening, filled once something is. The hollow ring keeps every title at the same start and lets a
// status fill in without moving the row. Waiting on the user is a shape, not just a colour: the shield of
// the permission card and of Home's list, so it never passes for the amber dot of a finished reply.
// Every mark is in the slot at all times, stacked; the status picks which one shows (index.css, Motion),
// so a fill grows from the ring's centre and the shield crossfades rather than popping in.
export function StatusRing({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span className={cn("status-slot grid size-5 shrink-0 place-items-center", className)} data-status={status} title={STATUS_LABEL[status] || undefined}>
      <span data-mark="ring" className="size-2 rounded-full border-[1.5px] border-muted-foreground/55" />
      <span data-mark="working" className={cn("size-2 rounded-full bg-muted-foreground", status === "working" && "animate-ring-breathe motion-reduce:animate-none")} />
      <NoteDot data-mark="finished" label={false} />
      <span data-mark="failed" className="size-2 rounded-full bg-destructive" />
      <span data-mark="waiting" className="flex">
        <WaitingShield />
      </span>
      {status !== "idle" && <span className="sr-only">{STATUS_LABEL[status]}</span>}
    </span>
  )
}
