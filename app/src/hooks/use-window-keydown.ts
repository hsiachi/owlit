import { useEffect, useRef } from "react"

// Hears every key pressed in the window while mounted and enabled. The handler may be a new function on
// every render; the listener is bound once and always calls the latest.
export function useWindowKeydown(handler: (e: KeyboardEvent) => void, enabled = true) {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => latest.current(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}
