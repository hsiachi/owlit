import { t } from "@lingui/core/macro"
import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import type { Mentionable, QuotedSelection } from "@/features/chat/types"
import { docMentionable, paperMentionable } from "@/features/docs/lib/mentions"
import { useDocsStore } from "@/features/docs/store"
import { collectionUri, shownCollection } from "@owlit/protocol"
import { useCollectionsStore } from "@/features/collections/store"
import { useLibraryStore } from "@/features/library/store"
import { useAgentWindow } from "./store"

// A passage's chip names where it came from: a page of a paper, the paper's note or digest
export function selectionLabel(s: QuotedSelection) {
  if (s.notePath) return t({ message: "Note", comment: "chip: a passage quoted from the paper's note" })
  if (s.inDigest) return t({ message: "Digest", comment: "chip: a passage quoted from the paper's digest" })
  const page = s.page
  if (page) return t({ message: `p. ${page}`, comment: "chip: a passage quoted from this page of the paper" })
  return t({ message: "Selection", comment: "chip: a passage the user selected" })
}

export type PageKind = "paper" | "doc" | "collection"

// The ask bar's empty field, naming what is on the page
export function askAboutHint(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper…`
  if (kind === "doc") return t`Ask about this doc…`
  return t`Ask about this collection…`
}

// The empty panel, above the composer
export function askAboutOrAnything(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper, or anything else.`
  if (kind === "doc") return t`Ask about this doc, or anything else.`
  return t`Ask about this collection, or anything else.`
}

// The empty panel's starters for what is on the page: a label, and the question it puts in the composer
// for the person to send or finish. A question about the page, since that is what the panel is beside.
export function pageStarters(kind: PageKind): { label: string; prompt: string }[] {
  if (kind === "paper")
    return [
      { label: t`Summarize this paper`, prompt: t`Summarize this paper: its question, method and main findings.` },
      { label: t`What’s the method?`, prompt: t`What method does this paper use, and how does it evaluate it?` },
    ]
  if (kind === "doc")
    return [
      { label: t`Review this draft`, prompt: t`Review where this draft overstates a finding or misreads a paper.` },
      { label: t`Find papers to cite`, prompt: t`Find papers that support or challenge the claims in this doc.` },
    ]
  return [
    { label: t`Where do they disagree?`, prompt: t`Where do the papers in this collection disagree, and why?` },
    { label: t`What’s left open?`, prompt: t`Which questions do the papers in this collection leave open?` },
  ]
}

// The doc or paper on screen, which the agent is shown along with the question
function usePageContext(): Mentionable | null {
  const { pathname } = useLocation()
  const docId = /^\/docs\/([^/]+)$/.exec(pathname)?.[1]
  const paperId = /^\/library\/([^/]+)$/.exec(pathname)?.[1]
  const collectionId = /^\/collections\/([^/]+)$/.exec(pathname)?.[1]
  const doc = useDocsStore((s) => (docId ? s.files[docId] : undefined))
  const paper = useLibraryStore((s) => (paperId ? s.papers[paperId] : undefined))
  const collection = useCollectionsStore((s) => (collectionId ? s.collections[collectionId] : undefined))
  const title = collection ? shownCollection(collection).title : undefined
  const docPath = doc?.path
  return useMemo(() => {
    if (doc && docPath) return docMentionable(doc)
    if (paper) return paperMentionable(paper)
    if (collection && title) return { id: collection.id, kind: "collection", title, subtitle: "Collection", uri: collectionUri(collection.id) } satisfies Mentionable
    return null
    // The chip only needs to change when the doc's name, the paper or the collection's title does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, docPath, paper, collection?.id, title])
}

// The page's chip, unless the user took it off
export function useVisibleContext() {
  const page = usePageContext()
  const hidden = useAgentWindow((s) => s.hiddenContext)
  return page && page.uri !== hidden ? [page] : []
}
