import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { transitionMs } from "@/lib/motion"
import { cn } from "@/lib/utils"

// Something that opens in place (a peek, a steps list, a waiting card): it grows from its line over
// --t-layout and pushes what is below it, so the eye can follow, and folds away the same way (index.css,
// Motion). The content is mounted only while open or still folding away, unless `keepMounted`; a fold whose
// children empty as it closes (a card once answered) keeps the last ones for the exit. `rise` also lifts the
// content 6px into place, for a card that arrives rather than unfolds. `appear` opens from nothing on mount,
// for content that replaces something else where it stands.
export function Unfold({
  open,
  rise,
  appear,
  keepMounted,
  className,
  innerClassName,
  children,
  ...props
}: {
  open: boolean
  rise?: boolean
  appear?: boolean
  keepMounted?: boolean
  innerClassName?: string
} & React.ComponentProps<"div">) {
  const outer = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(!appear)
  const shown = open && mounted
  // Settled once the last change has finished moving; false from the render that starts a change, so the
  // leaving content is never unmounted before its fold runs
  const [was, setWas] = useState(shown)
  const [settled, setSettled] = useState(true)
  if (was !== shown) {
    setWas(shown)
    setSettled(false)
  }
  const last = useRef(children)
  if (open) last.current = children

  // The closed state is laid out once before it opens, or the browser sees no change to move through
  useLayoutEffect(() => {
    if (!appear) return
    void outer.current?.offsetHeight
    setMounted(true)
  }, [appear])

  // Reduced motion ends no transition, so a timer settles the change when the transition does not
  useEffect(() => {
    if (settled) return
    const t = setTimeout(() => setSettled(true), transitionMs(outer.current) + 50)
    return () => clearTimeout(t)
  }, [settled, shown])

  const rendered = keepMounted || shown || !settled
  return (
    <div
      ref={outer}
      {...props}
      className={cn("unfold", className)}
      data-state={shown ? "open" : "closed"}
      data-settled={settled || undefined}
      data-rise={rise || undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows") setSettled(true)
        props.onTransitionEnd?.(e)
      }}
    >
      <div className={cn("unfold-inner", innerClassName)} inert={!shown}>
        {rendered ? (shown ? children : last.current) : null}
      </div>
    </div>
  )
}
