import { t } from "@lingui/core/macro"
import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import type { Mentionable, QuotedSelection } from "@/features/chat/types"
import { docMentionable, paperMentionable } from "@/features/docs/lib/mentions"
import { useDocsStore } from "@/features/docs/store"
import { topicUri } from "@/features/knowledge/format"
import { useTopics } from "@/features/knowledge/store"
import { useLibraryStore } from "@/features/library/store"
import { useAgentWindow } from "./store"

// A passage's chip names where it came from: a Knowledge line, a page of a paper, the paper's note or digest
export function selectionLabel(s: QuotedSelection) {
  if (s.source.kind === "knowledge") return t({ message: "Line", comment: "chip: a passage quoted from a line of a Knowledge topic" })
  if (s.notePath) return t({ message: "Note", comment: "chip: a passage quoted from the paper's note" })
  if (s.inDigest) return t({ message: "Digest", comment: "chip: a passage quoted from the paper's digest" })
  const page = s.page
  if (page) return t({ message: `p. ${page}`, comment: "chip: a passage quoted from this page of the paper" })
  return t({ message: "Selection", comment: "chip: a passage the user selected" })
}

type PageKind = "paper" | "doc" | "knowledge"

// The ask bar's empty field, naming what is on the page
export function askAboutHint(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper…`
  if (kind === "doc") return t`Ask about this doc…`
  return t`Ask about this topic…`
}

// The empty panel, above the composer
export function askAboutOrAnything(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper, or anything else.`
  if (kind === "doc") return t`Ask about this doc, or anything else.`
  return t`Ask about this topic, or anything else.`
}

// Cut at a word boundary, so a chip never ends mid-word ("Scholars need to k…")
export const shorten = (text: string, n: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= n) return flat
  const cut = flat.slice(0, n + 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > n / 2 ? cut.slice(0, space) : flat.slice(0, n)).replace(/[\s,.;:]+$/, "")}…`
}

// The doc or paper on screen, which the agent is shown along with the question
function usePageContext(): Mentionable | null {
  const { pathname } = useLocation()
  const docId = /^\/docs\/([^/]+)$/.exec(pathname)?.[1]
  const paperId = /^\/library\/([^/]+)$/.exec(pathname)?.[1]
  const topicId = /^\/knowledge\/([^/]+)$/.exec(pathname)?.[1]
  const doc = useDocsStore((s) => (docId ? s.files[docId] : undefined))
  const paper = useLibraryStore((s) => (paperId ? s.papers[paperId] : undefined))
  const topics = useTopics()
  const topic = topicId ? topics.find((t) => t.id === decodeURIComponent(topicId)) : undefined
  const docPath = doc?.path
  return useMemo(() => {
    if (doc && docPath) return docMentionable(doc)
    if (paper) return paperMentionable(paper)
    if (topic) return { id: topic.id, kind: "knowledge", title: topic.name, subtitle: "Topic", uri: topicUri(topic.id) } satisfies Mentionable
    return null
    // The chip only needs to change when the doc's name, the paper or the topic's name does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, docPath, paper, topic?.id, topic?.name])
}

// The page's chip, unless the user took it off
export function useVisibleContext() {
  const page = usePageContext()
  const hidden = useAgentWindow((s) => s.hiddenContext)
  return page && page.uri !== hidden ? [page] : []
}
