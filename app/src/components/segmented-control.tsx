import { useLayoutEffect, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
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
  // With an icon the segment shows only it, and its label in a tooltip
  options: { value: T; label: string; icon?: LucideIcon }[]
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  // The thumb sits under the checked segment; measured again as the box resizes (a font settling)
  useLayoutEffect(() => {
    const el = box.current
    const mark = thumb.current
    if (!el || !mark) return
    const place = () => {
      const on = el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      if (!on) return
      // The first placement is not a move
      if (!placed.current) mark.style.transition = "none"
      mark.style.left = `${on.offsetLeft}px`
      mark.style.width = `${on.offsetWidth}px`
      if (!placed.current) {
        void mark.offsetWidth
        mark.style.transition = ""
        placed.current = true
      }
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value])
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
            aria-label={o.icon ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative h-6 rounded-md text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50",
              o.icon ? "grid w-7 place-items-center" : "px-3 text-detail",
              on && "text-foreground",
            )}
          >
            {o.icon ? <o.icon className="size-3.5" /> : o.label}
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
