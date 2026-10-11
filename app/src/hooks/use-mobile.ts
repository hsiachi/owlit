import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(changed: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", changed)
  return () => mql.removeEventListener("change", changed)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, () => window.innerWidth < MOBILE_BREAKPOINT)
}
