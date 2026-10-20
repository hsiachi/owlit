import { t } from "@lingui/core/macro"
import { useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { paperUri, shortTitle, type Paper, type ReadTrace, type ThreadPaper } from "@owlit/protocol"
import { CARD_CLOSE_DELAY, CARD_OPEN_DELAY, citationCardSurface, type Citation } from "@/components/citation"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { citationLabel, shortVenue } from "@/features/library/lib/format"
import { traceTitle } from "@/features/library/lib/trace"
import { paperById, useLibraryStore } from "@/features/library/store"
import { mentionRoute } from "@/features/docs/lib/mentions"
import { threadHolding } from "@/features/threads/lib"
import { useThreadsStore } from "@/features/threads/store"
import { rpc } from "@/lib/rpc"
import { cn } from "@/lib/utils"

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
      // Without core (the browser preview), or core failing: the card says nothing about it
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

// The card itself, for any surface to float: the paper, the sentence the claim rests on (or the abstract's
// first lines for a citation without one), and a line of what it rests on and the person's own trace.
export function CitationCard({ citation }: { citation: Citation }) {
  const navigate = useNavigate()
  const { library, facts } = useCitedPaper(citation.paperId)
  const check = useCheck(citation, library)
  const trace = useTrace(library)
  const { quote, depth } = citation
  const venue = facts?.venue ? shortVenue(facts.venue) : undefined
  const name = facts ? shortTitle(facts.title) : undefined
  const route = mentionRoute(paperUri(library?.id ?? citation.paperId))
  // The page where the sentence was found wins over the one the link named; an answer not from the full text has none
  const page = depth && depth !== "full" ? undefined : typeof check === "object" && check ? check.found : check === "missing" ? undefined : citation.page
  // A cell's depth is a stored fact; a sentence in a link only claims the full text, which a paper owlit
  // has no text of can't back, so then the no-text line stands alone
  const source =
    depth === "title"
      ? t`Owlit, from the title only`
      : depth === "abstract"
        ? t`Owlit, from the abstract`
        : depth === "full" || (quote && check !== "no-text")
          ? t`Owlit, from the full text`
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
        <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-muted-foreground">{facts.abstract}</p>
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
        {!quote && !depth && facts?.abstract && <span>{t`From the abstract`}</span>}
        {trace && <span>{t({ message: `You: ${trace}`, comment: "the person's own reading of a cited paper, e.g. You: Read · 12 min, pp. 1–6" })}</span>}
      </p>
    </div>
  )
}
