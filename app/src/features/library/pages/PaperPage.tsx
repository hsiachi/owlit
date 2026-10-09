import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, EllipsisVerticalIcon, PanelRightIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CopyAllHighlights, HighlightsList, useHighlightCount } from "../components/HighlightsList"
import { PaperDropdownContent } from "../components/PaperMenu"
import { StarButton } from "../components/StarButton"
import { StatusMenu } from "../components/StatusMenu"
import { TagsEditor } from "../components/TagsEditor"
import { externalLinks, formatAdded } from "../lib/format"
import { visiblePapers } from "../lib/filter"
import { PANEL_DEFAULT, PANEL_MIN, usePrefsStore, type PanelTab } from "../prefs-store"
import { NoteEditor } from "../notes/NoteEditor"
import { addHighlightToNote } from "../notes/note-actions"
import { PdfReader } from "../reader/PdfReader"
import { libraryClient, useLibraryStore } from "../store"
import type { Highlight, Paper } from "../types"
import { useUiStore } from "../ui-store"
import { useAgentWindow } from "@/features/agent/store"
import { KnowledgeTab, KnowledgeTabLabel } from "@/features/knowledge/paper/KnowledgeTab"
import { paperClosed } from "@/features/knowledge/runner"
import { useKnowledgeStore } from "@/features/knowledge/store"
import { useReaderStore } from "../reader/reader-store"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"

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
  const prefersPanel = usePrefsStore((s) => s.panelOpen)
  const setPanelOpen = usePrefsStore((s) => s.setPanelOpen)
  // The right side holds one panel at a time: a docked agent window takes the details panel's place
  const agentDocked = useAgentWindow((s) => s.stage === "open")
  const panelOpen = prefersPanel && !agentDocked
  const togglePanel = () => {
    if (agentDocked) {
      useAgentWindow.getState().close()
      setPanelOpen(true)
    } else setPanelOpen(!prefersPanel)
  }

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

  // Closing a paper is when Owlit takes in what was found in it
  useEffect(() => {
    const id = paperId
    return () => paperClosed(id)
  }, [paperId])

  // Opened from a passage link (a topic line's "§2"): go to the passage once the reader is ready
  const [params, setParams] = useSearchParams()
  const passageId = params.get("passage")
  useEffect(() => {
    if (!passageId) return
    const passage = useKnowledgeStore.getState().paper(paperId).passages[passageId]
    setParams({}, { replace: true })
    if (!passage) return
    const { api } = useReaderStore.getState()
    if (api) void api.showPassage(passage, "jump").then((ok) => ok || useReaderStore.setState({ pendingPassage: passage }))
    else useReaderStore.setState({ pendingPassage: passage })
  }, [paperId, passageId, setParams])

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
          {/* With the details open the title is right there in the panel, so the trail stops at Library */}
          {!panelOpen && (
            <>
              <ChevronRightIcon className="size-3.5 shrink-0" />
              <span className="truncate text-foreground">{paper.title}</span>
            </>
          )}
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
        <IconButton label={panelOpen ? "Hide details" : "Show details"} pressed={panelOpen} onClick={togglePanel}>
          <PanelRightIcon />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The well sits one step darker than the sheet so the pages are the brightest thing on it */}
        <main className={cn("flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar-panel", (panelOpen || agentDocked) && "rounded-tr-lg")}>
          {paper.pdf ? <PdfReader paper={paper} /> : <NoPdf paper={paper} />}
        </main>
        {panelOpen && (
          <>
            <ResizeHandle />
            <DetailsPanel paper={paper} />
          </>
        )}
      </div>
    </div>
  )
}

// Drag the panel's left edge to widen it for writing; double-click puts it back
function ResizeHandle() {
  const width = usePrefsStore((s) => s.panelWidth)
  const setWidth = usePrefsStore((s) => s.setPanelWidth)
  const start = useRef<{ x: number; width: number; max: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details"
      aria-valuenow={width}
      className="group/resize relative z-10 w-0 cursor-col-resize"
      onPointerDown={(e) => {
        const row = e.currentTarget.parentElement
        if (!row) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width, max: Math.max(PANEL_MIN, row.clientWidth / 2) }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        setWidth(Math.round(Math.min(s.max, Math.max(PANEL_MIN, s.width + s.x - e.clientX))))
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => setWidth(PANEL_DEFAULT)}
    >
      <div className="absolute inset-y-0 -left-1 w-2" />
      <div className="absolute inset-y-0 -left-px w-0.5 bg-transparent transition-colors group-hover/resize:bg-border group-active/resize:bg-foreground/20" />
    </div>
  )
}

function DetailsPanel({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const width = usePrefsStore((s) => s.panelWidth)
  const tab = usePrefsStore((s) => s.panelTab)
  const setTab = usePrefsStore((s) => s.setPanelTab)
  const highlightCount = useHighlightCount(paper.id)
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")

  const addToNote = (h: Highlight) => {
    addHighlightToNote(h)
    setTab("notes")
  }

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col overflow-y-auto px-6 pt-2.5 pb-4">
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="mt-5 flex-1 gap-4">
        <div className="flex items-center justify-between">
          <TabsList variant="line" className="-ml-1.5">
            <TabsTrigger value="notes" className="px-1.5">Notes</TabsTrigger>
            <TabsTrigger value="highlights" className="px-1.5">
              Highlights
              {highlightCount > 0 && <span className="font-normal text-muted-foreground tabular-nums">{highlightCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="px-1.5">
              <KnowledgeTabLabel paper={paper} />
            </TabsTrigger>
            <TabsTrigger value="about" className="px-1.5">About</TabsTrigger>
          </TabsList>
          {tab === "highlights" && <CopyAllHighlights paperId={paper.id} />}
        </div>
        <TabsContent value="notes" className="flex flex-col">
          <NoteEditor paperId={paper.id} />
        </TabsContent>
        <TabsContent value="highlights">
          <HighlightsList paperId={paper.id} onAddToNote={addToNote} />
        </TabsContent>
        <TabsContent value="knowledge">
          <KnowledgeTab key={paper.id} paper={paper} />
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

function NoPdf({ paper }: { paper: Paper }) {
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [fetching, setFetching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // A paper.pdf task core is running for this paper (on add, or a daily retry)
  const looking = useTasksStore((s) => openTasksFor(s, paper.id).some((t) => t.kind === "paper.pdf")) || fetching

  const attach = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const pdf = await libraryClient.attachPdf(paper, file)
      updatePaper(paper.id, { pdf, noPdf: undefined })
      toast("PDF attached", { description: file.name })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't attach that file.")
    }
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

  const title = looking ? "Looking for a PDF…" : paper.noPdf ? "No PDF found" : "No PDF yet"
  const body = looking
    ? "If you already have it, drop it here."
    : paper.noPdf
      ? `${triedSentence(paper.noPdf.tried)} Drop a PDF here if you have it.`
      : "Drop a PDF here, or let owlit look for an open-access copy."

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
        void attach(e.dataTransfer.files)
      }}
    >
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-foreground/15 px-14 py-10 text-center transition-colors",
          dragging && "border-foreground/30 bg-muted",
        )}
      >
        <p className="flex items-center gap-2 text-[15px] font-medium">
          {looking && <Spinner />}
          {title}
        </p>
        <p className="max-w-72 text-sm text-muted-foreground">{body}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={fetchPdf} disabled={looking}>
            {paper.noPdf ? "Try again" : "Find PDF"}
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
            void attach(e.target.files)
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}

// "Tried arXiv, Unpaywall and the publisher." from acquisition route names
function triedSentence(routes: string[]) {
  const nameOf = (r: string) =>
    r === "arxiv" ? "arXiv" : r.startsWith("publisher") ? "the publisher" : r.startsWith("unpaywall") ? "Unpaywall" : r === "open-access" ? "open-access links" : ""
  const names = [...new Set(routes.map(nameOf))].filter(Boolean)
  if (!names.length) return "owlit knows of no open copy of this paper."
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
  return `Tried ${list}.`
}
