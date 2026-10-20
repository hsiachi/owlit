import { t } from "@lingui/core/macro"
import { itemId, type Paper, QUESTION_COLUMN, readInFull, type ThreadRead, type ThreadRowRead, threadUri } from "@owlit/protocol"
import { useNavigate } from "react-router-dom"
import { NoteDot, ReadingRing } from "@/components/marks"
import { CitationHover } from "@/components/citation-card"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { PaperCard, PaperCardThread } from "@/components/paper-card"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import { StarButton } from "@/features/library/components/StarButton"
import { useLibraryStore } from "@/features/library/store"
import { cn } from "@/lib/utils"
import { citeOf, columnLabel, nameOf, paperFacts, passageRoute, relWord, shown, useLibraryPaper } from "../lib"
import { useThreadsStore } from "../store"
import { useThreadsUi } from "../ui-store"
import { useReadInFull, useSeenOnScreen, type VisitDots } from "../seen"

// The papers of a thread without columns, one line each: what the paper says about the question
// first, the paper after it, named as the report names it ("CiteSee · 2023"). Every answer is in ink: one from
// the full text ends in the page it rests on, so an answer without a page is from the abstract, and grey
// keeps meaning only "secondary" or "unread". The slot before it is Owlit's dot while the answer is new
// since the user looked; their own reading is a half ring after the paper's name, on the thing it is about.
export function AnswerRows({ thread, shown, visit }: { thread: ThreadRead; shown: ThreadRead; visit: VisitDots }) {
  const peek = useThreadsUi((s) => s.peek)
  if (!shown.rows.length) return null
  return (
    <div className="-mx-1.5 mt-8 flex flex-col">
      {shown.rows.map((row) => {
        const items = [itemId.row(row.id), itemId.cell(row.id, QUESTION_COLUMN)]
        return <AnswerRow key={row.id} thread={thread} row={row} items={items} fresh={items.some(visit.fresh)} reread={readInFull(visit.changeOf(items[1]!))} open={peek === row.id} />
      })}
    </div>
  )
}

export function ReadingMark({ paper, className }: { paper: Paper | undefined; className?: string }) {
  if (!paper || paper.status === "unread") return null
  return <ReadingRing label={t`You've read some of it`} className={className} />
}

// reread: the dot's change is Owlit answering again from the full text: the page says so while the dot
// lasts, and the opened row keeps the answer it replaced after
function AnswerRow({ thread, row, items, fresh, reread, open }: { thread: ThreadRead; row: ThreadRowRead; items: string[]; fresh: boolean; reread: ReturnType<typeof readInFull>; open: boolean }) {
  const seenRef = useSeenOnScreen<HTMLDivElement>(thread.id, items)
  const set = useThreadsUi((s) => s.set)
  const library = useLibraryPaper(row)
  const facts = paperFacts(row, library)
  const answer = row.cells[QUESTION_COLUMN]
  const was = useReadInFull(thread.id, itemId.cell(row.id, QUESTION_COLUMN), open)
  const toggle = () => set({ peek: open ? null : row.id })
  return (
    <div
      ref={seenRef}
      id={`row-${row.id}`}
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
              {/* A space rather than a margin, so a name that wraps starts flush with the answer */}
              <span>{answer?.text ?? facts.title}</span>{" "}
              <span className="inline-flex max-w-[36ch] items-center gap-1.5 align-bottom text-detail text-muted-foreground" title={`${facts.title} · ${citeOf(facts)}`}>
                <span className="truncate">{nameOf(facts)}</span>
                <ReadingMark paper={library} />
              </span>
            </>
          )}
        </span>
        {!open && answer?.depth === "full" && answer.passage && <PageLink paperId={row.id} passage={answer.passage} library={library} changed={fresh && !!reread} />}
      </div>
      <Unfold open={open}>
        <RowPeek thread={thread} row={row} library={library} was={was === undefined ? reread : was} />
      </Unfold>
    </div>
  )
}

// The page an answer rests on, which opens the paper at those words (a paper read in full is in the
// Library); on hover, the citation's card checks the words against the paper. changed: the answer was
// just written again from the full text, said in Owlit's colour where the page alone would be.
function PageLink({ paperId, passage, library, changed }: { paperId: string; passage: { quote: string; page: number }; library: Paper | undefined; changed?: boolean }) {
  const navigate = useNavigate()
  const page = passage.page
  const pageLabel = t({ message: `p. ${page}`, comment: "a page of a paper" })
  const label = changed ? `${t({ message: "Changed after reading in full", comment: "chip on a thread cell Owlit answered again from the full text" })} · ${pageLabel}` : pageLabel
  return (
    <span className="shrink-0 text-detail">
      <CitationHover citation={{ paperId, page, quote: passage.quote, depth: "full" }}>
        <MentionToken label={label} title={null} className={changed ? "text-owlit" : undefined} onClick={library ? () => navigate(passageRoute(library.id, passage)) : undefined} />
      </CitationHover>
    </span>
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

// A row opened in place: the paper's card, as the Library shows it, with what this thread says of the paper.
// The paper is in the Library already (a row is a Library paper), so Open only opens it.
// was: the answer Owlit replaced when it read the paper in full
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
              {answer && answer.depth !== "full" && <span className="ml-1.5 text-detail whitespace-nowrap text-muted-foreground">{answer.depth === "title" ? t`From the title only` : t`From the abstract`}</span>}
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
