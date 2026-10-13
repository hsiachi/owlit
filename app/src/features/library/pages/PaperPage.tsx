import { useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { ChevronDownIcon, ChevronUpIcon, PanelRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { NotFound, PageHeader } from "@/components/page"
import { IconButton } from "@/components/icon-button"
import { SegmentedControl } from "@/components/segmented-control"
import { useAgentWindow } from "@/features/agent/store"
import { paperClosed } from "@/features/knowledge/runner"
import { useKnowledgeStore } from "@/features/knowledge/store"
import { useDigestState } from "../digests"
import { visiblePapers } from "../lib/filter"
import { useTakeParam } from "../lib/use-take-param"
import { notePathOf } from "../notes/note-actions"
import { usePrefsStore } from "../prefs-store"
import { PdfReader } from "../reader/PdfReader"
import { useReaderStore, whenReaderReady } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"
import { DetailsPanel } from "./paper/DetailsPanel"
import { NoPdf } from "./paper/NoPdf"
import { Digest, useWritingDigest } from "./paper/Digest"

// One paper: Owlit's digest of it, or the PDF on a darker well, with details beside it
export function PaperPage() {
  const { paperId = "" } = useParams()
  const navigate = useNavigate()
  const papers = usePapersAtRest()
  const paper = papers[paperId]
  // A paper that moved (a local file given its DOI) still opens from its old link
  const movedTo = useLibraryStore((s) => (s.papers[paperId] ? undefined : s.aliases[paperId]))
  const markOpened = useLibraryStore((s) => s.markOpened)
  const prefersPanel = usePrefsStore((s) => s.panelOpen)
  const setPanelOpen = usePrefsStore((s) => s.setPanelOpen)
  // The right side holds one panel at a time: a docked agent window takes the details panel's place,
  // except for a conversation that started from this paper's note, whose edits land in the note
  const agentDocked = useAgentWindow((s) => s.stage === "open")
  const besideNote = useAgentWindow((s) => s.fromNote === notePathOf(paperId))
  const panelOpen = prefersPanel && (!agentDocked || besideNote)
  const togglePanel = () => {
    if (agentDocked && !besideNote) {
      useAgentWindow.getState().close()
      setPanelOpen(true)
    } else setPanelOpen(!prefersPanel)
  }

  // Previous / next walk All papers as it is currently filtered and sorted
  const query = useLibraryUi((s) => s.query)
  const filter = useLibraryUi((s) => s.filter)
  const tags = useLibraryUi((s) => s.tags)
  const sort = useLibraryUi((s) => s.sort)
  const order = useMemo(() => visiblePapers(papers, { query, filter, tags, sort }).map((p) => p.id), [papers, query, filter, tags, sort])
  const idx = order.indexOf(paperId)
  const prevId = idx > 0 ? order[idx - 1] : null
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null

  // Opening a paper with a PDF counts as starting to read it. The list's keyboard cursor follows so
  // ↑↓ carry on from here after going back, but nothing is shown as selected.
  useEffect(() => {
    if (!paper) return
    useLibraryUi.getState().placeCursor(paper.id)
    if (paper.pdf) markOpened(paper.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])

  // Closing a paper is when Owlit takes in what was found in it
  useEffect(() => {
    const id = paperId
    return () => paperClosed(id)
  }, [paperId])

  // The digest or the PDF. A paper with a digest opens on it, since most of the time the digest is
  // enough; the choice holds until the next paper.
  const writing = useWritingDigest(paperId)
  const digestState = useDigestState(paper ?? NO_PAPER)
  const [chosen, setChosen] = useState<{ paperId: string; view: PaperView } | null>(null)
  const hasDigest = !!paper?.hasDigest
  const view: PaperView = chosen?.paperId === paperId ? chosen.view : hasDigest ? "digest" : "pdf"
  const showView = (next: PaperView) => setChosen({ paperId, view: next })
  // Settled when the paper opens: a digest that arrives while the PDF is being read doesn't take its place
  // (once the library has the paper: after a reload it arrives a moment later)
  const known = !!paper
  useEffect(() => {
    if (known) setChosen((c) => (c?.paperId === paperId ? c : { paperId, view: hasDigest ? "digest" : "pdf" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, known])
  // The PDF stays loaded under the digest, so going to a page is the reader's own jump
  const showPage = (page: number) => {
    showView("pdf")
    void whenReaderReady(paperId).then((api) => api.showPage(page), () => undefined)
  }
  // A jump into the PDF from elsewhere (a highlight in the list, a passage from Knowledge) shows the PDF
  useEffect(
    () =>
      useReaderStore.subscribe((s, prev) => {
        if ((s.flashId && s.flashId !== prev.flashId) || (s.ring?.pulse && s.ring !== prev.ring) || (s.activeId && s.activeId !== prev.activeId)) {
          setChosen({ paperId, view: "pdf" })
        }
      }),
    [paperId],
  )

  // Opened from a passage link (a topic line's "§2"): go to the passage once the reader is ready
  useTakeParam("passage", (passageId) => {
    const passage = useKnowledgeStore.getState().paper(paperId).passages[passageId]
    if (!passage) return
    setChosen({ paperId, view: "pdf" })
    void whenReaderReady(paperId).then((api) => api.showPassage(passage, "jump"), () => undefined)
  })

  if (!paper && movedTo) return <Navigate to={`/library/${movedTo}`} replace />
  if (!paper) return <NotFound title="This paper is not in the library" detail="It may have been removed." back={{ label: "Back to library", to: "/library" }} />

  const go = (id: string | null) => id && navigate(`/library/${id}`, { replace: true })
  // Only once there is a digest, or one on its way, is there anything to choose; a run that broke keeps
  // the switch, so its Retry stays where the user looked for the digest
  const choosing = hasDigest || writing || digestState === "failed"
  // A digest that arrived while the PDF was being read: Owlit's dot on the switch until it is seen
  const views = VIEWS.map((v) => (v.value === "digest" && view === "pdf" && digestState === "new" ? { ...v, dot: true } : v))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The trail always ends at the paper, as a doc's and a topic's do, though the details panel shows the
          title too: the header is where the page says where you are, and a trail ending at Library read
          as being on the Library, with the digest under it showing no title of its own */}
      <PageHeader trail={[{ label: "Library", to: "/library" }]} current={paper.title}>
        {choosing && <SegmentedControl label="Show" value={view} onChange={showView} options={views} className="mr-2" />}
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
        <IconButton label={panelOpen ? "Hide details" : "Show details"} aria-pressed={panelOpen} onClick={togglePanel}>
          <PanelRightIcon />
        </IconButton>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* The well sits one step darker than the sheet so the pages are the brightest thing on it */}
        <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar-panel", (panelOpen || agentDocked) && "rounded-tr-lg")}>
          {/* Its own stacking context, so the reader's floating pills stay under the digest, and out of
              reach while the digest covers it */}
          <div className="isolate flex min-h-0 flex-1 flex-col" inert={choosing && view === "digest"}>
            {paper.pdf ? <PdfReader paper={paper} /> : <NoPdf key={paper.id} paper={paper} />}
          </div>
          {/* Over the reader rather than instead of it: the PDF keeps its place, and a jump to a page
              doesn't wait for it to load again */}
          {choosing && view === "digest" && (
            <div className="absolute inset-0 z-10">
              <Digest paper={paper} onShowPage={showPage} />
            </div>
          )}
        </main>
        {panelOpen && <DetailsPanel paper={paper} />}
      </div>
    </div>
  )
}

// Hooks run before a missing paper's Not found
const NO_PAPER = { id: "", hasDigest: false } as Paper

type PaperView = "digest" | "pdf"
const VIEWS: { value: PaperView; label: string }[] = [
  { value: "digest", label: "Digest" },
  { value: "pdf", label: "PDF" },
]

// All papers, kept as they were while only reading positions move. A position changes at every scroll
// pause and nothing on this page follows it (the reader reads its paper's once, in position.ts), so a
// move neither redraws the page nor sorts the library again for previous / next.
function usePapersAtRest() {
  return useLibraryStore(useMemo(() => papersAtRest(), []))
}

function papersAtRest() {
  let kept: Record<string, Paper> | undefined
  return (s: { papers: Record<string, Paper> }) => {
    if (!kept || !onlyPositionsMoved(s.papers, kept)) kept = s.papers
    return kept
  }
}

function onlyPositionsMoved(next: Record<string, Paper>, prev: Record<string, Paper>) {
  if (next === prev) return true
  const ids = Object.keys(next)
  if (ids.length !== Object.keys(prev).length) return false
  return ids.every((id) => {
    const a = next[id]
    const b = prev[id]
    if (a === b) return true
    if (!b) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Paper)[])
    keys.delete("position")
    return [...keys].every((k) => a[k] === b[k])
  })
}
