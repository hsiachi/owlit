import { useLayoutEffect, useRef } from "react"

// A lift (a segment's thumb, a tab's underline) that travels to the chosen item, an element marked
// data-item inside `box`; placed without a move the first time, and again when the box resizes (a font
// settling). Measured in layout pixels, so the window's scale doesn't matter.
export function useTravel<B extends HTMLElement, M extends HTMLElement>(on: number) {
  const box = useRef<B>(null)
  const mark = useRef<M>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const el = box.current
    const m = mark.current
    if (!el || !m) return
    const place = () => {
      const target = el.querySelectorAll<HTMLElement>("[data-item]")[on]
      if (!target) return
      if (!placed.current) m.style.transition = "none"
      m.style.left = `${target.offsetLeft}px`
      m.style.width = `${target.offsetWidth}px`
      if (!placed.current) {
        void m.offsetWidth
        m.style.transition = ""
        placed.current = true
      }
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [on])
  return { box, mark }
}
