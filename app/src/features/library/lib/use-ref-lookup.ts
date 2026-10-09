import { useEffect, useState } from "react"
import { toast } from "sonner"
import { libraryClient, useLibraryStore } from "../store"
import type { Paper, ResolvedPaper } from "../types"
import { useUiStore } from "../ui-store"

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
  const [result, setResult] = useState<{ input: string; lookup: Lookup } | null>(null)
  const addPaper = useLibraryStore((s) => s.addPaper)

  useEffect(() => {
    if (!input) return
    let live = true
    // A short pause so typing an id character by character doesn't fire a lookup per key
    const timer = setTimeout(() => {
      libraryClient.resolve(input).then(
        (resolved) => {
          if (!live) return
          const { papers } = useLibraryStore.getState()
          const existing = (resolved.existingId ? papers[resolved.existingId] : undefined) ?? findExisting(papers, resolved)
          setResult({ input, lookup: existing ? { state: "exists", paper: existing } : { state: "found", resolved } })
        },
        (e) => live && setResult({ input, lookup: { state: "error", message: e instanceof Error ? e.message : "Could not look that up." } }),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [input])

  // Until the answer for this exact input arrives, it is still loading
  const lookup: Lookup | null = !input ? null : result?.input === input ? result.lookup : { state: "loading" }

  const add = () => {
    if (lookup?.state !== "found") return
    const paper = addPaper(lookup.resolved)
    // The new paper lands at the top, already peeked, so it can be tagged or read right away
    useUiStore.setState({ query: "", filter: "all", tags: [], selectedIds: [paper.id], cursorId: paper.id, anchorId: paper.id, peekId: paper.id })
    toast("Added to library", { description: paper.title })
  }

  return { lookup, add }
}
