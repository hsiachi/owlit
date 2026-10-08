import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import type { ReadStatus } from "../types"

// Reading status as a plain text menu ("Unread ▾"). It is the only control for status, used in
// the peek and on the paper page; the list shows status only through tone.
export function StatusMenu({
  value,
  onChange,
  align = "end",
  className,
}: {
  value: ReadStatus
  onChange: (status: ReadStatus) => void
  align?: "start" | "end"
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Reading status: ${STATUS_LABEL[value]}`}
          className={cn("font-normal text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground", className)}
        >
          {STATUS_LABEL[value]}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-40">
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onChange(s)}>
            {STATUS_LABEL[s]}
            {s === value && <CheckIcon className="ml-auto text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
