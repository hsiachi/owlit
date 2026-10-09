import { useEffect, useRef, useState } from "react"
import {
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  FileSearchIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  ShieldAlertIcon,
  TerminalIcon,
  TrashIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import type { MessagePart, ToolKind, ToolStatus } from "../../types"
import { Markdown } from "./Markdown"
import { toolTitle } from "../../lib/tool-title"

type Part<T extends MessagePart["type"]> = Extract<MessagePart, { type: T }>

const toolIcons: Record<ToolKind, React.ComponentType<{ className?: string }>> = {
  read: FileSearchIcon,
  edit: PencilIcon,
  delete: TrashIcon,
  move: PencilIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  switch_mode: WrenchIcon,
  other: WrenchIcon,
}

// The outcome of a permission request, keyed by the tool call it was asked for
export type PermissionOutcome = NonNullable<Part<"permission">["outcome"]>
export type PermissionOutcomes = Record<string, PermissionOutcome>

const outcomeLabel: Record<PermissionOutcome, string> = {
  allow_once: "Allowed once",
  allow_always: "Always allowed",
  reject_once: "Rejected",
  reject_always: "Always rejected",
  cancelled: "Cancelled",
}

const isRejection = (o?: PermissionOutcome) => !!o && !o.startsWith("allow")

// Done rows say nothing: completion shows as the row going quiet. Only waiting, running and real
// failures get a mark. A call the user declined isn't a failure, so it gets no red.
function ToolStatusIcon({ status, outcome }: { status: ToolStatus; outcome?: PermissionOutcome }) {
  if (status === "pending") return <CircleDashedIcon className="size-3.5 shrink-0 text-muted-foreground" />
  if (status === "in_progress") return <Spinner className="size-3.5 shrink-0" />
  if (status === "failed" && !isRejection(outcome)) return <XIcon className="size-3.5 shrink-0 text-destructive" />
  return null
}

// Chevrons only show where the pointer or focus is, or while the row is open
const quietChevron = "size-3.5 shrink-0 opacity-0 transition group-hover/row:opacity-100 group-focus-visible/row:opacity-100"

export type StepPart = Part<"thought"> | Part<"tool_call">

export function ThoughtPart({ part, streaming }: { part: Part<"thought">; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/thought text-sm">
      <CollapsibleTrigger asChild>
        <button type="button" className="group/row flex w-full items-center gap-2 py-1 text-left text-muted-foreground hover:text-foreground">
          <BrainIcon className="size-4 shrink-0" />
          <span className={cn("min-w-0 flex-1 truncate", streaming && "shimmer")}>{streaming ? "Thinking…" : "Thought"}</span>
          <ChevronRightIcon className={cn(quietChevron, "group-data-[state=open]/thought:rotate-90 group-data-[state=open]/thought:opacity-100")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mb-1.5 pl-6 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{part.text}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Consecutive thoughts and tool calls shown as one "process" block ahead of the
// answer. Open while this block is the live one, collapsed once the answer starts.
export function StepsPart({ parts, active, outcomes = {} }: { parts: StepPart[]; active: boolean; outcomes?: PermissionOutcomes }) {
  const [open, setOpen] = useState(active)
  const wasActive = useRef(active)
  // Also reopens when work resumes, e.g. after a permission is answered and its tool call runs
  useEffect(() => {
    if (wasActive.current !== active) setOpen(active)
    wasActive.current = active
  }, [active])

  const tools = parts.filter((p): p is Part<"tool_call"> => p.type === "tool_call")
  const running = tools.find((t) => t.status === "in_progress")
  const failed = tools.filter((t) => t.status === "failed" && !isRejection(outcomes[t.toolCallId])).length
  const last = parts[parts.length - 1]
  const label = active
    ? (running ? toolTitle(running.title) : last?.type === "thought" ? "Thinking…" : "Working…")
    : tools.length === 0
      ? "Thought"
      : `${tools.length} ${tools.length === 1 ? "step" : "steps"}`

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/steps">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/steps:rotate-90" />
          <span className={cn("truncate", active && "shimmer")}>{label}</span>
          {!active && failed > 0 && <span className="shrink-0 text-destructive">· {failed} failed</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 ml-1.5 flex flex-col border-l-2 pl-3">
          {parts.map((p, i) =>
            p.type === "thought" ? (
              <ThoughtPart key={i} part={p} streaming={active && i === parts.length - 1} />
            ) : (
              <ToolCallPart key={p.toolCallId} part={p} outcome={outcomes[p.toolCallId]} />
            ),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// An answered permission belongs to its tool call: the outcome sits inline as a lighter detail
// instead of repeating the call's title on a line of its own.
export function ToolCallPart({ part, outcome }: { part: Part<"tool_call">; outcome?: PermissionOutcome }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcons[part.kind] ?? WrenchIcon
  const hasDetails = !!part.content || (part.locations?.length ?? 0) > 0
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/tool text-sm">
      <CollapsibleTrigger asChild disabled={!hasDetails}>
        <button type="button" className="group/row flex w-full items-center gap-2 py-1 text-left text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground">
          <Icon className="size-4 shrink-0" />
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className={cn("truncate", part.status === "in_progress" && "shimmer")}>{toolTitle(part.title)}</span>
            {outcome && <span className="shrink-0 text-xs text-muted-foreground">{outcomeLabel[outcome]}</span>}
          </span>
          <ToolStatusIcon status={part.status} outcome={outcome} />
          {hasDetails && <ChevronRightIcon className={cn(quietChevron, "group-data-[state=open]/tool:rotate-90 group-data-[state=open]/tool:opacity-100")} />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mb-1.5 flex flex-col gap-1 pl-6 text-xs text-muted-foreground">
          {part.locations?.map((l) => (
            <code key={l.path} className="truncate font-mono">
              {l.path}
              {l.line != null && `:${l.line}`}
            </code>
          ))}
          {part.content && <pre className="whitespace-pre-wrap font-mono">{part.content}</pre>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// A plan reads like the steps block: a quiet label and a ruled list, no card
export function PlanPart({ part }: { part: Part<"plan"> }) {
  const done = part.entries.filter((e) => e.status === "completed").length
  return (
    <div className="text-sm">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        Plan · {done}/{part.entries.length}
      </div>
      <ol className="ml-1.5 flex flex-col gap-1 border-l-2 pl-3">
        {part.entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 py-0.5">
            {e.status === "completed" ? (
              <CheckIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
            ) : e.status === "in_progress" ? (
              <CircleDotIcon className="mt-[3px] size-3.5 shrink-0 text-foreground" />
            ) : (
              <CircleIcon className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span className={cn(e.status !== "in_progress" && "text-muted-foreground")}>
              {e.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Waiting for an answer is the one state that asks for attention: a card with the action and
// buttons. Once answered, the outcome moves onto its tool call row (see MessageItem); this muted
// line is only the fallback for a request whose tool call isn't in the message.
export function PermissionPart({ part, onRespond }: { part: Part<"permission">; onRespond: (optionId: string) => void }) {
  const Icon = toolIcons[part.kind] ?? WrenchIcon
  const answered = part.outcome
  if (answered) {
    const allowed = answered.startsWith("allow")
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {allowed ? <CheckIcon className="size-4 shrink-0" /> : <XIcon className="size-4 shrink-0" />}
        <span className="truncate">
          {outcomeLabel[answered] ?? answered} · {toolTitle(part.title)}
        </span>
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-card px-3.5 py-3 text-sm shadow-xs">
      <div className="flex items-start gap-2.5">
        <ShieldAlertIcon className="mt-px size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Allow this action?</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{toolTitle(part.title)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {part.options.map((o) => (
              <Button
                key={o.optionId}
                size="sm"
                variant={o.kind === "allow_once" ? "default" : o.kind.startsWith("allow") ? "outline" : "ghost"}
                onClick={() => onRespond(o.optionId)}
              >
                {o.name}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TextPart({ part }: { part: Part<"text"> }) {
  return <Markdown text={part.text} />
}
