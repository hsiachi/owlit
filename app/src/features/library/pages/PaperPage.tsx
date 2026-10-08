import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, EllipsisVerticalIcon, ExternalLinkIcon, PanelRightIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PaperDropdownContent } from "../components/PaperMenu"
import { StarButton } from "../components/StarButton"
import { StatusMenu } from "../components/StatusMenu"
import { TagsEditor } from "../components/TagsEditor"
import { externalLinks, formatAdded } from "../lib/format"
import { visiblePapers } from "../lib/filter"
import { libraryClient, useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"

type PanelTab = "notes" | "highlights" | "about"

function IconButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className="text-muted-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// One paper, reader first: the PDF on a darker well, details beside it
export function PaperPage() {
  const { paperId = "" } = useParams()
  const navigate = useNavigate()
  const paper = useLibraryStore((s) => s.papers[paperId])
  const markOpened = useLibraryStore((s) => s.markOpened)
  const note = useLibraryStore((s) => s.notes[paperId])
  const [panelOpen, setPanelOpen] = useState(true)
  const [tab, setTab] = useState<PanelTab>(note?.content ? "notes" : "about")

  // Previous / next walk All papers as it is currently filtered and sorted
  const papers = useLibraryStore((s) => s.papers)
  const query = useUiStore((s) => s.query)
  const filter = useUiStore((s) => s.filter)
  const tags = useUiStore((s) => s.tags)
  const sort = useUiStore((s) => s.sort)
  const order = useMemo(() => visiblePapers(papers, { query, filter, tags, sort }).map((p) => p.id), [papers, query, filter, tags, sort])
  const idx = order.indexOf(paperId)
  const prevId = idx > 0 ? order[idx - 1] : null
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null

  // Opening a paper with a PDF counts as starting to read it. The list's keyboard cursor follows so
  // ↑↓ carry on from here after going back, but nothing is shown as selected.
  useEffect(() => {
    if (!paper) return
    useUiStore.setState({ cursorId: paper.id, anchorId: paper.id, selectedIds: [], peekId: null })
    if (paper.pdf) markOpened(paper.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])

  if (!paper) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[15px] font-medium">This paper is not in the library</p>
        <p className="text-sm text-muted-foreground">It may have been removed.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/library")}>
          Back to library
        </Button>
      </div>
    )
  }

  const go = (id: string | null) => id && navigate(`/library/${id}`, { replace: true })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2.5 pl-4 text-[13px]">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          <Link to="/library" className="-ml-1 shrink-0 rounded-md px-1 py-0.5 hover:bg-muted hover:text-foreground">
            Library
          </Link>
          <ChevronRightIcon className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">{paper.title}</span>
        </nav>
        {idx >= 0 && (
          <span className="mr-1 text-xs text-muted-foreground tabular-nums">
            {idx + 1} of {order.length}
          </span>
        )}
        <IconButton label="Previous paper" disabled={!prevId} onClick={() => go(prevId)}>
          <ChevronUpIcon />
        </IconButton>
        <IconButton label="Next paper" disabled={!nextId} onClick={() => go(nextId)}>
          <ChevronDownIcon />
        </IconButton>
        <IconButton label={panelOpen ? "Hide details" : "Show details"} pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
          <PanelRightIcon />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The well sits one step darker than the sheet so the pages are the brightest thing on it */}
        <main className={cn("flex min-w-0 flex-1 flex-col overflow-auto bg-sidebar-panel", panelOpen && "rounded-tr-lg")}>
          {paper.pdf ? <ReaderPlaceholder paper={paper} /> : <NoPdf paper={paper} />}
        </main>
        {panelOpen && <DetailsPanel paper={paper} tab={tab} onTabChange={setTab} />}
      </div>
    </div>
  )
}

function DetailsPanel({ paper, tab, onTabChange }: { paper: Paper; tab: PanelTab; onTabChange: (t: PanelTab) => void }) {
  const navigate = useNavigate()
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")

  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto px-6 pt-2.5 pb-10">
      <h1 className="text-lg leading-snug font-medium text-balance">{paper.title}</h1>
      <p className="mt-2 text-[13px] leading-normal text-muted-foreground">
        {paper.authors.join(", ") || "Unknown authors"}
        {published && (
          <>
            <br />
            {published}
          </>
        )}
      </p>
      <div className="mt-3 -ml-2.5 flex items-center gap-0.5">
        <StatusMenu value={paper.status} onChange={(s) => setStatus([paper.id], s)} align="start" />
        <StarButton starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <PaperDropdownContent ids={[paper.id]} align="start" afterRemove={() => navigate("/library")} />
        </DropdownMenu>
      </div>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PanelTab)} className="mt-5 gap-4">
        <TabsList variant="line" className="-ml-1.5">
          <TabsTrigger value="notes" className="px-1.5">Notes</TabsTrigger>
          <TabsTrigger value="highlights" className="px-1.5">Highlights</TabsTrigger>
          <TabsTrigger value="about" className="px-1.5">About</TabsTrigger>
        </TabsList>
        <TabsContent value="notes">
          <NoteEditor paperId={paper.id} />
        </TabsContent>
        <TabsContent value="highlights">
          <p className="text-[13px] text-muted-foreground">Select text in the PDF to highlight it. Highlights will be listed here by page.</p>
        </TabsContent>
        <TabsContent value="about">
          <About paper={paper} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function About({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const setTags = useLibraryStore((s) => s.setTags)
  const showTag = useUiStore((s) => s.showTag)
  const links = externalLinks(paper)
  return (
    <div>
      {paper.abstract ? <p className="text-sm leading-relaxed">{paper.abstract}</p> : <p className="text-sm text-muted-foreground">No abstract.</p>}
      <dl className="mt-5 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-3 text-[13px]">
        <dt className="text-muted-foreground">Tags</dt>
        <dd>
          <TagsEditor
            tags={paper.tags}
            onChange={(tags) => setTags(paper.id, tags)}
            onOpenTag={(t) => {
              showTag(t)
              navigate("/library")
            }}
          />
        </dd>
        {links.map((l) => (
          <div key={l.href} className="contents">
            <dt className="text-muted-foreground">{l.label.split(":")[0] === "doi" ? "DOI" : l.label.startsWith("arXiv") ? "arXiv" : "Link"}</dt>
            <dd className="min-w-0 truncate">
              <a href={l.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
                {l.label.replace(/^(doi|arXiv):/, "")}
              </a>
            </dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Added</dt>
        <dd>
          {formatAdded(paper.addedAt)}
          {paper.addedBy === "agent" && " by an agent"}
        </dd>
        <dt className="text-muted-foreground">File</dt>
        <dd className={cn(!paper.pdf && "text-muted-foreground")}>{paper.pdf ? (paper.pdf.pages ? `PDF, ${paper.pdf.pages} pages` : "PDF") : "No PDF"}</dd>
      </dl>
    </div>
  )
}

// Stands in for the EmbedPDF reader until it is ported
function ReaderPlaceholder({ paper }: { paper: Paper }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center">
      <p className="text-[15px] font-medium">The reader comes next</p>
      <p className="text-sm text-muted-foreground">
        Highlights and notes in the PDF arrive with the next phase.
        {paper.lastPage ? ` It will reopen on page ${paper.lastPage}.` : ""}
      </p>
      <Button variant="outline" size="sm" className="mt-2" asChild>
        <a href={paper.pdf?.url} target="_blank" rel="noreferrer">
          <ExternalLinkIcon />
          Open PDF in browser
        </a>
      </Button>
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
      toast.error(e instanceof Error ? e.message : "Could not find a PDF.")
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
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/15 px-14 py-10 text-center transition-colors",
          dragging && "border-foreground/30 bg-muted",
        )}
      >
        <p className="text-[15px] font-medium">No PDF yet</p>
        <p className="max-w-72 text-sm text-muted-foreground">Drop a PDF here, or let owlit look for an open-access copy.</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={fetchPdf} disabled={fetching}>
            {fetching && <Spinner />}
            Find PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
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
      </div>
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
      placeholder="What do you take from this paper? Your note stays with it."
      className="min-h-64 resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:border-0 dark:bg-transparent"
    />
  )
}
