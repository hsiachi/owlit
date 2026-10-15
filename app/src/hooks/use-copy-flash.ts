import { useCallback, useEffect, useRef, useState } from "react"

// The moment after a copy: `copied` is true for 1.2 s after `flash()`, long enough to read "Copied" or
// see the check. A second copy starts the moment over.
export function useCopyFlash(): [copied: boolean, flash: () => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = useCallback(() => {
    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }, [])
  return [copied, flash]
}
