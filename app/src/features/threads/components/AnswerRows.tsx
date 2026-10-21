import { plural, t } from "@lingui/core/macro"
import { fromText, itemId, type Paper, QUESTION_COLUMN, readInFull, type ThreadGroup, type ThreadPaper, type ThreadRead, type ThreadRowRead, threadUri } from "@owlit/protocol"
import { ChevronDownIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { NoteDot, ReadingRing } from "@/components/marks"
import { readDepthLabel } from "@/components/read-depth"
import { CitationHover } from "@/components/citation-card"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { PaperCard, PaperCardThread } from "@/components/paper-card"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import { StarButton } from "@/features/library/components/StarButton"
import { useLibraryStore } from "@/features/library/store"
import { cn, scrollMotion } from "@/lib/utils"
import { columnLabel, noteSections, paperFacts, passageRoute, relWord, shown, useLibraryPaper } from "../lib"
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
            {fromText(answer.depth) ? <PageLink paperId={row.id} depth={answer.depth} passage={answer.passage} library={library} changed={changed} /> : readDepthLabel(answer.depth)}
          </span>
        )}
        {row.foundBy && <span> · {row.foundBy}</span>}
      </span>
    </p>
  )
}

// "Full text · p. 3" (or "Part of the text · p. 3") in the mention colour: how far Owlit read and the
// page the answer rests on, which opens the paper at those words; on hover, the citation's card checks the
// words against the paper. changed: the answer was just written again from the text, said in Owlit's colour.
function PageLink({ paperId, depth, passage, library, changed }: { paperId: string; depth: "part" | "full"; passage?: { quote: string; page: number }; library: Paper | undefined; changed?: boolean }) {
  const navigate = useNavigate()
  const read = readDepthLabel(depth)
  if (!passage) return <span className="text-mention">{read}</span>
  const page = passage.page
  const pageLabel = `${read} · ${t({ message: `p. ${page}`, comment: "a page of a paper" })}`
  const label = changed ? `${t({ message: "Changed after reading the text", comment: "chip on a thread cell Owlit answered again from the paper's text" })} · ${pageLabel}` : pageLabel
  return (
    <CitationHover citation={{ paperId, page, quote: passage.quote, depth }}>
      <MentionToken label={label} title={null} className={changed ? "text-owlit" : undefined} onClick={library ? () => navigate(passageRoute(library.id, passage)) : undefined} />
    </CitationHover>
  )
}

// What Owlit's answer was before it read the paper's text, under the answer that replaced it
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

// A row opened in place: the paper's card, as the Library shows it, with what this thread says of the paper.
// The paper is in the Library already (a row is a Library paper), so Open only opens it.
// was: the answer Owlit replaced when it read the paper's text
export function RowPeek({ thread, row, library, className, was }: { thread: ThreadRead; row: ThreadRowRead; library: Paper | undefined; className?: string; was?: ReturnType<typeof readInFull> }) {
  const navigate = useNavigate()
  const setStarred = useLibraryStore((s) => s.setStarred)
  const facts = paperFacts(row, library)
  const view = shown(thread)
  const placed = view.rows.find((r) => r.id === row.id) ?? row
  const all = useThreadsStore((s) => s.threads)
  const others = Object.values(all).filter((c) => c.id !== thread.id && c.rows.some((r) => r.id === row.id))
  const groups = view.columns.flatMap((col) => (col.kind === "grouping" ? (placed.in?.[col.id] ?? []).flatMap((id) => col.groups?.find((g) => g.id === id)?.name ?? []) : []))
  const answer = placed.cells[QUESTION_COLUMN]
  const foundBy = row.foundBy
  // The other questions asked of every paper, and comparisons with a doc, each with the words it rests on
  const asked = view.columns.filter((col) => col.id !== QUESTION_COLUMN && col.kind !== "grouping" && !col.hidden && placed.cells[col.id]?.text && (col.kind !== "compare" || placed.cells[col.id]?.rel))
  const citations = library?.citations ?? (facts.citationCount ? { count: facts.citationCount, source: "", at: 0 } : undefined)
  return (
    <PaperCard
      facts={{ ...facts, citations }}
      paper={library}
      className={className ?? "px-2.5 pt-1 pb-1.5 pl-[38px]"}
      thread={
        <PaperCardThread groups={groups}>
          {(placed.is || answer) && (
            // An answer from the title only (the paper's record has no abstract) is thin: muted, and said so
            <p className={cn("mt-1 text-sm leading-relaxed", answer?.depth === "title" && "text-muted-foreground")}>
              {placed.is && <span className="text-muted-foreground">{placed.is}</span>}
              {placed.is && answer && " · "}
              {answer?.text}
              {answer && <span className="ml-1.5 text-detail whitespace-nowrap text-muted-foreground">{readDepthLabel(answer.depth)}</span>}
            </p>
          )}
          {answer && <WasLine was={was ?? null} className="mt-1" />}
          {answer?.passage && <Passage paperId={row.id} passage={answer.passage} />}
          {asked.map((col) => {
            const cell = placed.cells[col.id]!
            const sentence = col.kind === "compare" ? col.sentences?.find((s) => s.id === cell.sentence) : undefined
            return (
              <div key={col.id} className="mt-2.5">
                <p className="text-detail text-muted-foreground">{columnLabel(col)}</p>
                <p className={cn("text-sm leading-relaxed", cell.depth === "title" && "text-muted-foreground")}>
                  {cell.rel && <span className="mr-1 font-medium">{relWord(cell.rel)}:</span>}
                  {cell.text}
                </p>
                {sentence && <p className="text-detail text-muted-foreground">“{sentence.text}”</p>}
                {cell.passage && <Passage paperId={row.id} passage={cell.passage} />}
              </div>
            )
          })}
          {(foundBy || others.length > 0) && (
            <p className="mt-2.5 text-detail text-muted-foreground">
              {foundBy && t({ message: `Found: ${foundBy}`, comment: "how Owlit came to a thread's paper: a search's words, or the paper that cites it" })}
              {foundBy && others.length > 0 && " · "}
              {others.length > 0 && (
                <>
                  {t({ message: "Also in", comment: "followed by the other threads that hold this paper" })}{" "}
                  {others.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <MentionToken label={shown(c).title} title={threadUri(c.id)} onClick={() => navigate(`/threads/${c.id}`)} />
                    </span>
                  ))}
                </>
              )}
            </p>
          )}
        </PaperCardThread>
      }
      footer={
        <>
          <span className="flex-1" />
          {library && <StarButton starred={library.starred} onToggle={() => setStarred([library.id], !library.starred)} />}
          <Button size="sm" className="ml-1" onClick={() => navigate(`/library/${library?.id ?? row.id}`)}>
            {t({ message: "Open", comment: "button: open a paper to read" })}
          </Button>
        </>
      }
    />
  )
}

// The words an answer rests on, and the page they are on, which opens the paper there
function Passage({ paperId, passage }: { paperId: string; passage: { quote: string; page: number } }) {
  const navigate = useNavigate()
  const page = passage.page
  return (
    <Quote size="sm" className="mt-2">
      “{passage.quote}” <MentionToken label={t`Open at p. ${page}`} title={null} className="text-detail whitespace-nowrap" onClick={() => navigate(passageRoute(paperId, passage))} />
    </Quote>
  )
}
