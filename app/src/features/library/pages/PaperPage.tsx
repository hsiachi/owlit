import { t } from "@lingui/core/macro"
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
import { visiblePapers } from "../lib/filter"
import { useReadingVisit } from "../lib/reading"
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
import { ReadingNote, useWritingNote } from "./paper/ReadingNote"

// One paper: its reading note, or the PDF on a darker well, with details beside it
export function PaperPage() {
  const { paperId = "" } = useParams()
  const navigate = useNavigate()
  const papers = usePapersAtRest()
  const paper = papers[paperId]
  // A paper that moved (a local file given its DOI) still opens from its old link
  const movedTo = useLibraryStore((s) => (s.papers[paperId] ? undefined : s.aliases[paperId]))
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

  // The list's keyboard cursor follows the paper opened, so ↑↓ carry on from here after going back, but
  // nothing is shown as selected
  useEffect(() => {
    if (!paper) return
    useLibraryUi.getState().placeCursor(paper.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])
  // Opening a paper isn't reading it: it turns Reading once the person has read in it (lib/reading.ts)
  useReadingVisit(paperId, !!paper?.pdf)

  // Closing a paper is when Owlit takes in what was found in it
  useEffect(() => {
    const id = paperId
    return () => paperClosed(id)
  }, [paperId])

  // The reading note or the PDF. A paper with a note opens on it, since most of the time the note is
  // enough; the choice holds until the next paper.
  const writing = useWritingNote(paperId)
  const [chosen, setChosen] = useState<{ paperId: string; view: PaperView } | null>(null)
  const hasNote = !!paper?.hasDigest
  const view: PaperView = chosen?.paperId === paperId ? chosen.view : hasNote ? "note" : "pdf"
  const showView = (next: PaperView) => setChosen({ paperId, view: next })
  // Settled when the paper opens: a note that arrives while the PDF is being read doesn't take its place
  // (once the library has the paper: after a reload it arrives a moment later)
  const known = !!paper
  useEffect(() => {
    if (known) setChosen((c) => (c?.paperId === paperId ? c : { paperId, view: hasNote ? "note" : "pdf" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, known])
  // The PDF stays loaded under the note, so going to a page is the reader's own jump
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
  if (!paper) return <NotFound title={t`This paper is not in the library`} detail={t`It may have been removed.`} back={{ label: t`Back to library`, to: "/library" }} />

  const go = (id: string | null) => id && navigate(`/library/${id}`, { replace: true })
  // Only once there is a note, or one on its way, is there anything to choose
  const choosing = hasNote || writing
  const position = idx + 1
  const total = order.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* With the details open the title is right there in the panel, so the trail stops at Library */}
      <PageHeader trail={[{ label: t`Library`, to: "/library" }]} current={panelOpen ? undefined : paper.title}>
        {choosing && <SegmentedControl label={t({ message: "Show", comment: "choice between showing the reading note or the PDF" })} value={view} onChange={showView} options={views()} className="mr-2" />}
        {idx >= 0 && (
          <span className="mr-1 text-xs text-muted-foreground tabular-nums">
            {t`${position} of ${total}`}
          </span>
        )}
        <IconButton label={t`Previous paper`} disabled={!prevId} onClick={() => go(prevId)}>
          <ChevronUpIcon />
        </IconButton>
        <IconButton label={t`Next paper`} disabled={!nextId} onClick={() => go(nextId)}>
          <ChevronDownIcon />
        </IconButton>
        <IconButton label={panelOpen ? t`Hide details` : t`Show details`} aria-pressed={panelOpen} onClick={togglePanel}>
          <PanelRightIcon />
        </IconButton>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* The well sits one step darker than the sheet so the pages are the brightest thing on it */}
        <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar-panel", (panelOpen || agentDocked) && "rounded-tr-lg")}>
          {/* Its own stacking context, so the reader's floating pills stay under the note, and out of
              reach while the note covers it */}
          <div className="isolate flex min-h-0 flex-1 flex-col" inert={choosing && view === "note"}>
            {paper.pdf ? <PdfReader paper={paper} /> : <NoPdf key={paper.id} paper={paper} />}
          </div>
          {/* Over the reader rather than instead of it: the PDF keeps its place, and a jump to a page
              doesn't wait for it to load again */}
          {choosing && view === "note" && (
            <div className="absolute inset-0 z-10">
              <ReadingNote paper={paper} onShowPage={showPage} />
            </div>
          )}
        </main>
        {panelOpen && <DetailsPanel paper={paper} />}
      </div>
    </div>
  )
}

type PaperView = "note" | "pdf"
const views = (): { value: PaperView; label: string }[] => [
  { value: "note", label: t`Reading note` },
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
