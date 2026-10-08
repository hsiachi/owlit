import { CircleCheckIcon, CircleDotIcon, CircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import type { ReadStatus } from "../types"

export function StatusIcon({ status, className }: { status: ReadStatus; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className)
  switch (status) {
    case "unread":
      return <CircleIcon className={cn(cls, "text-muted-foreground/60")} />
    case "reading":
      return <CircleDotIcon className={cls} />
    case "read":
      return <CircleCheckIcon className={cls} />
  }
}

export function StatusLabel({ status, className }: { status: ReadStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function StatusSelect({
  value,
  onChange,
  size = "sm",
  className,
}: {
  value: ReadStatus
  onChange: (status: ReadStatus) => void
  size?: "sm" | "default"
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ReadStatus)}>
      <SelectTrigger size={size} className={cn("w-fit", className)} aria-label="Reading status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {STATUS_ORDER.map((s) => (
          <SelectItem key={s} value={s}>
            <StatusIcon status={s} />
            {STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
