import { useDebouncedQuery } from "@/hooks/use-debounced-query"
import { hasCore, rpc } from "@/lib/rpc"

// What core's search index finds in papers' text, asked once typing pauses. Metadata, docs and chats are
// searched in the window itself; only a paper's text lives in core. Without the desktop app there is
// no index and both stay empty.

interface FullTextHits {
  papers: Record<string, string>
  // The index is still reading the workspace for the first time
  indexing: boolean
}

const NONE: FullTextHits = { papers: {}, indexing: false }

// ⌘K: papers whose full text (or note) has every word typed, id → a snippet around the match. Empty
// for fewer than three characters.
export function useFullText(query: string): FullTextHits {
  const q = query.trim()
  const hits = useDebouncedQuery(
    hasCore && q.length >= 3 ? q : null,
    (q) => rpc.search.palette({ q }).then((r) => ({ papers: Object.fromEntries(r.papers.map((p) => [p.key, p.snippet])), indexing: r.indexing })),
    120,
  )
  return hits ?? NONE
}

const EMPTY: ReadonlyMap<string, string> = new Map()

// Library's Find also looks inside papers (abstracts and full text): a snippet around the match for
// each paper, best first
export function useTextHits(query: string): ReadonlyMap<string, string> {
  const q = query.trim()
  const hits = useDebouncedQuery(
    hasCore && q.length >= 2 ? q : null,
    (q) => rpc.search.papers({ q, marked: true }).then((found): ReadonlyMap<string, string> => new Map(found.map((h) => [h.key, h.snippet]))),
    150,
  )
  return hits ?? EMPTY
}
