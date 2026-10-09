import { useEffect, useState } from "react"
import { isDesktop, rpc } from "@/lib/rpc"

// Papers whose full text (or note) has every word typed, from core's search index: id → a snippet
// around the match. Metadata, docs and chats are searched in the window itself; only a paper's text
// lives in core. Empty without the desktop app or for fewer than three characters.

export interface FullTextHits {
  papers: Record<string, string>
  // The index is still reading the workspace for the first time
  indexing: boolean
}

const NONE: FullTextHits = { papers: {}, indexing: false }

export function useFullText(query: string): FullTextHits {
  const [hits, setHits] = useState<{ query: string; hits: FullTextHits } | null>(null)
  const q = query.trim()
  useEffect(() => {
    if (!isDesktop || q.length < 3) return
    let live = true
    const timer = setTimeout(() => {
      rpc.search
        .palette({ q })
        .then((r) => live && setHits({ query: q, hits: { papers: Object.fromEntries(r.papers.map((p) => [p.key, p.snippet])), indexing: r.indexing } }))
        .catch(() => undefined)
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  // Hits for an older query would flash the wrong rows
  return hits?.query === q ? hits.hits : NONE
}
