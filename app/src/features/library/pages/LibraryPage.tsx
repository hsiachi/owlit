import { useMemo, useRef, useState } from "react"
import { FileUpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddCandidate } from "../components/AddCandidate"
import { BulkBar } from "../components/BulkBar"
import { FilterBar, FindField, LayoutToggle, LibraryHeader, SortMenu } from "../components/LibraryHeader"
import { PaperList, PaperTable } from "../components/PaperList"
import { addPdfFiles } from "../lib/add-pdfs"
import { groupPapers, matchesQuery, visiblePapers } from "../lib/filter"
import { useTextHits } from "../lib/text-hits"
import { looksLikeRef } from "../lib/ref"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useRefLookup } from "../lib/use-ref-lookup"
import { usePrefsStore } from "../prefs-store"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

// Scrolls the whole page. One width for every Library page and layout, so switching tabs or
// between list and table never moves the header.
export function LibraryShell({
  scroller,
  onKeyDown,
  children,
}: {
  scroller?: React.Ref<HTMLDivElement>
  onKeyDown?: (e: React.KeyboardEvent) => void
  children: React.ReactNode
}) {
  return (
    <div ref={scroller} tabIndex={-1} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className="mx-auto w-full max-w-6xl px-6 pt-10 pb-24">{children}</div>
    </div>
  )
}

// All papers: everything in the library, narrowed by search, status and tags
export function LibraryPage() {
  const papers = useLibraryStore((s) => s.papers)
  const query = useUiStore((s) => s.query)
  const filter = useUiStore((s) => s.filter)
  const tags = useUiStore((s) => s.tags)
  const sort = useUiStore((s) => s.sort)
  const layout = usePrefsStore((s) => s.layout)
  const [dragging, setDragging] = useState(0)

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

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      // Counting enter/leave pairs keeps the overlay from flickering over child elements
      onDragEnter={(e) => hasFiles(e) && setDragging((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setDragging((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(0)
        addPdfFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <LibraryShell scroller={scroller} onKeyDown={onKeyDown}>
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
        <FindField onSubmit={add} onPickFiles={addPdfFiles} />
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
      </LibraryShell>
      <BulkBar />
      {dragging > 0 && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/20 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileUpIcon className="size-4" />
            Drop PDF to add
          </div>
        </div>
      )}
    </div>
  )
}

// The first papers come from the find field above or a drop; the card says both, drawn like the paper
// page's missing-PDF card. The whole page takes the drop, not just the card.
function EmptyLibrary() {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="mt-12 flex justify-center">
      <div className="flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/15 px-14 py-10 text-center">
        <p className="text-[15px] font-medium">Add your first papers</p>
        <p className="max-w-72 text-sm text-muted-foreground">Paste a DOI, arXiv id or link in the field above, or drop PDFs here.</p>
        <Button size="sm" className="mt-3" onClick={() => fileInput.current?.click()}>
          Choose PDFs
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            void addPdfFiles(Array.from(e.target.files ?? []))
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}
