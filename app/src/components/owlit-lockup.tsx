import type { SVGProps } from "react"
import { FEATHER, LETTERS, LOCKUP_VIEWBOX, TITTLE } from "@/lib/lockup"

// owlit's lockup: the feather and the wordmark (Dosis 500 slanted 12°, outlined), built by the brand
// rule in DESIGN.md › Brand rather than by eye. Drawn in the current text colour, except the i's dot,
// which is Owlit's green.

export function OwlitLockup(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={LOCKUP_VIEWBOX} fill="none" role="img" aria-label="owlit" {...props}>
      <path d={FEATHER.d} transform={FEATHER.transform} stroke="currentColor" strokeWidth={FEATHER.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path fill="currentColor" d={Object.values(LETTERS).join("")} />
      <path className="fill-owlit-mark" d={TITTLE} />
    </svg>
  )
}
