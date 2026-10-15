import { t } from "@lingui/core/macro"
import { useEffect, useMemo } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { ChevronDownIcon, ChevronUpIcon, PanelRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { NotFound, PageHeader } from "@/components/page"
import { IconButton } from "@/components/icon-button"
import { SegmentedControl } from "@/components/segmented-control"
import { useTakeParam } from "@/hooks/use-take-param"
import { reportPaperView } from "@/app/activity"
import { useAgentWindow } from "@/features/agent/store"
import { useDigestState, useWritingDigest } from "../digests"
import { visiblePapers } from "../lib/filter"
import { useReadingVisit } from "../lib/reading"
import { notePathOf } from "../notes/note-actions"
import { showInPaper, usePaperView, usePaperViewOf, type PaperView } from "../paper-view"
import { usePrefsStore } from "../prefs-store"
import { PdfReader } from "../reader/PdfReader"
import { paperById, useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"
import { DetailsPanel } from "./paper/DetailsPanel"
import { NoPdf } from "./paper/NoPdf"
import { Digest } from "./paper/Digest"

// One paper: Owlit's digest of it, or the PDF on a darker well, with details beside it
export function PaperPage() {
  const { paperId = "" } = useParams()
  const navigate = useNavigate()
  const papers = usePapersAtRest()
  const paper = papers[paperId]
  // A paper that moved (a local file given its DOI) still opens from its old link
  const movedTo = useLibraryStore((s) => paperById(s.papers, s.aliases, paperId)?.id)
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
  const only = useLibraryUi((s) => s.only)
  const order = useMemo(() => visiblePapers(papers, { query, filter, tags, sort, only }).map((p) => p.id), [papers, query, filter, tags, sort, only])
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

  // The digest or the PDF (paper-view.ts)
  const writing = useWritingDigest(paperId)
  const digestState = useDigestState(paper ?? NO_PAPER)
  const hasDigest = !!paper?.hasDigest
  const view = usePaperViewOf(paperId, hasDigest, !!paper)
  const showView = (next: PaperView) => usePaperView.getState().setView(paperId, next)
  // Which side is being read, for the reading time core keeps (app/activity.ts)
  const hasPdf = !!paper?.pdf
  useEffect(() => reportPaperView(paperId, view === "pdf" && !hasPdf ? null : view), [paperId, view, hasPdf])
  // A page the digest points at (0-based)
  const showPage = (page: number) => void showInPaper(paperId, { page: page + 1 }).catch(() => undefined)

  // Opened at a quote (a thread's answer that rests on it): go to those words on that page
  useTakeParam(
    "quote",
    (quote, params) => void showInPaper(paperId, { quote, page: Number(params.get("page")) || undefined }).catch(() => undefined),
    { also: ["page"] },
  )

  if (!paper && movedTo && movedTo !== paperId) return <Navigate to={`/library/${movedTo}`} replace />
  if (!paper) return <NotFound title={t`This paper is not in the library`} detail={t`It may have been removed.`} back={{ label: t`Back to library`, to: "/library" }} />

  const go = (id: string | null) => id && navigate(`/library/${id}`, { replace: true })
  // Only once there is a digest, or one on its way, is there anything to choose; a run that broke keeps
  // the switch, so its Retry stays where the user looked for the digest
  const choosing = hasDigest || writing || digestState === "failed"
  // A digest that arrived while the PDF was being read: Owlit's dot on the switch until it is seen
  const views = paperViews().map((v) => (v.value === "digest" && view === "pdf" && digestState === "new" ? { ...v, dot: true } : v))
  const position = idx + 1
  const total = order.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The trail always ends at the paper, as a doc's and a topic's do, though the details panel shows the
          title too: the header is where the page says where you are, and a trail ending at Library read
          as being on the Library, with the digest under it showing no title of its own */}
      <PageHeader trail={[{ label: t`Library`, to: "/library" }]} current={paper.title}>
        {/* The tour's stop on the digest points at the switch */}
        {choosing && <span data-tour="digest-switch" className="contents"><SegmentedControl label={t({ message: "Show", comment: "choice between showing the digest or the PDF" })} value={view} onChange={showView} options={views} className="mr-2" /></span>}
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
        <main data-tour="reader" className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar-panel", (panelOpen || agentDocked) && "rounded-tr-lg")}>
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

const paperViews = (): { value: PaperView; label: string }[] => [
  { value: "digest", label: t({ message: "Digest", comment: "a view of the paper page: Owlit's digest of the paper" }) },
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
