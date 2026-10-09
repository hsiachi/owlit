import { useEffect, useState } from "react"
import { isDesktop, rpc } from "@/lib/rpc"

// Find also looks inside papers: the workspace index (abstracts and full text) is asked once typing
// pauses, and answers with a snippet around the match for each paper, best first. Without the desktop
// app there is no index and Find stays with the papers' details.

const PAUSE_MS = 150
const EMPTY: ReadonlyMap<string, string> = new Map()

export function useTextHits(query: string): ReadonlyMap<string, string> {
  const q = query.trim()
  const [hits, setHits] = useState<{ q: string; byId: ReadonlyMap<string, string> }>({ q: "", byId: EMPTY })

  useEffect(() => {
    if (!isDesktop || q.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      rpc.search
        .papers({ q, marked: true })
        .then((found) => live && setHits({ q, byId: new Map(found.map((h) => [h.key, h.snippet])) }))
        .catch(() => undefined)
    }, PAUSE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])

  // Hits for an older query never show under a newer one
  return hits.q === q && q.length >= 2 ? hits.byId : EMPTY
}
