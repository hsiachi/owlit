import { useLayoutEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"

// A link that asks for something once (?passage=…, ?check=1): the value is handed to `take` when it
// arrives and taken off the link, so the link stays clean. Before paint, so what it asks for is the first
// thing shown.
export function useTakeParam(name: string, take: (value: string) => void) {
  const [params, setParams] = useSearchParams()
  const value = params.get(name)
  const latest = useRef(take)
  // StrictMode runs the effect twice on mount; one request is taken once
  const taken = useRef<string | null>(null)

  useLayoutEffect(() => {
    latest.current = take
  })

  useLayoutEffect(() => {
    if (value === taken.current) return
    taken.current = value
    if (value === null) return
    latest.current(value)
    setParams(
      (p) => {
        p.delete(name)
        return p
      },
      { replace: true },
    )
  }, [name, value, setParams])
}
