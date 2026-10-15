import { t } from "@lingui/core/macro"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTravel } from "@/hooks/use-travel"
import { NoteDot } from "@/components/marks"
import { Tip } from "@/components/tip"

// A segmented control (List / Table, System / Light / Dark): a `muted` box with 2px padding whose chosen
// segment is lifted on `card` with the smallest shadow. The lift is one thumb that travels to the chosen
// segment over --t-layout, so "you are here" moves rather than jumping (DESIGN.md › Motion).
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  // With an icon the segment shows only it, and its label in a tooltip. `dot`: Owlit's dot after the
  // label, for something new there since the user last looked.
  options: { value: T; label: string; icon?: LucideIcon; dot?: boolean }[]
  className?: string
}) {
  // The thumb sits under the checked segment
  const { box, mark: thumb } = useTravel<HTMLDivElement, HTMLSpanElement>(options.findIndex((o) => o.value === value))
  return (
    <div ref={box} role="radiogroup" aria-label={label} className={cn("relative flex gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      <span
        ref={thumb}
        aria-hidden
        className="absolute inset-y-0.5 rounded-md bg-card shadow-xs transition-[left,width] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none"
      />
      {options.map((o) => {
        const on = o.value === value
        const button = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-item
            aria-label={o.icon ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative h-6 rounded-md text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50",
              o.icon ? "grid w-7 place-items-center" : "flex items-center gap-1.5 px-3 text-detail",
              on && "text-foreground",
            )}
          >
            {o.icon ? <o.icon className="size-3.5" /> : o.label}
            {o.dot && <NoteDot label={t`New since you last looked`} />}
          </button>
        )
        return o.icon ? (
          <Tip key={o.value} label={o.label}>
            {button}
          </Tip>
        ) : (
          button
        )
      })}
    </div>
  )
}
