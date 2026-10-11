import { useEffect, useRef, useState } from "react"

// The answer to a query, asked once typing pauses for `delay` ms; null asks nothing. Until the answer for
// this exact query arrives it is undefined, so an answer to an older query never shows under a newer
// one. A failed ask leaves it undefined.
export function useDebouncedQuery<T>(query: string | null, ask: (query: string) => Promise<T>, delay: number): T | undefined {
  const [answer, setAnswer] = useState<{ query: string; value: T } | null>(null)
  // The latest ask, without asking again when only the function changed
  const asker = useRef(ask)
  useEffect(() => {
    asker.current = ask
  })

  useEffect(() => {
    if (query === null) return
    let live = true
    const timer = setTimeout(() => {
      asker.current(query).then(
        (value) => live && setAnswer({ query, value }),
        () => undefined,
      )
    }, delay)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, delay])

  return query !== null && answer?.query === query ? answer.value : undefined
}
