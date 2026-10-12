import { toast } from "sonner"
import { useDebouncedQuery } from "@/hooks/use-debounced-query"
import { libraryClient, useLibraryStore } from "../store"
import type { Paper, ResolvedPaper } from "../types"
import { useLibraryUi } from "../ui-store"

export type Lookup =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "found"; resolved: ResolvedPaper }
  | { state: "exists"; paper: Paper }

function findExisting(papers: Record<string, Paper>, r: ResolvedPaper): Paper | undefined {
  return Object.values(papers).find(
    (p) =>
      (r.ids.doi && p.ids.doi?.toLowerCase() === r.ids.doi.toLowerCase()) ||
      (r.ids.arxiv && p.ids.arxiv === r.ids.arxiv) ||
      (r.ids.url && p.ids.url === r.ids.url),
  )
}

// Resolves a pasted reference, and adds it when asked (the Add button, or Enter in the field)
export function useRefLookup(input: string | null) {
  const addPaper = useLibraryStore((s) => s.addPaper)

  // A short pause so typing an id character by character doesn't fire a lookup per key
  const answer = useDebouncedQuery(
    input || null,
    (input): Promise<Lookup> =>
      libraryClient.resolve(input).then(
        (resolved) => {
          const { papers } = useLibraryStore.getState()
          const existing = (resolved.existingId ? papers[resolved.existingId] : undefined) ?? findExisting(papers, resolved)
          return existing ? { state: "exists", paper: existing } : { state: "found", resolved }
        },
        (e) => ({ state: "error", message: e instanceof Error ? e.message : "Could not look that up." }),
      ),
    250,
  )

  // Until the answer for this exact input arrives, it is still loading
  const lookup: Lookup | null = !input ? null : (answer ?? { state: "loading" })

  const add = () => {
    if (lookup?.state !== "found") return
    const paper = addPaper(lookup.resolved)
    // The new paper lands at the top, already peeked, so it can be tagged or read right away
    useLibraryUi.getState().revealPaper(paper.id)
    toast("Added to library", { description: paper.title })
  }

  return { lookup, add }
}
