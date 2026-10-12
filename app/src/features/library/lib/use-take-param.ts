import { useLayoutEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"

// A link that asks for something once (?passage=…, ?check=1): the value is handed to `take` when it
// arrives and taken off the link, so the link stays clean. Parameters that only qualify it (?queue=1)
// go in `also`: they are read and taken off in the same update, since two hooks each taking one would
// each write the link back from the same starting point and the second would restore the first. Before
// paint, so what it asks for is the first thing shown.
export function useTakeParam(name: string, take: (value: string, params: URLSearchParams) => void, also: string[] = []) {
  const [params, setParams] = useSearchParams()
  const value = params.get(name)
  // The newest of what the effect reads but shouldn't rerun for
  const latest = useRef({ take, params, also })
  // StrictMode runs the effect twice on mount; one request is taken once
  const taken = useRef<string | null>(null)

  useLayoutEffect(() => {
    latest.current = { take, params, also }
  })

  useLayoutEffect(() => {
    if (value === taken.current) return
    taken.current = value
    if (value === null) return
    const { take: run, params: now, also: qualifiers } = latest.current
    run(value, now)
    setParams(
      (p) => {
        for (const n of [name, ...qualifiers]) p.delete(n)
        return p
      },
      { replace: true },
    )
  }, [name, value, setParams])
}
