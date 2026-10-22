import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { FoldButton } from "@/components/fold"

const FADE = { background: "from-background", card: "from-card" }

// Content cut at `max` (a max-height class) with a fade into the surface it sits on, until Show all opens
// it (to `openMax`, or in full). It measures itself and reports through `onLong` whether anything is cut,
// so a short preview gets no fade and no Show all; the caller keeps that in `long`.
export function FadeClip({
  open,
  long,
  onLong,
  max,
  openMax,
  surface = "background",
  className,
  children,
}: {
  open: boolean
  long: boolean
  onLong: (long: boolean) => void
  max: string
  openMax?: string
  surface?: keyof typeof FADE
  className?: string
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  // Measured only while cut, and again as the content grows (a streamed report); the observer's first call
  // comes before the first paint
  useEffect(() => {
    const el = box.current
    if (!el || !inner.current || open) return
    const observer = new ResizeObserver(() => onLong(el.scrollHeight > el.clientHeight + 4))
    observer.observe(inner.current)
    return () => observer.disconnect()
  }, [open, onLong])
  return (
    <div ref={box} className={cn("relative overflow-hidden", open ? openMax : max, className)}>
      <div ref={inner}>{children}</div>
      {!open && long && <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent", FADE[surface])} />}
    </div>
  )
}

// The fold that opens and closes a FadeClip
export function ShowAllButton({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <FoldButton open={open} onClick={onClick} className={className}>
      {open ? t`Show less` : t`Show all`}
    </FoldButton>
  )
}
