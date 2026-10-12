import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"

// A changed line counts as looked at once it has been on screen this long
const DWELL_MS = 800

// Lands on #q1 or #s3 from a mention or a link: scrolls there and rings it once
export function useTarget(id: string) {
  const { hash } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const hit = hash.replace(/^#\^?/, "") === id
  useEffect(() => {
    if (hit) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [hit])
  return { ref, hit }
}

// Calls back once the element has been on screen for a moment
export function useViewed(active: boolean, onViewed: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer)
        if (e.isIntersecting) timer = setTimeout(onViewed, DWELL_MS)
      },
      { threshold: 0.9 },
    )
    io.observe(el)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [active, onViewed])
  return ref
}
