import { t } from "@lingui/core/macro"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { paperUri, shortTitle, type Paper, type ReadFrom, type ReadTrace, type ThreadPaper } from "@owlit/protocol"
import { CARD_CLOSE_DELAY, CARD_OPEN_DELAY, citationCardSurface, type Citation } from "@/components/citation"
import { readDepthSource } from "@/components/read-depth"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { citationLabel, shortVenue } from "@/features/library/lib/format"
import { traceTitle } from "@/features/library/lib/trace"
import { paperById, useLibraryStore } from "@/features/library/store"
import { mentionRoute } from "@/features/docs/lib/mentions"
import { threadHolding } from "@/features/threads/lib"
import { useThreadsStore } from "@/features/threads/store"
import { rpc } from "@/lib/rpc"
import { cn } from "@/lib/utils"

// What the answer around a citation was built from, as core saw its turn read (a chat's reply sets it):
// the card says how far Owlit read the cited paper from it
export const ReadFromContext = createContext<ReadFrom[] | undefined>(undefined)

// A citation's depth: its own, else the one the answer around it recorded for the paper
function useDepth(citation: Citation): Citation["depth"] {
  const readFrom = useContext(ReadFromContext)
  const aliases = useLibraryStore((s) => s.aliases)
  const papers = useLibraryStore((s) => s.papers)
  if (citation.depth || !readFrom) return citation.depth
  const id = paperById(papers, aliases, citation.paperId)?.id ?? citation.paperId
  return readFrom.find((r) => (paperById(papers, aliases, r.paperId)?.id ?? r.paperId) === id)?.depth
}

// A citation in React text (a chat's or a comment's link, a cell's page): the card opens on hover after
// the delay and on keyboard focus of what it wraps, as Radix's hover card does
export function CitationHover({ citation, children }: { citation: Citation; children: ReactNode }) {
  return (
    <HoverCard openDelay={CARD_OPEN_DELAY} closeDelay={CARD_CLOSE_DELAY}>
      <HoverCardTrigger asChild>
        {/* data-paper: the answer's "built from" line marks the citations of the papers a count names */}
        <span data-paper={citation.paperId} className="rounded-[0.3em] transition-colors duration-(--t-mark) ease-(--ease) data-marked:bg-mention/15">
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className={cn("menu-surface", citationCardSurface)}>
        <CitationCard citation={citation} />
      </HoverCardContent>
    </HoverCard>
  )
}

// What the window knows of the cited paper: the Library's record, else the row of a thread that found it
function useCitedPaper(id: string): { library?: Paper; facts?: Pick<ThreadPaper, "title" | "authors" | "year" | "venue" | "abstract"> } {
  const library = useLibraryStore((s) => paperById(s.papers, s.aliases, id))
  const found = useThreadsStore((s) => (library ? undefined : threadHolding(s.threads, id)?.rows.find((r) => r.id === id)?.paper))
  return { library, facts: library ?? found }
}

// Whether a citation's sentence is in the paper, asked once per paper and sentence in this window
type Check = { found: number } | "missing" | "no-text" | "unknown"
const checks = new Map<string, Promise<Check>>()
function checkPassage(paperId: string, quote: string): Promise<Check> {
  const key = `${paperId}\n${quote}`
  let check = checks.get(key)
  if (!check) {
    check = rpc.library.findPassage({ id: paperId, quote }).then(
      (r): Check => (r ? { found: r.page } : "missing"),
      // Core failing: the card says nothing about it
      (): Check => "unknown",
    )
    checks.set(key, check)
  }
  return check
}

function useCheck(citation: Citation, library: Paper | undefined): Check | null {
  const { paperId, quote } = citation
  // A paper owlit has no text of can't be checked, and isn't asked about
  const noText = !library?.text
  const [check, setCheck] = useState<{ key: string; value: Check } | null>(null)
  const key = `${paperId}\n${quote ?? ""}`
  useEffect(() => {
    if (!quote || noText) return
    let live = true
    void checkPassage(paperId, quote).then((value) => live && setCheck({ key, value }))
    return () => {
      live = false
    }
  }, [paperId, quote, noText, key])
  if (!quote) return null
  if (noText) return "no-text"
  return check?.key === key ? check.value : null
}

// The person's own trace with the paper: Read, how long and which pages, or not opened here
function useTrace(library: Paper | undefined): string | null {
  const [trace, setTrace] = useState<{ id: string; status: string; line: string } | null>(null)
  const id = library?.id
  const status = library?.status
  useEffect(() => {
    if (!id || !status) return
    let live = true
    const fallback = (): ReadTrace => ({ state: status === "read" ? "read" : status === "reading" ? "looked" : "none", pdfSeconds: 0, digestSeconds: 0, pages: [] })
    void rpc.library
      .trace({ ids: [id] })
      .then((all) => all[id] ?? fallback(), fallback)
      .then((found) => {
        // Read with nothing timed: the state alone says it
        if (live) setTrace({ id, status, line: traceTitle(found) || t({ message: "Read", comment: "a paper's reading status" }) })
      })
    return () => {
      live = false
    }
  }, [id, status])
  if (!library) return t`Not in your Library`
  return trace?.id === library.id && trace.status === library.status ? trace.line : null
}

// Whether the sentence is in the paper's abstract, word for word but for spacing and case
function inAbstract(abstract: string | undefined, quote: string | undefined): boolean {
  if (!abstract || !quote) return false
  const plain = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
  return plain(abstract).includes(plain(quote))
}

// The card itself, for any surface to float: the paper, the sentence the claim rests on (or the abstract's
// first lines for a citation without one), and a line of what it rests on and the person's own trace.
export function CitationCard({ citation }: { citation: Citation }) {
  const navigate = useNavigate()
  const { library, facts } = useCitedPaper(citation.paperId)
  const check = useCheck(citation, library)
  const trace = useTrace(library)
  const depth = useDepth(citation)
  const { quote } = citation
  const venue = facts?.venue ? shortVenue(facts.venue) : undefined
  const name = facts ? shortTitle(facts.title) : undefined
  const route = mentionRoute(paperUri(library?.id ?? citation.paperId))
  // The page where the sentence was found wins over the one the link named; an answer not from the text has none
  const page = depth && depth !== "full" && depth !== "part" ? undefined : typeof check === "object" && check ? check.found : check === "missing" ? undefined : citation.page
  // How far Owlit read is a recorded fact where there is one (a cell's depth, a chat's answer). Without
  // one, the sentence says what it can: one in the abstract came from the abstract (its words are on the
  // paper's first page too, which says nothing more); one found in the text came from the text, how much
  // of it unrecorded; one without a text to look in says nothing, and the no-text line stands alone.
  const source = depth
    ? readDepthSource(depth)
    : inAbstract(facts?.abstract, quote)
      ? readDepthSource("abstract")
      : quote && typeof check === "object" && check
        ? t`Owlit, from the text; how much of it isn't recorded`
        : null
  return (
    <div className="text-detail leading-normal">
      <p>
        <button type="button" className="font-medium text-foreground underline-offset-2 outline-none hover:underline focus-key:underline" onClick={() => route && navigate(route)}>
          {facts ? citationLabel(facts) : citation.paperId}
        </button>
        {[venue, name].filter(Boolean).map((part) => (
          <span key={part} className="text-muted-foreground">
            {" · "}
            {part}
          </span>
        ))}
      </p>
      {quote ? (
        <p className="mt-1.5 text-sm leading-snug text-foreground italic">“{quote}”</p>
      ) : facts?.abstract ? (
        // Named as the abstract, so it reads as what the paper says of itself, not as where Owlit took the claim from
        <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-muted-foreground">
          <span className="font-medium">{t({ message: "Abstract", comment: "label before the first lines of a cited paper's abstract, in its card" })}</span> · {facts.abstract}
        </p>
      ) : (
        <p className="mt-1.5 text-muted-foreground">{t`No abstract in owlit.`}</p>
      )}
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-muted-foreground">
        {page !== undefined && <span className="font-semibold text-foreground tabular-nums">{t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>}
        {check === "missing" ? (
          <span className="text-destructive">{t`Owlit couldn't find this sentence in the paper`}</span>
        ) : (
          source && <span className={cn("text-owlit", depth === "title" && "opacity-75")}>{source}</span>
        )}
        {check === "no-text" && <span>{t`The paper's text isn't in owlit`}</span>}
        {trace && <span>{t({ message: `You: ${trace}`, comment: "the person's own reading of a cited paper, e.g. You: Read · 12 min, pp. 1–6" })}</span>}
      </p>
    </div>
  )
}
