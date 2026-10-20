import { t } from "@lingui/core/macro"
import { useDebouncedQuery } from "@/hooks/use-debounced-query"
import { libraryClient, useLibraryStore } from "../store"
import type { Paper } from "@owlit/protocol"
import type { LearnedId, Resolved } from "../client"
import { addPaperFrom, sameIds, sayAdded, usePaperActions } from "../actions"
import { useLibraryUi } from "../ui-store"

export type Lookup =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "found"; resolved: Resolved }
  | { state: "exists"; paper: Paper; learned: LearnedId[] }

// Resolves a pasted reference, and adds it when asked (the Add button, or Enter in the field)
export function useRefLookup(input: string | null) {
  const { open } = usePaperActions()

  // A short pause so typing an id character by character doesn't fire a lookup per key
  const answer = useDebouncedQuery(
    input || null,
    (input): Promise<Lookup> =>
      libraryClient.resolve(input).then(
        (resolved) => {
          const { papers } = useLibraryStore.getState()
          const existing = (resolved.existingId ? papers[resolved.existingId] : undefined) ?? sameIds(papers, resolved)
          return existing ? { state: "exists", paper: existing, learned: resolved.learned ?? [] } : { state: "found", resolved }
        },
        (e) => ({ state: "error", message: e instanceof Error ? e.message : t`Could not look that up.` }),
      ),
    250,
  )

  // Until the answer for this exact input arrives, it is still loading
  const lookup: Lookup | null = !input ? null : (answer ?? { state: "loading" })

  const add = async () => {
    if (lookup?.state !== "found") return
    const added = await addPaperFrom({ resolved: lookup.resolved })
    // The new paper lands at the top, already peeked, so it can be tagged or read right away
    useLibraryUi.getState().revealPaper(added.paper.id)
    sayAdded(added, open)
  }

  return { lookup, add }
}
