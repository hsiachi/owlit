import { t } from "@lingui/core/macro"
import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import type { Mentionable, QuotedSelection } from "@owlit/protocol"
import { routeSubject } from "@/app/route-subject"
import { threadMentionable, docMentionable, paperMentionable } from "@/features/docs/lib/mentions"
import { useDocsStore } from "@/features/docs/store"
import { useThreadsStore } from "@/features/threads/store"
import { useLibraryStore } from "@/features/library/store"
import { useAgentWindow } from "./store"

// A passage's chip names where it came from: a page of a paper, the paper's note or digest
export function selectionLabel(s: QuotedSelection) {
  if (s.comment) return t({ message: "Comment", context: "noun: a comment on a doc", comment: "chip: a comment on a passage of a doc, asked about with Ask Owlit" })
  if (s.notePath) return t({ message: "Note", comment: "chip: a passage quoted from the paper's note" })
  if (s.inDigest) return t({ message: "Digest", comment: "chip: a passage quoted from the paper's digest" })
  const page = s.page
  if (page) return t({ message: `p. ${page}`, comment: "chip: a passage quoted from this page of the paper" })
  return t({ message: "Selection", comment: "chip: a passage the user selected" })
}

export type PageKind = "paper" | "doc" | "thread"

// The ask bar's empty field, naming what is on the page
export function askAboutHint(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper…`
  if (kind === "doc") return t`Ask about this doc…`
  return t`Ask about this thread…`
}

// The empty panel, above the composer
export function askAboutOrAnything(kind: PageKind) {
  if (kind === "paper") return t`Ask about this paper, or anything else.`
  if (kind === "doc") return t`Ask about this doc, or anything else.`
  return t`Ask about this thread, or anything else.`
}

// The doc, paper or thread on screen, which the agent is shown along with the question
export function usePageContext(): Mentionable | null {
  const subject = routeSubject(useLocation().pathname)
  const id = subject?.id
  const doc = useDocsStore((s) => (subject?.kind === "doc" ? s.files[subject.id] : undefined))
  const paper = useLibraryStore((s) => (subject?.kind === "paper" ? s.papers[subject.id] : undefined))
  const thread = useThreadsStore((s) => (subject?.kind === "thread" ? s.threads[subject.id] : undefined))
  const docPath = doc?.path
  return useMemo(() => {
    if (doc && docPath) return docMentionable(doc)
    if (paper) return paperMentionable(paper)
    if (thread) return threadMentionable(thread)
    return null
    // The chip only needs to change when the doc's name, the paper or the thread does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, docPath, paper, thread])
}

// The page's chip, unless the user took it off
export function useVisibleContext() {
  const page = usePageContext()
  const hidden = useAgentWindow((s) => s.hiddenContext)
  return page && page.uri !== hidden ? [page] : []
}
