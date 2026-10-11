import { useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { DropCard } from "@/components/empty-place"
import { DropOverlay, PdfFileInput } from "@/components/file-drop"
import { PageShell } from "@/components/page"
import { Button } from "@/components/ui/button"
import { useFileDrop } from "@/hooks/use-file-drop"
import { AddCandidate } from "../components/AddCandidate"
import { BulkBar } from "../components/BulkBar"
import { FilterBar, LayoutToggle, LibraryFindField, LibraryHeader, SortMenu } from "../components/LibraryHeader"
import { PaperList, PaperTable } from "../components/PaperList"
import { addPdfFiles } from "../lib/add-pdfs"
import { groupPapers, matchesQuery, visiblePapers } from "../lib/filter"
import { useTextHits } from "@/features/search/full-text"
import { looksLikeRef } from "../lib/ref"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useRefLookup } from "../lib/use-ref-lookup"
import { usePrefsStore } from "../prefs-store"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

// All papers: everything in the library, narrowed by search, status and tags
export function LibraryPage() {
  const papers = useLibraryStore((s) => s.papers)
  const query = useUiStore((s) => s.query)
  const filter = useUiStore((s) => s.filter)
  const tags = useUiStore((s) => s.tags)
  const sort = useUiStore((s) => s.sort)
  const layout = usePrefsStore((s) => s.layout)
  const { dragging, dropProps } = useFileDrop((data) => void addPdfFiles(Array.from(data.files)))

  const refInput = looksLikeRef(query) ? query.trim() : null
  const { lookup, add } = useRefLookup(refInput)
  const searchText = refInput ? "" : query

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
        <LibraryFindField onSubmit={add} onPickFiles={addPdfFiles} />
        {refInput ? (
          <AddCandidate lookup={lookup} onAdd={add} input={refInput} />
        ) : empty ? (
          // Filters with nothing to count would only say 0 five times
          <EmptyLibrary />
        ) : (
          <>
            <FilterBar />
            <div className="mt-6">
              {visible.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No papers match.</p>
              ) : table ? (
                <PaperTable papers={visible} order={order} snippets={snippets} />
              ) : (
                <PaperList groups={groups} order={order} snippets={snippets} />
              )}
            </div>
          </>
        )}
      </PageShell>
      <BulkBar />
      {dragging && <DropOverlay label="Drop PDF to add" />}
    </div>
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
