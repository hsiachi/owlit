import { t } from "@lingui/core/macro"
import { useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { DropCard, EmptyPlace } from "@/components/empty-place"
import { DropOverlay, PdfFileInput } from "@/components/file-drop"
import { InlineLink } from "@/components/inline-link"
import { PageShell } from "@/components/page"
import { Button } from "@/components/ui/button"
import { useFileDrop } from "@/hooks/use-file-drop"
import { AddCandidate } from "../components/AddCandidate"
import { BulkBar } from "../components/BulkBar"
import { FromBrowserLine } from "../components/FromBrowserLine"
import { ImportBanner } from "../components/ImportBanner"
import { FilterBar, LayoutToggle, LibraryFindField, LibraryHeader, SortMenu } from "../components/LibraryHeader"
import { PaperList, PaperTable } from "../components/PaperList"
import { RecentlyRemoved } from "../components/RecentlyRemoved"
import { addPdfFiles } from "../lib/add-pdfs"
import { openImportDialog, reviewImport } from "../imports"
import { filePath } from "@/lib/rpc"
import { groupPapers, matchesQuery, visiblePapers } from "../lib/filter"
import { useCollectionsStore } from "@/features/collections/store"
import { collectionsByPaper } from "@/features/collections/lib"
import { useTextHits } from "@/features/search/full-text"
import { looksLikeRef } from "../lib/ref"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useRefLookup } from "../lib/use-ref-lookup"
import { usePrefsStore } from "../prefs-store"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { starterPrompt } from "@/features/chat/lib/starters"

// All papers: everything in the library, narrowed by search, status and tags
export function LibraryPage() {
  const navigate = useNavigate()
  const papers = useLibraryStore((s) => s.papers)
  const query = useLibraryUi((s) => s.query)
  const filter = useLibraryUi((s) => s.filter)
  const tags = useLibraryUi((s) => s.tags)
  const only = useLibraryUi((s) => s.only)
  const sort = useLibraryUi((s) => s.sort)
  const layout = usePrefsStore((s) => s.layout)
  const { dragging, dropProps } = useFileDrop((data) => {
    const collection = droppedCollection(data)
    if (collection) reviewImport(collection.source, collection.path)
    else void addPdfFiles(Array.from(data.files))
  })

  // One field, two paths: a DOI, arXiv id or link (one token, see looksLikeRef) is a reference to add and
  // shows the AddCandidate card; anything else is words that narrow the list
  const refInput = looksLikeRef(query) ? query.trim() : null
  const { lookup, add } = useRefLookup(refInput)
  const searchText = refInput ? "" : query
  const words = searchText.trim()

  const textHits = useTextHits(searchText)
  const visible = useMemo(
    () => visiblePapers(papers, { query: searchText, filter, tags, sort, only }, textHits),
    [papers, searchText, filter, tags, sort, only, textHits],
  )
  // A paper found by its text, not its details, shows where the words were
  const snippets = useMemo(() => {
    const q = searchText.trim()
    return new Map(visible.flatMap((p) => (!matchesQuery(p, q) && textHits.has(p.id) ? [[p.id, textHits.get(p.id)!] as const] : [])))
  }, [visible, textHits, searchText])
  const collections = useCollectionsStore((s) => s.collections)
  const aliases = useLibraryStore((s) => s.aliases)
  // The table's Collection column wants it whatever the order; the list only when grouped by collection
  const table = layout === "table"
  const byCollection = useMemo(() => (table || sort.key === "collection" ? collectionsByPaper(collections, papers, aliases) : undefined), [table, sort.key, collections, papers, aliases])
  const searching = searchText.trim().length > 0
  const groups = useMemo(() => groupPapers(visible, sort, searching, Date.now(), byCollection), [visible, sort, searching, byCollection])
  // Grouped by collection, papers show in their groups' order, which the keys follow
  const byGroups = sort.key === "collection" && !searching
  const order = useMemo(() => (byGroups ? groups.flatMap((g) => g.papers.map((p) => p.id)) : visible.map((p) => p.id)), [byGroups, groups, visible])
  const { scroller, listProps } = usePaperListKeys(order)
  const empty = Object.keys(papers).length === 0
  const noMatch = words.length > 0 && visible.length === 0
  const unfiltered = !refInput && !words && filter === "all" && tags.length === 0 && !only

  // Words the library doesn't have are a question for Owlit: they go to Chat as the composer's text, the
  // way "Ask Owlit to find papers" hands over its stem (Chat's starter, in the interface's language), so
  // nothing is sent until the person says so.
  const askOwlit = () => navigate("/chat", { state: { starter: `${starterPrompt("find")}${words}` } })
  // Enter in the field adds the reference it holds. Words that match nothing go to Owlit at once rather
  // than moving focus to the button: the hand-off is the one thing offered, and it only fills the composer.
  // Words with matches have already done their work by narrowing the list.
  const submit = () => {
    if (refInput) add()
    else if (noMatch) askOwlit()
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropProps}>
      <PageShell scroller={scroller} {...listProps}>
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
        <ImportBanner />
        <FromBrowserLine />
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
                <p className="py-16 text-center text-sm text-muted-foreground">{t`No papers match.`}</p>
              ) : table ? (
                <PaperTable papers={visible} groups={byGroups ? groups : undefined} byCollection={byCollection} snippets={snippets} />
              ) : (
                <PaperList groups={groups} snippets={snippets} />
              )}
            </div>
          </>
        )}
        {/* Under the whole library only: a narrowed list isn't where a removed paper would be looked for */}
        {unfiltered && <RecentlyRemoved />}
      </PageShell>
      <BulkBar />
      {dragging && <DropOverlay label={t`Drop PDFs to add, or a BibTeX file or a folder to import`} />}
    </div>
  )
}

// Words no paper matches: the list says so with the words themselves, and offers the next step. The one
// action is a hand-off to Owlit, the same as the empty library's, so finding papers is always one button.
function NoMatch({ words, onAsk }: { words: string; onAsk: () => void }) {
  return (
    <EmptyPlace title={t`No papers match “${words}”`} detail={t`Owlit can look for papers on this and add what it finds.`} className="py-16">
      <Button variant="outline" size="sm" onClick={onAsk}>
        {t`Ask Owlit to find papers about this`}
      </Button>
    </EmptyPlace>
  )
}

// A .bib file or a folder dropped on the Library is a collection to import, not papers to add one by one
function droppedCollection(data: DataTransfer): { source: "bibtex" | "folder"; path: string } | null {
  const files = Array.from(data.files)
  if (files.length !== 1) return null
  const entry = data.items[0]?.webkitGetAsEntry()
  try {
    if (entry?.isDirectory) return { source: "folder", path: filePath(files[0]) }
    if (/\.bib$/i.test(files[0].name)) return { source: "bibtex", path: filePath(files[0]) }
  } catch {
    // Not a file on disk (a browser without the desktop app)
  }
  return null
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
        title={t`Add your first papers`}
        detail={t`Paste a DOI, arXiv id or link in the field above, or drop PDFs here.`}
        actions={
          <>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              {t`Choose PDFs`}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/chat", { state: { starter: starterPrompt("find") } })}>
              {t`Ask Owlit to find papers`}
            </Button>
          </>
        }
      >
        <p className="text-detail text-muted-foreground">
          {t`Coming from Zotero or BibTeX?`} <InlineLink onClick={openImportDialog}>{t`Import your collection`}</InlineLink>
        </p>
      </DropCard>
      <PdfFileInput ref={fileInput} multiple onFiles={(files) => void addPdfFiles(files)} />
    </div>
  )
}
