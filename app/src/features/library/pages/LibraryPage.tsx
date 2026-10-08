import { useMemo, useState } from "react"
import { FileUpIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { DetailPane } from "../components/DetailPane"
import { LibraryHeader } from "../components/LibraryHeader"
import { PaperList } from "../components/PaperList"
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
      className="relative flex min-h-0 flex-1"
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
      {empty ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle className="font-heading text-2xl font-medium tracking-tight">Your library is empty</EmptyTitle>
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
        <>
          {/* Container queries let the list drop its secondary columns when the detail pane narrows it */}
          <div className="@container flex min-w-0 flex-1 flex-col">
            <LibraryHeader />
            <PaperList papers={visible} />
          </div>
          {detailOpen && <DetailPane />}
        </>
      )}
      {dragging > 0 && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/20 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileUpIcon className="size-4" />
            Drop PDF to add
          </div>
        </div>
      )}
    </div>
  )
}
