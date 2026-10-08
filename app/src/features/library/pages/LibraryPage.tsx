import { useMemo, useState } from "react"
import { FileUpIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { AddCandidate } from "../components/AddCandidate"
import { BulkBar } from "../components/BulkBar"
import { FilterBar, FindField, LayoutToggle, LibraryHeader, SortMenu } from "../components/LibraryHeader"
import { PaperList, PaperTable } from "../components/PaperList"
import { addPdfFiles } from "../lib/add-pdfs"
import { groupPapers, visiblePapers } from "../lib/filter"
import { looksLikeRef } from "../lib/ref"
import { usePaperListKeys } from "../lib/use-list-keys"
import { useRefLookup } from "../lib/use-ref-lookup"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

// Scrolls the whole page; the column is as wide as the chat thread, wider for the table
export function LibraryShell({
  wide,
  scroller,
  onKeyDown,
  children,
}: {
  wide?: boolean
  scroller?: React.Ref<HTMLDivElement>
  onKeyDown?: (e: React.KeyboardEvent) => void
  children: React.ReactNode
}) {
  return (
    <div ref={scroller} tabIndex={-1} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className={cn("mx-auto w-full px-6 pt-10 pb-24", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</div>
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
  const layout = useUiStore((s) => s.layout)
  const [dragging, setDragging] = useState(0)

  const refInput = looksLikeRef(query) ? query.trim() : null
  const { lookup, add } = useRefLookup(refInput)
  const searchText = refInput ? "" : query

  const visible = useMemo(
    () => visiblePapers(papers, { query: searchText, filter, tags, sort }),
    [papers, searchText, filter, tags, sort],
  )
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
      <LibraryShell wide={table} scroller={scroller} onKeyDown={onKeyDown}>
        <LibraryHeader
          actions={
            <>
              {!table && <SortMenu />}
              <LayoutToggle />
            </>
          }
        />
        <FindField onSubmit={add} onPickFiles={addPdfFiles} />
        {refInput ? (
          <AddCandidate lookup={lookup} onAdd={add} input={refInput} />
        ) : (
          <>
            <FilterBar />
            <div className="mt-6">
              {empty ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Your library is empty. Paste a DOI, arXiv id or link above, or drop a PDF anywhere on this page.
                </p>
              ) : visible.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No papers match.</p>
              ) : table ? (
                <PaperTable papers={visible} order={order} />
              ) : (
                <PaperList groups={groups} order={order} />
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
