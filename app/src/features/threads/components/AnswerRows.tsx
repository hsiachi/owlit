import { plural, t } from "@lingui/core/macro"
import { itemId, type Paper, QUESTION_COLUMN, readInFull, type ThreadGroup, type ThreadPaper, type ThreadRead, type ThreadRowRead, threadUri } from "@owlit/protocol"
import { ChevronDownIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { NoteDot, ReadingRing } from "@/components/marks"
import { CitationHover } from "@/components/citation-card"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import { useLibraryStore } from "@/features/library/store"
import { stripLatex } from "@/features/library/lib/latex"
import { cn, scrollMotion } from "@/lib/utils"
import { noteSections, paperFacts, passageRoute, shown, useLibraryPaper } from "../lib"
import { shortAuthors, shortVenue } from "@/features/library/lib/format"
import { useThreadsStore } from "../store"
import { useThreadsUi } from "../ui-store"
import { useReadInFull, useSeenOnScreen, type VisitDots } from "../seen"

// Rows a section shows before "N more"
const SHOWN = 8

// The papers of a thread without asked columns, under its groups as headings (two levels), each group's
// first SHOWN and then "N more". A link in the report to one of them (ring) unfolds its section if it
// is hidden there, scrolls to it and rings it.
export function AnswerRows({ thread, shown, visit }: { thread: ThreadRead; shown: ThreadRead; visit: VisitDots }) {
  const peek = useThreadsUi((s) => s.peek)
  const ring = useThreadsUi((s) => s.ring)
  const [all, setAll] = useState<Set<string>>(new Set())
  const sections = noteSections(shown)
  // A paper in two groups is a row in each; the link goes to the first, and shows that section whole
  const ringAt = ring ? sections.find((s) => s.rows.some((r) => r.id === ring.id)) : undefined
  const whole = (key: string) => all.has(key) || ringAt?.key === key
  useEffect(() => {
    if (!ring || !ringAt) return
    const row = document.querySelector<HTMLElement>(`[data-place="${CSS.escape(`${ringAt.key}:${ring.id}`)}"]`)
    if (!row) return
    row.scrollIntoView({ block: "center", behavior: scrollMotion() })
    row.classList.remove("animate-place-ring")
    void row.offsetWidth
    row.classList.add("animate-place-ring")
    row.addEventListener("animationend", () => row.classList.remove("animate-place-ring"), { once: true })
    // Once per click on a link (ring.at), not on every change to the thread
  }, [ring]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!sections.length) return null
  // A paper opened in place opens where it first appears
  const firstAt = new Map<string, string>()
  for (const s of sections) for (const r of s.rows) if (!firstAt.has(r.id)) firstAt.set(r.id, s.key)
  return (
    <div className="mt-2 flex flex-col">
      {sections.map((s) => {
        const many = s.rows.length > SHOWN && !whole(s.key)
        return (
          <section key={`${s.key}:${s.depth}`} className="flex flex-col">
            {s.group && s.grouping ? (
              <GroupHeading group={s.group} total={s.total} depth={s.depth} fresh={visit.fresh(itemId.group(s.grouping.id, s.group.id))} />
            ) : (
              sections.length > 1 && <GroupHeading total={s.total} depth={0} fresh={false} />
            )}
            <div className="-mx-1.5 flex flex-col">
              {(many ? s.rows.slice(0, SHOWN) : s.rows).map((row) => {
                const items = [itemId.row(row.id), itemId.cell(row.id, QUESTION_COLUMN)]
                return (
                  <AnswerRow
                    key={row.id}
                    place={`${s.key}:${row.id}`}
                    first={firstAt.get(row.id) === s.key}
                    thread={thread}
                    row={row}
                    items={items}
                    fresh={items.some(visit.fresh)}
                    reread={readInFull(visit.changeOf(items[1]!))}
                    open={peek === row.id && firstAt.get(row.id) === s.key}
                  />
                )
              })}
            </div>
            {many && (
              <div className="py-1">
                <Button variant="text" size="inline" onClick={() => setAll((a) => new Set(a).add(s.key))}>
                  <ChevronDownIcon />
                  {plural(s.rows.length - SHOWN, { one: "# more paper", other: "# more papers" })}
                </Button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

// A group of the thread as a heading, with how many papers it holds (its subgroups' too). No group: the
// papers in none of them, after the groups.
function GroupHeading({ group, total, depth, fresh }: { group?: ThreadGroup; total: number; depth: number; fresh: boolean }) {
  const Tag = depth ? "h3" : "h2"
  return (
    <Tag className={cn("mb-1 flex items-baseline gap-2", depth ? "mt-5 text-sm font-semibold" : "mt-8 text-base font-semibold")}>
      {fresh && <NoteDot className="self-center" />}
      <span className="text-balance">{group?.name ?? t({ message: "Not in a group", comment: "papers of a thread in none of its groups" })}</span>
      <span className="shrink-0 text-detail font-normal text-muted-foreground">{plural(total, { one: "# paper", other: "# papers" })}</span>
    </Tag>
  )
}

export function ReadingMark({ paper, className }: { paper: Paper | undefined; className?: string }) {
  if (!paper || paper.status === "unread") return null
  return <ReadingRing label={t`You've read some of it`} className={className} />
}

// One paper of the thread: its title (two lines at most) with the user's reading mark and its byline,
// then what it is and how it bears on the question (Bearing). The slot before it is Owlit's dot while
// the row is new or changed since the user looked. reread: the dot's change is Owlit answering again
// from the full text: the row says so while the dot lasts, and the opened row keeps the answer it replaced.
// place: the row's section and paper, which a link from the report finds it by; first: the first place the
// paper shows, which keeps the id other pages link to
function AnswerRow({ place, first, thread, row, items, fresh, reread, open }: { place: string; first: boolean; thread: ThreadRead; row: ThreadRowRead; items: string[]; fresh: boolean; reread: ReturnType<typeof readInFull>; open: boolean }) {
  const seenRef = useSeenOnScreen<HTMLDivElement>(thread.id, items)
  const set = useThreadsUi((s) => s.set)
  const library = useLibraryPaper(row)
  const facts = paperFacts(row, library)
  const was = useReadInFull(thread.id, itemId.cell(row.id, QUESTION_COLUMN), open)
  const toggle = () => set({ peek: open ? null : row.id })
  return (
    <div
      ref={seenRef}
      id={first ? `row-${row.id}` : undefined}
      data-place={place}
      className={cn(
        "rounded-xl border border-transparent px-[5px] transition-[background-color,border-color,box-shadow,margin,padding] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none",
        open && "my-1.5 border-border bg-card py-1.5 shadow-sm",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => !(e.target as HTMLElement).closest("button, [data-peek-body]") && toggle()}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && toggle()}
        className={cn("group/row flex cursor-default gap-2.5 rounded-md py-2 pr-2.5 pl-2.5 text-sm leading-5 outline-none select-none focus-key:bg-muted", !open && "hover:bg-muted")}
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">{fresh && <NoteDot />}</span>
        <span className="min-w-0 flex-1">
          {open ? (
            <span className="font-medium text-balance">{facts.title}</span>
          ) : (
            <>
              <span className="line-clamp-2">
                <span className="font-medium">{facts.title}</span>
                <ReadingMark paper={library} className="ml-1.5 inline-block align-[-1px]" />
                <span className="ml-2 text-detail text-muted-foreground">{byline(facts)}</span>
              </span>
              <Bearing row={row} library={library} changed={fresh && !!reread} />
            </>
          )}
        </span>
      </div>
      <Unfold open={open}>
        <RowPeek thread={thread} row={row} library={library} was={was === undefined ? reread : was} />
      </Unfold>
    </div>
  )
}

// "Chang & Zhang · CHI · 2023"
const byline = (p: ThreadPaper) => [shortAuthors(p.authors), p.venue && shortVenue(p.venue), p.year].filter(Boolean).join(" · ")

// Under the title: what the paper is, how it bears on the question, how far Owlit read for that, and how
// it found the paper. An answer from the title only is muted like what is said about it: it is a guess.
function Bearing({ row, library, changed }: { row: ThreadRowRead; library: Paper | undefined; changed: boolean }) {
  const answer = row.cells[QUESTION_COLUMN]
  if (!row.is && !answer && !row.foundBy) return null
  return (
    <p className="mt-0.5 leading-relaxed">
      {row.is && <span className="text-muted-foreground">{row.is}</span>}
      {row.is && answer && <span className="text-muted-foreground"> · </span>}
      {answer && <span className={cn(answer.depth === "title" && "text-muted-foreground")}>{answer.text}</span>}
      <span className="text-detail text-muted-foreground">
        {answer && (
          <span className="ml-1.5 whitespace-nowrap">
            {answer.depth === "full" ? (
              <PageLink paperId={row.id} passage={answer.passage} library={library} changed={changed} />
            ) : answer.depth === "abstract" ? (
              t({ message: "Abstract", comment: "a thread's answer written from the paper's abstract" })
            ) : (
              t({ message: "Title only", comment: "a thread's answer written from the paper's title alone" })
            )}
          </span>
        )}
        {row.foundBy && <span> · {row.foundBy}</span>}
      </span>
    </p>
  )
}

// "Full text · p. 3" in the mention colour: the page an answer rests on, which opens the paper at those
// words; on hover, the citation's card checks the words against the paper. changed: the answer was just
// written again from the full text, said in Owlit's colour.
function PageLink({ paperId, passage, library, changed }: { paperId: string; passage?: { quote: string; page: number }; library: Paper | undefined; changed?: boolean }) {
  const navigate = useNavigate()
  const full = t({ message: "Full text", comment: "a thread's answer written from the paper's full text; followed by its page" })
  if (!passage) return <span className="text-mention">{full}</span>
  const page = passage.page
  const pageLabel = `${full} · ${t({ message: `p. ${page}`, comment: "a page of a paper" })}`
  const label = changed ? `${t({ message: "Changed after reading in full", comment: "chip on a thread cell Owlit answered again from the full text" })} · ${pageLabel}` : pageLabel
  return (
    <CitationHover citation={{ paperId, page, quote: passage.quote, depth: "full" }}>
      <MentionToken label={label} title={null} className={changed ? "text-owlit" : undefined} onClick={library ? () => navigate(passageRoute(library.id, passage)) : undefined} />
    </CitationHover>
  )
}

// What Owlit's answer was before it read the paper in full, under the answer that replaced it
export function WasLine({ was, className }: { was: ReturnType<typeof readInFull>; className?: string }) {
  if (!was) return null
  const text = was.was
  const from = was.from === "title" ? t({ message: "from the title only", comment: "after “was: …”: what Owlit's earlier answer was written from" }) : t({ message: "from the abstract", comment: "after “was: …”: what Owlit's earlier answer was written from" })
  return (
    <p className={cn("text-detail leading-normal text-muted-foreground", className)}>
      {t({ message: `was: ${text}`, comment: "Owlit's earlier answer, under the one that replaced it" })}
      <span className="whitespace-nowrap"> · {from}</span>
    </p>
  )
}

// A row opened in place: enough to decide whether to read the paper. A paper Owlit only found isn't in
// the Library: opening it, or adding it, brings it in, since it is then being used.
// was: the answer Owlit replaced when it read the paper in full (the list's rows; a table's cell says it on
// its own card)
export function RowPeek({ thread, row, library, className, was }: { thread: ThreadRead; row: ThreadRowRead; library: Paper | undefined; className?: string; was?: ReturnType<typeof readInFull> }) {
  const navigate = useNavigate()
  const addPaper = useLibraryStore((s) => s.addPaper)
  const facts = paperFacts(row, library)
  const answer = shown(thread).rows.find((r) => r.id === row.id)?.cells[QUESTION_COLUMN]
  const all = useThreadsStore((s) => s.threads)
  const others = Object.values(all).filter((c) => c.id !== thread.id && c.rows.some((r) => r.id === row.id))
  const published = [facts.venue, facts.year].filter(Boolean).join(" · ")
  const bring = () => library ?? addPaper({ id: row.id, title: facts.title, authors: facts.authors, ids: facts.ids, year: facts.year, venue: facts.venue, abstract: facts.abstract, kind: facts.kind })
  const page = answer?.passage?.page
  return (
    <div data-peek-body className={className ?? "px-2.5 pt-1 pb-1.5 pl-[38px]"}>
      <div className="max-w-[68ch]">
        <p className="text-detail leading-normal text-muted-foreground">
          {facts.authors.join(", ") || t`Unknown authors`}
          {published && <br />}
          {published}
          {published && " · "}
          {library ? t`In your Library` : t`Not in your Library`}
        </p>
        {answer && (
          // An answer from the title only (the paper's record has no abstract) is thin: muted, and said so
          <p className={cn("mt-2.5 text-sm leading-relaxed", answer.depth === "title" && "text-muted-foreground")}>
            {answer.text}
            {answer.depth !== "full" && (
              <span className="ml-1.5 text-detail whitespace-nowrap text-muted-foreground">{answer.depth === "title" ? t`From the title only` : t`From the abstract`}</span>
            )}
          </p>
        )}
        {answer && <WasLine was={was ?? null} className="mt-1" />}
        {answer?.passage && (
          <Quote size="sm" className="mt-2">
            “{answer.passage.quote}” <span className="text-detail">{t({ message: `p. ${answer.passage.page}`, comment: "a page of a paper" })}</span>
          </Quote>
        )}
        {facts.abstract && <p className="mt-2.5 line-clamp-3 text-detail leading-relaxed text-muted-foreground">{stripLatex(facts.abstract)}</p>}
        {others.length > 0 && (
          <p className="mt-2.5 text-detail text-muted-foreground">
            {t({ message: "Also in", comment: "followed by the other threads that hold this paper" })}{" "}
            {others.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <MentionToken label={shown(c).title} title={threadUri(c.id)} onClick={() => navigate(`/threads/${c.id}`)} />
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="mt-3.5 flex items-center gap-1">
        <span className="flex-1" />
        {!library && (
          <Button variant="outline" size="sm" onClick={() => bring()}>
            {t`Add to Library`}
          </Button>
        )}
        <Button size="sm" className="ml-1" onClick={() => navigate(passageRoute(bring().id, answer?.passage))}>
          {page ? t`Open at p. ${page}` : t({ message: "Open", comment: "button: open a paper to read" })}
        </Button>
      </div>
    </div>
  )
}
