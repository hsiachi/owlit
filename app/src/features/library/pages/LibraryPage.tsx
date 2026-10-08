import { useMemo, useState } from "react"
import { BookOpenIcon, FileUpIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { DetailPane } from "../components/DetailPane"
import { LibraryToolbar } from "../components/LibraryToolbar"
import { PaperTable } from "../components/PaperTable"
import { addPdfFiles } from "../lib/add-pdfs"
import { visiblePapers } from "../lib/filter"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

export function LibraryPage() {
  const papers = useLibraryStore((s) => s.papers)
  const query = useUiStore((s) => s.query)
  const filter = useUiStore((s) => s.filter)
  const tags = useUiStore((s) => s.tags)
  const sort = useUiStore((s) => s.sort)
  const detailOpen = useUiStore((s) => s.detailOpen)
  const setAddOpen = useUiStore((s) => s.setAddOpen)
  const [dragging, setDragging] = useState(0)

  const visible = useMemo(
    () => visiblePapers(papers, { query, filter, tags, sort }),
    [papers, query, filter, tags, sort],
  )
  const empty = Object.keys(papers).length === 0

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      // Counting enter/leave pairs is what keeps the overlay from flickering over child elements
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
      <LibraryToolbar />
      {empty ? (
        <Empty className="m-4 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon />
            </EmptyMedia>
            <EmptyTitle>Your library is empty</EmptyTitle>
            <EmptyDescription>Add a paper by DOI, arXiv id or URL, or drop a PDF anywhere on this page.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add a paper
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1">
          <PaperTable papers={visible} />
          {detailOpen && <DetailPane />}
        </div>
      )}
      {dragging > 0 && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-ring bg-background/80">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileUpIcon className="size-4" />
            Drop PDF to add
          </div>
        </div>
      )}
    </div>
  )
}
