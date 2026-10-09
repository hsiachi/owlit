import type { SVGProps } from "react"

// owlit's feather: one hand-drawn line. Brand rules are in DESIGN.md › Brand.
const FEATHER_PATH =
  "M 53 225 C 55 167 85 93 136 58 C 164 39 199 32 211 45 C 228 64 191 96 155 111 C 128 122 107 137 91 154 C 108 140 126 128 146 124 C 171 117 176 128 159 145 C 146 158 124 164 111 169 C 134 163 143 177 125 190 C 114 198 101 201 91 201"

// Matched to the lucide icons beside it: the feather fills 20 of 24 units of its square, as their
// drawings do, and its line is 2/24 of the square, as their stroke is. That is heavier than the
// stroke-14 original, which is drawn for large sizes. The line spans 186.6 units at its tallest,
// centred on (134.15, 131.7).
const STROKE = 21
const SIDE = ((186.6 + STROKE) * 24) / 20
const VIEW_BOX = `${134.15 - SIDE / 2} ${131.7 - SIDE / 2} ${SIDE} ${SIDE}`

// Sized like a lucide icon: by the surrounding `[&_svg]:size-*` rule or its own className
export function OwlitMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={VIEW_BOX} fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={FEATHER_PATH} />
    </svg>
  )
}
