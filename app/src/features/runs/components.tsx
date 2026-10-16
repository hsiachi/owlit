import { t } from "@lingui/core/macro"
import type { Chat, ChatMessage, Task } from "@owlit/protocol"
import { OwlitMark } from "@/components/owlit-mark"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { cancelTask } from "@/features/tasks/store"
import { openRun, useDoingLine, useOpenRuns } from "./hooks"
import { stopRun } from "./store"

// How Owlit's background work shows where it happens (DESIGN.md › Owlit's runs): one sentence in its
// voice per run (the doing line), a hover card on whatever breathes for it listing those lines with Stop,
// and the run itself, opened in the Owlit panel, with why it started, its steps and its result.

// One run as a row of a hover card: the slot (breathing while it works, a hollow ring while it waits
// its turn), its doing line, which opens the run, and Stop
function RunRow({ task }: { task: Task }) {
  const line = useDoingLine(task)
  const running = task.state === "running"
  const chatId = task.chatId
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="grid size-4 shrink-0 place-items-center">
        {running ? (
          <span className="size-2 animate-ring-breathe rounded-full bg-muted-foreground motion-reduce:animate-none" />
        ) : (
          <span className="size-2 rounded-full border-[1.5px] border-muted-foreground/55" />
        )}
      </span>
      {chatId ? (
        <button type="button" className="line-clamp-2 min-w-0 flex-1 text-left hover:underline" title={line} onClick={() => void openRun(chatId)}>
          {line}
        </button>
      ) : (
        <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground" title={line}>
          {line}
        </span>
      )}
      <Button variant="text" size="inline" className="shrink-0" onClick={() => void cancelTask(task.id)}>
        {t({ message: "Stop", comment: "stop one of Owlit's background runs" })}
      </Button>
    </li>
  )
}

// At most this many runs listed by name; a Library-wide batch says how many more wait
const LISTED = 5

type Side = "top" | "right" | "bottom" | "left"

// The card over whatever breathes for Owlit's runs (a row's slot, the rail's Chat icon): each run's doing
// line and Stop, and Stop all when there are several. The child must take a ref and props (an element,
// or a component that passes them on).
export function RunsHover({ tasks, children, side = "right", align = "start" }: { tasks: Task[]; children: React.ReactNode; side?: Side; align?: "start" | "center" | "end" }) {
  return (
    <HoverCard openDelay={200} closeDelay={150} open={tasks.length ? undefined : false}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <RunsCard tasks={tasks} side={side} align={align} />
    </HoverCard>
  )
}

// The card itself, for a trigger placed apart from it (inside another component's own trigger)
export function RunsCard({ tasks, side = "right", align = "start" }: { tasks: Task[]; side?: Side; align?: "start" | "center" | "end" }) {
  if (!tasks.length) return null
  const more = tasks.length - LISTED
  return (
      <HoverCardContent side={side} align={align} className="w-80 text-detail">
        <ul>
          {tasks.slice(0, LISTED).map((task) => (
            <RunRow key={task.id} task={task} />
          ))}
        </ul>
        {(more > 0 || tasks.length > 1) && (
          <div className="mt-1 flex items-center gap-2 border-t-[0.5px] pt-1.5 pl-6 text-muted-foreground">
            {more > 0 && <span className="flex-1">{t`and ${more} more waiting their turn`}</span>}
            {tasks.length > 1 && (
              <Button variant="text" size="inline" className="ml-auto" onClick={() => tasks.forEach((task) => void cancelTask(task.id))}>
                {t({ message: "Stop all", comment: "stop every background run Owlit has going" })}
              </Button>
            )}
          </div>
        )}
      </HoverCardContent>
  )
}

// The breathing slot of a row whose subject Owlit works on: its hover card lists the runs with Stop, and
// a click opens the one at work. Inside a row, so its click is its own.
export function RunMark({ subject, kinds, className }: { subject: string; kinds: readonly string[]; className?: string }) {
  const tasks = useOpenRuns(subject, kinds)
  const line = useDoingLine(tasks[0])
  const chatId = tasks.find((task) => task.chatId)?.chatId
  return (
    <RunsHover tasks={tasks}>
      <button
        type="button"
        aria-label={line}
        className={cn("grid size-4 shrink-0 cursor-default place-items-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50", chatId && "cursor-pointer", className)}
        onClick={(e) => {
          e.stopPropagation()
          if (chatId) void openRun(chatId)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className="size-2 animate-ring-breathe rounded-full bg-muted-foreground motion-reduce:animate-none" />
      </button>
    </RunsHover>
  )
}

// A run's first message is why it started, said by Owlit: a quiet line with the feather, not a bubble
// of yours
export function RunReason({ message }: { message: ChatMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
  return (
    <p className="flex items-start gap-2 text-detail text-muted-foreground">
      <OwlitMark className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

// Where a chat has its composer, a run has this: who started it, and Stop while it works. A run is
// Owlit's own; to take it further, ask in a chat of yours.
export function RunFooter({ run, working, className }: { run: Chat; working: boolean; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2 border-t-[0.5px] px-4 py-3 text-detail text-muted-foreground", className)}>
      <OwlitMark className="size-3.5 shrink-0" />
      <span className="flex-1">{working ? t`Owlit is doing this on its own.` : t`Owlit did this on its own.`}</span>
      {working && (
        <Button variant="text" size="inline" onClick={() => stopRun(run)}>
          {t({ message: "Stop", comment: "stop one of Owlit's background runs" })}
        </Button>
      )}
    </div>
  )
}
