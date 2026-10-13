import { t } from "@lingui/core/macro"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

// A choice behind a plain-text trigger ("Unread ▾", "Recently added ▾", a Settings picker): a ghost button
// in regular weight that fills while open, and a words-only menu as wide as its longest item with a muted
// check on the chosen one. `trigger` stands in for the chosen label where there is no one value (Mark as,
// on several papers); `icon` stands in for the chevron (Settings' pickers show up-down chevrons).
export function ChoiceMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  trigger,
  icon = <ChevronDownIcon />,
  align = "end",
  side,
  className,
}: {
  value?: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
  trigger?: React.ReactNode
  icon?: React.ReactNode
  align?: "start" | "end"
  side?: "top" | "bottom"
  className?: string
}) {
  // A value the options don't hold (a model gone from its agent) shows as the first
  const current = value === undefined ? undefined : (options.find((o) => o.value === value) ?? options[0])
  const choice = current?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={choice ? t({ message: `${label}: ${choice}`, comment: "a menu's name, then what is chosen in it" }) : label}
          className={cn("font-normal text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground", className)}
        >
          {trigger ?? current?.label ?? label}
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-auto min-w-40">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => o.value !== value && onChange(o.value)}>
            <span className="flex-1">{o.label}</span>
            {o.value === value && <CheckIcon className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
