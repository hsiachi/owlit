import { plural, t } from "@lingui/core/macro"
import { useEffect, useState, type RefObject } from "react"
import type { CitationCounts, CitationState, DocCitation, DocCitations } from "@owlit/protocol"
import { citationOf } from "@/components/citation"
import { rpc } from "@/lib/rpc"
import { useDocsStore } from "../store"

// How long the doc's text rests before its citations are asked again: typing never asks on every key
const SETTLE_MS = 800

// A doc's citations as core keeps them (docs.citations), for the text the window has: asked at once when
// the doc opens (its line then comes with the text, not after it) and again once its text has rested
// after a change (the person's typing, Owlit's edit coming in). null until core first answers, or when it
// can't.
export function useDocCitations(fileId: string): DocCitations | null {
  const path = useDocsStore((s) => s.files[fileId]?.path)
  const text = useDocsStore((s) => s.files[fileId]?.content)
  const [citations, setCitations] = useState<{ fileId: string; value: DocCitations } | null>(null)
  const first = citations?.fileId !== fileId
  useEffect(() => {
    if (!path || text === undefined) return
    let live = true
    const timer = setTimeout(
      () =>
        void rpc.docs.citations({ path, text }).then(
          (value) => live && setCitations({ fileId, value }),
          () => undefined,
        ),
      first ? 0 : SETTLE_MS,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // first only picks the delay; a change to it alone asks nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, path, text])
  return citations?.fileId === fileId ? citations.value : null
}

// One part of the line: what it says, and the states of the citations it names
export interface CitationsPart {
  text: string
  states: CitationState[]
}

const NOT_READ_IN_PAPER: CitationState[] = ["in-paper", "abstract", "not-found", "no-text", "not-read", "bare"]

// The line a doc's citations get, naming only what wasn't read in the paper, and only when something
// wasn't: "8 of 26 citations not read in the paper", then each kind of it. A sentence found in the
// paper with no read recorded counts too: a line that left it out would say 19 of 26 were read when
// nothing shows they were. Never a count of what was read: it would read as checked. Empty when
// everything was read or is the person's.
export function citationsLine(counts: CitationCounts): CitationsPart[] {
  if (!counts.notReadInPaper) return []
  const n = counts.notReadInPaper
  const parts: CitationsPart[] = [
    {
      text: plural(counts.total, {
        one: `${n} of # citation not read in the paper`,
        other: `${n} of # citations not read in the paper`,
      }),
      states: NOT_READ_IN_PAPER,
    },
  ]
  const kinds: [number, CitationState, string][] = [
    [counts.inPaper, "in-paper", t({ message: `${counts.inPaper} with a sentence found, no reading recorded`, comment: "citations whose sentence is in the paper's text, with nothing recorded of what was read" })],
    [counts.abstract, "abstract", t({ message: `${counts.abstract} from the abstract`, comment: "citations whose sentence is the cited paper's abstract's" })],
    [counts.notRead, "not-read", t({ message: `${counts.notRead} not read`, comment: "citations of papers Owlit read nothing of" })],
    [counts.bare, "bare", t({ message: `${counts.bare} with no reading recorded`, comment: "citations without a sentence, with nothing recorded of what was read" })],
    [counts.notFound, "not-found", t({ message: `${counts.notFound} not found in the paper`, comment: "citations whose sentence isn't in the paper's text" })],
    [counts.noText, "no-text", t({ message: `${counts.noText} without the paper's text`, comment: "citations with a sentence owlit has no text of the paper to look in" })],
  ]
  for (const [count, state, text] of kinds) if (count) parts.push({ text, states: [state] })
  return parts
}

// The line as one sentence, for a place that only says it (Copy references, Share)
export const citationsSentence = (counts: CitationCounts) =>
  citationsLine(counts)
    .map((p) => p.text)
    .join(" · ")

// The doc's line said where its text goes out (Copy references, Share): undefined when nothing needs saying
export async function citationsSentenceFor(path: string, text?: string): Promise<string | undefined> {
  const found = await rpc.docs.citations({ path, ...(text !== undefined ? { text } : {}) }).catch(() => null)
  return (found && citationsSentence(found.counts)) || undefined
}

const keyOf = (c: { paperId: string; page?: number; quote?: string }) => `${c.paperId}#${c.page ?? ""}\n${c.quote?.replace(/\s+/g, " ").trim() ?? ""}`

// Marks the doc's citations whose state is among states, by the link as written, for as long as they are
// picked. CodeMirror draws its mentions again as the text changes, so they are marked again whenever
// the editor's DOM does.
export function useMarkedCitations(host: RefObject<HTMLElement | null>, citations: DocCitation[] | undefined, states: CitationState[] | null) {
  useEffect(() => {
    const el = host.current
    if (!el) return
    const keys = new Set(states ? (citations ?? []).filter((c) => c.state && states.includes(c.state)).map(keyOf) : [])
    const mark = () => {
      for (const m of el.querySelectorAll<HTMLElement>('.cm-mention[data-uri^="owlit://library/"]')) {
        const c = citationOf(m.dataset.uri!, m.dataset.quote)
        const on = !!c && keys.has(keyOf(c))
        if (on !== m.hasAttribute("data-marked")) m.toggleAttribute("data-marked", on)
      }
    }
    mark()
    if (!keys.size) return
    const redrawn = new MutationObserver(mark)
    redrawn.observe(el, { childList: true, subtree: true })
    return () => {
      redrawn.disconnect()
      for (const m of el.querySelectorAll("[data-marked]")) m.removeAttribute("data-marked")
    }
  }, [host, citations, states])
}
