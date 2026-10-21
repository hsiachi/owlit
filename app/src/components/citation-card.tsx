import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { paperUri, shortTitle, type CitationPassage, type CitationState, type CitedWork, type DocCitation, type OwlitReading, type Paper, type ReadFrom, type ReadTrace, type ThreadPaper } from "@owlit/protocol"
import { CARD_CLOSE_DELAY, CARD_OPEN_DELAY, citationCardSurface, type Citation } from "@/components/citation"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { citationLabel, shortVenue } from "@/features/library/lib/format"
import { traceDetail } from "@/features/library/lib/trace"
import { paperById, useLibraryStore } from "@/features/library/store"
import { mentionRoute, openMention } from "@/features/docs/lib/mentions"
import { threadHolding } from "@/features/threads/lib"
import { useThreadsStore } from "@/features/threads/store"
import { rpc } from "@/lib/rpc"
import { cn } from "@/lib/utils"

// What the answer around a citation was built from, as core saw its turn read (a chat's reply sets it):
// the card says how far Owlit read the cited paper from it. null: Owlit's answer, with its reads not
// recorded; undefined: not in an answer of Owlit's.
export const ReadFromContext = createContext<ReadFrom[] | null | undefined>(undefined)

// A doc's citations as core keeps them (docs.citations): who wrote each and what it rests on. The doc's
// card finds its citation here by the link as written; a citation the doc has newer than core's answer
// isn't found and is told as one whose writer isn't known.
export const DocCitationsContext = createContext<DocCitation[] | undefined>(undefined)

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

// Where a citation's sentence sits in the paper (library.passage), asked once per paper and sentence in
// this window. null: neither the abstract nor the text holds it; "unknown": core failed, and the card
// says nothing of where it is.
type Place = { passage: CitationPassage; citesOther?: CitedWork[] } | null | "unknown"
const places = new Map<string, Promise<Place>>()
function placeOf(paperId: string, quote: string): Promise<Place> {
  const key = `${paperId}\n${quote}`
  let place = places.get(key)
  if (!place) {
    place = rpc.library.passage({ id: paperId, quote }).then(
      (r): Place => r,
      (): Place => "unknown",
    )
    places.set(key, place)
    // Asked again next time, once the paper's text may have come
    void place.then((p) => p === null && places.delete(key))
  }
  return place
}

// undefined while it is asked
function usePlace(citation: Citation): Place | undefined {
  const { paperId, quote } = citation
  const [place, setPlace] = useState<{ key: string; value: Place } | null>(null)
  const key = `${paperId}\n${quote ?? ""}`
  useEffect(() => {
    if (!quote) return
    let live = true
    void placeOf(paperId, quote).then((value) => live && setPlace({ key, value }))
    return () => {
      live = false
    }
  }, [paperId, quote, key])
  if (!quote) return null
  return place?.key === key ? place.value : undefined
}

// The person's own reading of the paper, from the journal (library.trace)
function useTrace(library: Paper | undefined): ReadTrace | null {
  const [trace, setTrace] = useState<{ id: string; status: string; trace: ReadTrace } | null>(null)
  const id = library?.id
  const status = library?.status
  useEffect(() => {
    if (!id || !status) return
    let live = true
    const fallback = (): ReadTrace => ({ state: status === "read" ? "read" : status === "reading" ? "looked" : "none", pdfSeconds: 0, digestSeconds: 0, pages: [] })
    void rpc.library
      .trace({ ids: [id] })
      .then((all) => all[id] ?? fallback(), fallback)
      .then((found) => live && setTrace({ id, status, trace: found }))
    return () => {
      live = false
    }
  }, [id, status])
  return library && trace?.id === library.id && trace.status === library.status ? trace.trace : null
}

// What the card says of Owlit's part in a citation (protocol DocCitation's by, state and owlitRead)
interface Part {
  by: DocCitation["by"]
  state: CitationState | null
  owlitRead?: OwlitReading
}

const keyOf = (c: { paperId: string; page?: number; quote?: string }) => `${c.paperId}#${c.page ?? ""}\n${c.quote ?? ""}`

// In a doc, core's record of the citation. Elsewhere a depth that was recorded (a cell's own, or what the
// answer around it read) makes it Owlit's, its state worked out here as core does for a doc; with none,
// whoever wrote it isn't known, and only the paper's facts are said.
function usePart(citation: Citation, place: Place | undefined, hasText: boolean): Part | undefined {
  const docCitations = useContext(DocCitationsContext)
  const readFrom = useContext(ReadFromContext)
  const aliases = useLibraryStore((s) => s.aliases)
  const papers = useLibraryStore((s) => s.papers)
  if (docCitations) {
    const kept = docCitations.find((c) => keyOf(c) === keyOf(citation))
    if (kept) return { by: kept.by, state: kept.state, ...(kept.owlitRead ? { owlitRead: kept.owlitRead } : {}) }
  }
  const id = (paperId: string) => paperById(papers, aliases, paperId)?.id ?? paperId
  const read = citation.depth ? { paperId: citation.paperId, depth: citation.depth } : readFrom?.find((r) => id(r.paperId) === id(citation.paperId))
  if (citation.quote && place === undefined) return undefined
  // Owlit's answer whose reads weren't recorded: its, with nothing said about reading
  if (!read && readFrom === null) {
    if (!citation.quote) return { by: "owlit", state: "bare" }
    const passage = place && place !== "unknown" ? place.passage : undefined
    return { by: "owlit", state: passage?.abstract ? "abstract" : passage || place === "unknown" ? "in-paper" : hasText ? "not-found" : "no-text" }
  }
  const passage = place && place !== "unknown" ? place.passage : undefined
  const owlitRead: OwlitReading | undefined =
    read?.depth === "full" || read?.depth === "digest" ? { depth: read.depth } : read?.depth === "part" ? { depth: "part", ...(read.pages ? { pages: read.pages } : {}) } : undefined
  let state: CitationState
  if (citation.quote) {
    if (place === "unknown") return { by: read ? "owlit" : "unknown", state: "in-paper" }
    if (passage?.abstract) state = "abstract"
    else if (!passage) state = hasText ? "not-found" : "no-text"
    else state = owlitRead && covers(owlitRead, passage.page) ? "read" : "in-paper"
  } else state = !read ? "bare" : owlitRead ? "whole" : "not-read"
  return { by: read ? "owlit" : "unknown", state, ...(owlitRead ? { owlitRead } : {}) }
}

// Whether a read with pages took in the page: a whole text always, a part only when its pages say so
function covers(read: OwlitReading, page: number | undefined) {
  if (read.depth === "full") return true
  if (read.depth !== "part" || page === undefined || !read.pages) return false
  return read.pages.split(",").some((run) => {
    const [from, to = from] = run.split("–").map((n) => Number(n.trim()))
    return page >= from! && page <= to!
  })
}

// "p. 4" or "pp. 2–5, 7"
const pagesLabel = (pages: string) =>
  /^\d+$/.test(pages) ? t({ message: `p. ${pages}`, comment: "a page of a paper" }) : t({ message: `pp. ${pages}`, comment: "pages of a paper, e.g. pp. 2–5, 7" })

// Owlit's name where it signs a line: its green, on the name only
function OwlitName() {
  return <span className="font-medium text-owlit">Owlit</span>
}

// Owlit's reading of the paper, said under the passage as its attribution; null where Owlit has no part
// in the citation
function OwlitLine({ part, page, hasText }: { part: Part; page?: number; hasText: boolean }) {
  const read = part.owlitRead
  const pages = read?.depth === "part" && read.pages ? pagesLabel(read.pages) : undefined
  const on = page !== undefined ? t({ message: `p. ${page}`, comment: "a page of a paper" }) : undefined
  if (part.by === "person") return null
  if (part.by !== "owlit") {
    switch (part.state) {
      case "abstract":
        return <>{t({ message: "From the abstract", comment: "a cited sentence that is the paper's abstract's, on its card; who cited it isn't known" })}</>
      case "not-found":
        return <>{t`owlit couldn't find this sentence in the paper`}</>
      case "no-text":
        return <>{t`owlit has no text of this paper`}</>
      case "bare":
        return <>{t({ message: "The citation names no sentence in the paper", comment: "a citation without a sentence, whose writer isn't known" })}</>
      default:
        return null
    }
  }
  switch (part.state) {
    case "read":
      return read?.depth === "full" ? (
        <Trans>Quoted by <OwlitName /> from the paper, which it read in full</Trans>
      ) : pages ? (
        <Trans>Quoted by <OwlitName /> from a page it read ({pages})</Trans>
      ) : (
        <Trans>Quoted by <OwlitName /> from a part it read</Trans>
      )
    case "in-paper":
      return on ? <Trans>Quoted by <OwlitName />; found on {on}, its reading of that page not recorded</Trans> : <Trans>Quoted by <OwlitName /></Trans>
    case "abstract":
      return hasText ? <Trans>Quoted by <OwlitName /> from the abstract; owlit has the full text</Trans> : <Trans>Quoted by <OwlitName /> from the abstract; owlit has no text of this paper</Trans>
    case "not-found":
      return <Trans>Quoted by <OwlitName />; owlit couldn't find this sentence in the paper</Trans>
    case "no-text":
      return <Trans>Quoted by <OwlitName />; owlit has no text of this paper to find it in</Trans>
    case "whole":
      return read?.depth === "full" ? (
        <Trans><OwlitName /> cited the whole paper, after reading all of it</Trans>
      ) : read?.depth === "digest" ? (
        <Trans><OwlitName /> cited the whole paper, after reading its digest</Trans>
      ) : pages ? (
        <Trans><OwlitName /> cited the whole paper, after reading {pages}</Trans>
      ) : (
        <Trans><OwlitName /> cited the whole paper, after reading part of it</Trans>
      )
    case "not-read":
      return hasText ? <Trans><OwlitName /> cited this paper without reading it. The text is in owlit.</Trans> : <Trans><OwlitName /> cited this paper without reading it. owlit has no text of it.</Trans>
    case "bare":
      return <Trans><OwlitName /> cited the whole paper; what it read isn't recorded</Trans>
    default:
      return null
  }
}

// The person's own reading of the paper, under its name
function YouLine({ library, trace, theirs }: { library?: Paper; trace: ReadTrace | null; theirs: boolean }) {
  const you = <span className="font-medium text-foreground">{t({ message: "You", comment: "the person, at the start of their line on a citation's card" })}</span>
  if (!library) return <>{t`Not in your Library`}</>
  if (!trace) return null
  const detail = traceDetail(trace)
  const reading =
    trace.state === "none"
      ? t({ message: "haven't opened this paper", comment: "after You, on a citation's card" })
      : trace.state === "read"
        ? detail
          ? t({ message: `read it · ${detail}`, comment: "after You, on a citation's card: read it · 12 min, pp. 1–6" })
          : t({ message: "read it", comment: "after You, on a citation's card" })
        : detail
          ? t({ message: `opened it · ${detail}`, comment: "after You, on a citation's card: opened it · 4 min, pp. 1–3" })
          : t({ message: "opened it", comment: "after You, on a citation's card" })
  return theirs ? (
    <Trans comment="the person wrote this citation themselves, then their reading of the paper">
      {you} added this citation · {reading}
    </Trans>
  ) : (
    <>
      {you} {reading}
    </>
  )
}

// What the cited sentence cites itself: "The sentence cites Reicherts et al. (2021) and [12] B. Author …"
function citesLine(works: CitedWork[]) {
  const names = works.map((w) => (w.reference ? `${w.marker} ${w.reference}` : w.marker)).join("; ")
  return t({ message: `The sentence cites ${names}`, comment: "a cited sentence holds its own references, e.g. The sentence cites (Reicherts et al., 2021)" })
}

// The cited sentence, with the references it holds itself dotted under, as the line under it names them
function withMarkers(quote: string, works: CitedWork[] | undefined): ReactNode {
  const out: ReactNode[] = []
  let at = 0
  for (const { marker } of works ?? []) {
    const i = quote.indexOf(marker, at)
    if (i < 0) continue
    out.push(quote.slice(at, i), <span key={i} className="underline decoration-muted-foreground decoration-dotted underline-offset-3">{marker}</span>)
    at = i + marker.length
  }
  out.push(quote.slice(at))
  return out
}

// The card itself, for any surface to float. Each fact sits on what it is about: under the paper's name
// the person's reading of it; then where the sentence is (section and page), the passage with a sentence
// either side, and under it Owlit's reading as the quote's attribution. A citation without a sentence
// shows the abstract's first lines instead, as what the paper is about. It never says checked: whether
// the passage carries the claim is the person's to judge. onOpen: the passage's click (the doc opens the
// paper beside it); by default the paper opens at the sentence.
export function CitationCard({ citation, onOpen }: { citation: Citation; onOpen?: (citation: Citation) => void }) {
  const navigate = useNavigate()
  const { library, facts } = useCitedPaper(citation.paperId)
  const trace = useTrace(library)
  const place = usePlace(citation)
  const hasText = !!library?.text
  const part = usePart(citation, place, hasText)
  const { quote } = citation
  const venue = facts?.venue ? shortVenue(facts.venue) : undefined
  const name = facts ? shortTitle(facts.title) : undefined
  const route = mentionRoute(paperUri(library?.id ?? citation.paperId))
  const found = place && place !== "unknown" ? place : undefined
  const passage = found?.passage
  // The page the sentence is on wins over the one the link named; one not found has none
  const page = passage ? passage.page : place === undefined || place === "unknown" ? citation.page : undefined
  const open = () => (onOpen ? onOpen({ ...citation, ...(page ? { page } : {}) }) : openMention(`owlit://library/${library?.id ?? citation.paperId}${page ? `#p${page}` : ""}`, navigate, window.location.pathname, quote))
  const owlit = part && <OwlitLine part={part} page={passage?.page} hasText={hasText} />
  const where = passage?.abstract
    ? t({ message: "Abstract", comment: "where a cited sentence sits in its paper: the abstract" })
    : [passage?.section, page !== undefined ? t({ message: `p. ${page}`, comment: "a page of a paper" }) : undefined].filter(Boolean).join(" · ")
  const canOpen = !!library?.pdf || hasText
  return (
    <div className="text-detail leading-normal">
      <p className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <button type="button" className="flex-none font-medium text-foreground underline-offset-2 outline-none hover:underline focus-key:underline" onClick={() => route && navigate(route)}>
          {facts ? citationLabel(facts) : citation.paperId}
        </button>
        {(venue || name) && <span className="min-w-0 truncate text-muted-foreground">· {[venue, name].filter(Boolean).join(" · ")}</span>}
      </p>
      <p className="text-xs text-muted-foreground">
        <YouLine library={library} trace={trace} theirs={part?.by === "person"} />
      </p>
      {quote ? (
        <div className="mt-2">
          <button
            type="button"
            disabled={!canOpen}
            onClick={open}
            aria-label={t`Open the PDF at this passage`}
            className="group/passage -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-(--t-mark) ease-(--ease) enabled:hover:bg-accent focus-key:bg-accent disabled:cursor-default"
          >
            {(where || canOpen) && (
              <span className="mb-0.5 flex justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{where}</span>
                {canOpen && <span className="whitespace-nowrap opacity-0 transition-opacity duration-(--t-mark) group-hover/passage:opacity-100 group-focus-visible/passage:opacity-100">{t`Open in the PDF ↗`}</span>}
              </span>
            )}
            <span className="block border-l-2 pl-2.5 leading-relaxed text-pretty text-muted-foreground">
              {passage?.before && <>{passage.before} </>}
              <span className="text-foreground">{withMarkers(quote, found?.citesOther)}</span>
              {passage?.after && <> {passage.after}</>}
            </span>
          </button>
          {found?.citesOther && <p className="mt-0.5 pl-2.5 text-xs text-muted-foreground">{citesLine(found.citesOther)}</p>}
          {owlit && <p className="mt-1 pl-2.5 text-xs text-muted-foreground">{owlit}</p>}
        </div>
      ) : (
        <div className="mt-2">
          <p className="mb-0.5 text-xs text-muted-foreground">{t({ message: "Abstract", comment: "label over the first lines of a cited paper's abstract, in its card" })}</p>
          <p className="line-clamp-3 border-l-2 pl-2.5 leading-relaxed text-muted-foreground">{facts?.abstract || t`No abstract in owlit.`}</p>
          {owlit && <p className="mt-1 text-xs text-muted-foreground">{owlit}</p>}
        </div>
      )}
    </div>
  )
}
