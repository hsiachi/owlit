import { useState } from "react"
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

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === "pending") return <CircleDashedIcon className="size-3.5 text-muted-foreground" />
  if (status === "in_progress") return <Spinner className="size-3.5" />
  if (status === "completed") return <CheckIcon className="size-3.5 text-emerald-600" />
  return <XIcon className="size-3.5 text-destructive" />
}

export function ThoughtPart({ part, streaming }: { part: Part<"thought">; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/thought">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/thought:rotate-90" />
          <span className={cn(streaming && "shimmer")}>{streaming ? "Thinking…" : "Thought"}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{part.text}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ToolCallPart({ part }: { part: Part<"tool_call"> }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcons[part.kind] ?? WrenchIcon
  const hasDetails = !!part.content || (part.locations?.length ?? 0) > 0
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/tool rounded-lg border bg-muted/30 text-sm">
      <CollapsibleTrigger asChild disabled={!hasDetails}>
        <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left disabled:cursor-default">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate", part.status === "in_progress" && "shimmer")}>{part.title}</span>
          <ToolStatusIcon status={part.status} />
          {hasDetails && <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1.5 border-t px-2.5 py-2 text-xs text-muted-foreground">
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

export function PlanPart({ part }: { part: Part<"plan"> }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Plan</div>
      <ol className="flex flex-col gap-1">
        {part.entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            {e.status === "completed" ? (
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
            ) : e.status === "in_progress" ? (
              <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" />
            ) : (
              <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn(e.status === "completed" && "text-muted-foreground line-through")}>{e.content}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function PermissionPart({ part, onRespond }: { part: Part<"permission">; onRespond: (optionId: string) => void }) {
  const Icon = toolIcons[part.kind] ?? WrenchIcon
  const answered = part.outcome
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 text-sm", !answered && "border-amber-500/40 bg-amber-500/5")}>
      <div className="flex items-center gap-2">
        <ShieldAlertIcon className={cn("size-4 shrink-0", answered ? "text-muted-foreground" : "text-amber-600")} />
        <span className="font-medium">{answered ? "Permission" : "Permission needed"}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{part.title}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {answered ? (
          <span className="text-xs text-muted-foreground">
            {answered === "cancelled" ? "Cancelled" : (part.options.find((o) => o.kind === answered)?.name ?? answered)}
          </span>
        ) : (
          part.options.map((o) => (
            <Button key={o.optionId} size="sm" variant={o.kind.startsWith("allow") ? (o.kind === "allow_once" ? "default" : "outline") : "ghost"} onClick={() => onRespond(o.optionId)}>
              {o.name}
            </Button>
          ))
        )}
      </div>
    </div>
  )
}

export function TextPart({ part }: { part: Part<"text"> }) {
  return <Markdown text={part.text} />
}
