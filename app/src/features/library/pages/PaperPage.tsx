import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FileUpIcon,
  HighlighterIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PaperDropdownContent } from "../components/PaperMenu"
import { PaperInfo } from "../components/PaperInfo"
import { StarButton } from "../components/StarButton"
import { StatusSelect } from "../components/StatusSelect"
import { visiblePapers } from "../lib/filter"
import { libraryClient, useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"

type PanelTab = "info" | "highlights" | "note"

export function PaperPage() {
  const { paperId = "" } = useParams()
  const navigate = useNavigate()
  const paper = useLibraryStore((s) => s.papers[paperId])
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const markOpened = useLibraryStore((s) => s.markOpened)
  const [panelOpen, setPanelOpen] = useState(true)
  const [tab, setTab] = useState<PanelTab>("info")

  // Previous / next walk the table as it is currently filtered and sorted
  const papers = useLibraryStore((s) => s.papers)
  const query = useUiStore((s) => s.query)
  const filter = useUiStore((s) => s.filter)
  const tags = useUiStore((s) => s.tags)
  const sort = useUiStore((s) => s.sort)
  const setActive = useUiStore((s) => s.setActive)
  const order = useMemo(
    () => visiblePapers(papers, { query, filter, tags, sort }).map((p) => p.id),
    [papers, query, filter, tags, sort],
  )
  const idx = order.indexOf(paperId)
  const prevId = idx > 0 ? order[idx - 1] : null
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null

  // Opening a paper with a PDF counts as starting to read it; the table's cursor follows
  useEffect(() => {
    if (!paper) return
    setActive(paper.id)
    if (paper.pdf) markOpened(paper.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])

  if (!paper) {
    return (
      <Empty className="m-4">
        <EmptyHeader>
          <EmptyTitle>This paper is not in the library</EmptyTitle>
          <EmptyDescription>It may have been removed.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => navigate("/library")}>
            Back to library
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const go = (id: string | null) => id && navigate(`/library/${id}`, { replace: true })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={paper.title}>
          {paper.title}
        </h1>
        <StarButton starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
        <StatusSelect value={paper.status} onChange={(s) => setStatus([paper.id], s)} className="mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!prevId} onClick={() => go(prevId)} aria-label="Previous paper">
              <ChevronUpIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous paper</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!nextId} onClick={() => go(nextId)} aria-label="Next paper">
              <ChevronDownIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next paper</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={panelOpen}
              onClick={() => setPanelOpen((o) => !o)}
              className={cn(panelOpen && "bg-accent text-accent-foreground")}
              aria-label="Toggle side panel"
            >
              <PanelRightIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{panelOpen ? "Hide panel" : "Show panel"}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <PaperDropdownContent ids={[paper.id]} afterRemove={() => navigate("/library")} />
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {paper.pdf ? <ReaderPlaceholder paper={paper} /> : <NoPdf paper={paper} />}
        </main>
        {panelOpen && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l">
            <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="min-h-0 flex-1 gap-0">
              <TabsList variant="line" className="h-10 w-full justify-start border-b px-2">
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="highlights">Highlights</TabsTrigger>
                <TabsTrigger value="note">Note</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="p-4">
                    <PaperInfo paper={paper} />
                  </div>
                </ScrollArea>
              </TabsContent>
              <TabsContent value="highlights" className="min-h-0 flex-1">
                <Empty className="h-full border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HighlighterIcon />
                    </EmptyMedia>
                    <EmptyTitle>No highlights yet</EmptyTitle>
                    <EmptyDescription>Select text in the PDF to highlight it. They will be listed here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TabsContent>
              <TabsContent value="note" className="min-h-0 flex-1">
                <NoteEditor paperId={paper.id} />
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>
    </div>
  )
}

// Stands in for the EmbedPDF reader until it is ported
function ReaderPlaceholder({ paper }: { paper: Paper }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <Empty className="max-w-sm border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>PDF reader coming next</EmptyTitle>
          <EmptyDescription>
            The reader with highlights is the next phase.
            {paper.lastPage ? ` You were on page ${paper.lastPage}.` : ""}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <a href={paper.pdf?.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Open PDF in browser
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const attach = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    updatePaper(paper.id, { pdf: { url: URL.createObjectURL(file) } })
    toast("PDF attached", { description: file.name })
  }

  const fetchPdf = async () => {
    setFetching(true)
    try {
      const pdf = await libraryClient.fetchPdf(paper)
      updatePaper(paper.id, { pdf })
      toast("PDF found")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fetch a PDF.")
    } finally {
      setFetching(false)
    }
  }

  return (
    <div
      className="flex flex-1 items-center justify-center p-6"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        attach(e.dataTransfer.files)
      }}
    >
      <Empty className={cn("max-w-sm border", dragging && "border-ring bg-muted")}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileUpIcon />
          </EmptyMedia>
          <EmptyTitle>No PDF yet</EmptyTitle>
          <EmptyDescription>Drop a PDF here, choose a file, or try fetching an open-access copy.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button onClick={fetchPdf} disabled={fetching}>
              {fetching ? <Spinner /> : null}
              Fetch PDF
            </Button>
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              attach(e.target.files)
              e.target.value = ""
            }}
          />
        </EmptyContent>
      </Empty>
    </div>
  )
}

function NoteEditor({ paperId }: { paperId: string }) {
  const note = useLibraryStore((s) => s.notes[paperId])
  const setNote = useLibraryStore((s) => s.setNote)
  return (
    <Textarea
      value={note?.content ?? ""}
      onChange={(e) => setNote(paperId, e.target.value)}
      placeholder="Your note on this paper…"
      className="h-full resize-none rounded-none border-0 p-4 shadow-none focus-visible:ring-0"
    />
  )
}
