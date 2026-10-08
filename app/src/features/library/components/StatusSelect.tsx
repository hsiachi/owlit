import { CheckIcon, ChevronDownIcon, CircleCheckIcon, CircleDotIcon, CircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import type { ReadStatus } from "../types"

export function StatusIcon({ status, className }: { status: ReadStatus; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className)
  switch (status) {
    case "unread":
      return <CircleIcon className={cn(cls, "text-muted-foreground/50")} />
    case "reading":
      return <CircleDotIcon className={cls} />
    case "read":
      return <CircleCheckIcon className={cls} />
  }
}

// The three statuses as menu rows; a check marks the current one
function StatusItems({ value, onChange }: { value: ReadStatus; onChange: (s: ReadStatus) => void }) {
  return STATUS_ORDER.map((s) => (
    <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
      <StatusIcon status={s} />
      {STATUS_LABEL[s]}
      {s === value && <CheckIcon className="ml-auto text-muted-foreground" />}
    </DropdownMenuItem>
  ))
}

// Icon + label trigger, for the detail pane and the paper page header
export function StatusSelect({
  value,
  onChange,
  className,
}: {
  value: ReadStatus
  onChange: (status: ReadStatus) => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("font-normal", className)} aria-label="Reading status">
          <StatusIcon status={value} />
          {STATUS_LABEL[value]}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <StatusItems value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Icon-only trigger for list rows: the glyph says the status, the tooltip names it
export function StatusDot({
  value,
  onChange,
  className,
}: {
  value: ReadStatus
  onChange: (status: ReadStatus) => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Status: ${STATUS_LABEL[value]}`}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className={cn("text-muted-foreground hover:text-foreground", className)}
            >
              <StatusIcon status={value} className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{STATUS_LABEL[value]}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <StatusItems value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
