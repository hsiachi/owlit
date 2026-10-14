import { t } from "@lingui/core/macro"
import { collectionUri, itemId, QUESTION_COLUMN, shownCollection, type Collection, type CollectionRow } from "@owlit/protocol"
import { useNavigate } from "react-router-dom"
import { NoteDot } from "@/components/marks"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { stripLatex } from "@/features/library/lib/latex"
import { cn } from "@/lib/utils"
import { citeOf, nameOf, paperFacts, passageRoute, useLibraryPaper } from "../lib"
import { editCollection, removeRow, useCollectionsStore } from "../store"
import { ChoiceMenu } from "@/components/choice-menu"
import { useCollectionsUi } from "../ui-store"

// The papers of a collection without columns, one line each: what the paper says about the question
// first, the paper after it, named as the memo names it ("CiteSee · 2023"). Every answer is in ink: one from
// the full text ends in the page it rests on, so an answer without a page is from the abstract, and grey
// keeps meaning only "secondary" or "unread". The slot before it is Owlit's dot while the answer is new
// since the user looked; their own reading is a half ring after the paper's name, on the thing it is about.
export function AnswerRows({ collection, shown, seenBefore }: { collection: Collection; shown: Collection; seenBefore: number }) {
  const peek = useCollectionsUi((s) => s.peek)
  if (!shown.rows.length) return null
  return (
    <div className="-mx-1.5 mt-8 flex flex-col">
      {shown.rows.map((row) => {
        const fresh = Math.max(collection.changedAt[itemId.row(row.id)] ?? 0, collection.changedAt[itemId.cell(row.id, QUESTION_COLUMN)] ?? 0) > seenBefore
        return <AnswerRow key={row.id} collection={collection} row={row} fresh={fresh} open={peek === row.id} />
      })}
    </div>
  )
}

export function ReadingMark({ paper, className }: { paper: Paper | undefined; className?: string }) {
  if (!paper || paper.status === "unread") return null
  const label = t`You've read some of it`
  return <span role="img" aria-label={label} title={label} className={cn("inline-block size-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground bg-[linear-gradient(90deg,var(--muted-foreground)_50%,transparent_50%)]", className)} />
}

function AnswerRow({ collection, row, fresh, open }: { collection: Collection; row: CollectionRow; fresh: boolean; open: boolean }) {
  const set = useCollectionsUi((s) => s.set)
  const library = useLibraryPaper(row)
  const facts = paperFacts(row, library)
  const answer = row.cells[QUESTION_COLUMN]
  const toggle = () => set({ peek: open ? null : row.id })
  return (
    <div
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
        {!open && answer?.depth === "full" && answer.passage && <PageLink passage={answer.passage} library={library} />}
      </div>
      <Unfold open={open}>
        <RowPeek collection={collection} row={row} library={library} />
      </Unfold>
    </div>
  )
}

// The page an answer rests on, which opens the paper at those words (a paper read in full is in the Library)
function PageLink({ passage, library }: { passage: { quote: string; page: number }; library: Paper | undefined }) {
  const navigate = useNavigate()
  const page = passage.page
  return (
    <span className="shrink-0 text-detail">
      <MentionToken label={t({ message: `p. ${page}`, comment: "a page of a paper" })} title={`“${passage.quote}”`} onClick={library ? () => navigate(passageRoute(library.id, passage)) : undefined} />
    </span>
  )
}

// A row opened in place: enough to decide whether to read the paper. A paper Owlit only found isn't in
// the Library: opening it, or adding it, brings it in, since it is then being used.
export function RowPeek({ collection, row, library, className }: { collection: Collection; row: CollectionRow; library: Paper | undefined; className?: string }) {
  const navigate = useNavigate()
  const addPaper = useLibraryStore((s) => s.addPaper)
  const facts = paperFacts(row, library)
  const answer = shownCollection(collection).rows.find((r) => r.id === row.id)?.cells[QUESTION_COLUMN]
  const all = useCollectionsStore((s) => s.collections)
  const others = Object.values(all).filter((c) => c.id !== collection.id && c.rows.some((r) => r.id === row.id && !c.yours.removed[itemId.row(r.id)]))
  const published = [facts.venue, facts.year].filter(Boolean).join(" · ")
  const bring = () => library ?? addPaper({ id: row.id, title: facts.title, authors: facts.authors, ids: facts.ids, year: facts.year, venue: facts.venue, abstract: facts.abstract, kind: facts.kind }, "user")
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
          <p className="mt-2.5 text-sm leading-relaxed">
            {answer.text}
            {answer.depth === "abstract" && <span className="ml-1.5 text-detail whitespace-nowrap text-muted-foreground">{t`From the abstract`}</span>}
          </p>
        )}
        {answer?.passage && (
          <Quote size="sm" className="mt-2">
            “{answer.passage.quote}” <span className="text-detail">{t({ message: `p. ${answer.passage.page}`, comment: "a page of a paper" })}</span>
          </Quote>
        )}
        {facts.abstract && <p className="mt-2.5 line-clamp-3 text-detail leading-relaxed text-muted-foreground">{stripLatex(facts.abstract)}</p>}
        {others.length > 0 && (
          <p className="mt-2.5 text-detail text-muted-foreground">
            {t({ message: "Also in", comment: "followed by the other collections that hold this paper" })}{" "}
            {others.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <MentionToken label={shownCollection(c).title} title={collectionUri(c.id)} onClick={() => navigate(`/collections/${c.id}`)} />
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="mt-3.5 flex items-center gap-1">
        <Button variant="ghost" size="sm" className="-ml-2.5 font-normal text-muted-foreground" onClick={() => void removeRow(collection.id, row.id)}>
          {t({ message: "Remove", comment: "take a paper off this collection" })}
        </Button>
        {collection.groups.length > 0 && (
          <ChoiceMenu
            value={row.group ?? ""}
            onChange={(group) => void editCollection(collection.id, { op: "move", row: row.id, group: group || null })}
            label={t`Move to group`}
            trigger={t`Move to group…`}
            align="start"
            icon={null}
            options={[...shownCollection(collection).groups.map((g) => ({ value: g.id, label: g.name })), { value: "", label: t({ message: "No group", comment: "a paper in no group of its collection" }) }]}
          />
        )}
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
