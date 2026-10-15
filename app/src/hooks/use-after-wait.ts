import { useEffect, useState } from "react"

// True once `on` has held for 300 ms, false again the moment it ends. For a spinner that takes an icon's
// place: the icon stays through a fast load instead of blinking out, and only a slow one swaps it.
export function useAfterWait(on: boolean, ms = 300): boolean {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setWaited(true), ms)
    return () => {
      clearTimeout(timer)
      setWaited(false)
    }
  }, [on, ms])
  return on && waited
}
