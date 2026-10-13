import { useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { DropCard, EmptyPlace } from "@/components/empty-place"
import { DropOverlay, PdfFileInput } from "@/components/file-drop"
import { PageShell } from "@/components/page"
import { Button } from "@/components/ui/button"
import { useFileDrop } from "@/hooks/use-file-drop"
import { AddCandidate } from "../components/AddCandidate"
import { BulkBar } from "../components/BulkBar"
import { FilterBar, LayoutToggle, LibraryFindField, LibraryHeader, SortMenu } from "../components/LibraryHeader"
import { PaperList, PaperTable } from "../components/PaperList"
import { RecentlyRemoved } from "../components/RecentlyRemoved"
import { addPdfFiles } from "../lib/add-pdfs"
import { groupPapers, matchesQuery, visiblePapers } from "../lib/filter"
import { useTextHits } from "@/features/search/full-text"
import { looksLikeRef } from "../lib/ref"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useRefLookup } from "../lib/use-ref-lookup"
import { usePrefsStore } from "../prefs-store"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// All papers: everything in the library, narrowed by search, status and tags
export function LibraryPage() {
  const navigate = useNavigate()
  const papers = useLibraryStore((s) => s.papers)
  const query = useLibraryUi((s) => s.query)
  const filter = useLibraryUi((s) => s.filter)
  const tags = useLibraryUi((s) => s.tags)
  const sort = useLibraryUi((s) => s.sort)
  const layout = usePrefsStore((s) => s.layout)
  const { dragging, dropProps } = useFileDrop((data) => void addPdfFiles(Array.from(data.files)))

  // One field, two paths: a DOI, arXiv id or link (one token, see looksLikeRef) is a reference to add and
  // shows the AddCandidate card; anything else is words that narrow the list
  const refInput = looksLikeRef(query) ? query.trim() : null
  const { lookup, add } = useRefLookup(refInput)
  const searchText = refInput ? "" : query
  const words = searchText.trim()

  const textHits = useTextHits(searchText)
  const visible = useMemo(
    () => visiblePapers(papers, { query: searchText, filter, tags, sort }, textHits),
    [papers, searchText, filter, tags, sort, textHits],
  )
  // A paper found by its text, not its details, shows where the words were
  const snippets = useMemo(() => {
    const q = searchText.trim()
    return new Map(visible.flatMap((p) => (!matchesQuery(p, q) && textHits.has(p.id) ? [[p.id, textHits.get(p.id)!] as const] : [])))
  }, [visible, textHits, searchText])
  const order = useMemo(() => visible.map((p) => p.id), [visible])
  const groups = useMemo(() => groupPapers(visible, sort, searchText.trim().length > 0), [visible, sort, searchText])
  const { scroller, onKeyDown } = usePaperListKeys(order)
  const table = layout === "table"
  const empty = Object.keys(papers).length === 0
  const noMatch = words.length > 0 && visible.length === 0
  const unfiltered = !refInput && !words && filter === "all" && tags.length === 0

  // Words the library doesn't have are a question for Owlit: they go to Chat as the composer's text, the
  // way "Ask Owlit to find papers" hands over its stem, so nothing is sent until the person says so
  const askOwlit = () => navigate("/chat", { state: { starter: `Find recent papers on ${words}` } })
  // Enter in the field adds the reference it holds. Words that match nothing go to Owlit at once rather
  // than moving focus to the button: the hand-off is the one thing offered, and it only fills the composer.
  // Words with matches have already done their work by narrowing the list.
  const submit = () => {
    if (refInput) add()
    else if (noMatch) askOwlit()
  }

  // The open peek belongs to this visit: it folds when the page is left, so coming back from a paper (or
  // from Up next) shows the list at rest instead of a card the person has already read
  useEffect(() => () => useLibraryUi.getState().closePeek(), [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropProps}>
      <PageShell scroller={scroller} onKeyDown={onKeyDown}>
        <LibraryHeader
          actions={
            !empty && (
              <>
                {!table && <SortMenu />}
                <LayoutToggle />
              </>
            )
          }
        />
        <LibraryFindField onSubmit={submit} onPickFiles={addPdfFiles} />
        {refInput ? (
          <AddCandidate lookup={lookup} onAdd={add} input={refInput} />
        ) : empty ? (
          // Filters with nothing to count would only say 0 five times; words typed into an empty library
          // get the same answer as words no paper matches
          noMatch ? <NoMatch words={words} onAsk={askOwlit} /> : <EmptyLibrary />
        ) : (
          <>
            <FilterBar />
            <div className="mt-6">
              {noMatch ? (
                <NoMatch words={words} onAsk={askOwlit} />
              ) : visible.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No papers match.</p>
              ) : table ? (
                <PaperTable papers={visible} order={order} snippets={snippets} />
              ) : (
                <PaperList groups={groups} order={order} snippets={snippets} />
              )}
            </div>
          </>
        )}
        {/* Under the whole library only: a narrowed list isn't where a removed paper would be looked for */}
        {unfiltered && <RecentlyRemoved />}
      </PageShell>
      <BulkBar />
      {dragging && <DropOverlay label="Drop PDF to add" />}
    </div>
  )
}

// Words no paper matches: the list says so with the words themselves, and offers the next step. The one
// action is a hand-off to Owlit, the same as the empty library's, so finding papers is always one button.
function NoMatch({ words, onAsk }: { words: string; onAsk: () => void }) {
  return (
    <EmptyPlace title={<>No papers match “{words}”</>} detail="Owlit can look for papers on this and add what it finds." className="py-16">
      <Button variant="outline" size="sm" onClick={onAsk}>
        Ask Owlit to find papers about this
      </Button>
    </EmptyPlace>
  )
}

// The first papers come from the find field above or a drop; the card says both. The whole page takes the
// drop, not just the card. Ask Owlit to find papers hands the search to Chat, which is also how people
// learn that work can be handed off.
function EmptyLibrary() {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="mt-12 flex justify-center">
      <DropCard
        title="Add your first papers"
        detail="Paste a DOI, arXiv id or link in the field above, or drop PDFs here."
        actions={
          <>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              Choose PDFs
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/chat", { state: { starter: "Find recent papers on " } })}>
              Ask Owlit to find papers
            </Button>
          </>
        }
      />
      <PdfFileInput ref={fileInput} multiple onFiles={(files) => void addPdfFiles(files)} />
    </div>
  )
}
