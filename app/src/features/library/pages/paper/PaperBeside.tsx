import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Maximize2Icon, XIcon } from "lucide-react"
import type { Paper } from "@owlit/protocol"
import { EditorSelection } from "@codemirror/state"
import { reportPaperView } from "@/app/activity"
import { IconButton } from "@/components/icon-button"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { SegmentedControl } from "@/components/segmented-control"
import { useBeside } from "@/features/agent/beside"
import { PAGE_MIN, PANEL_WIDTH, useAgentWindow } from "@/features/agent/store"
import { openEditor } from "@/features/docs/editors"
import { shortTitle } from "@/features/threads/lib"
import { useDigestState, useWritingDigest } from "../../digests"
import { citationLabel } from "../../lib/format"
import { useReadingVisit } from "../../lib/reading"
import { paperViews, showInPaper, usePaperView, usePaperViewOf, type PaperView } from "../../paper-view"
import { PdfReader } from "../../reader/PdfReader"
import { paperById, useLibraryStore } from "../../store"
import { Digest } from "./Digest"
import { NoPdf } from "./NoPdf"

// A paper opened beside the doc a citation of it is in, in the slot the agent panel docks to, or between
// the doc and the docked panel on a window wide enough for both (withPanel): the paper's own reader with its header line (the paper, the page, Digest | PDF, its full page, close), at
// the cited sentence. The note and the details stay on the paper's page: the doc is where the person is
// writing. Esc puts it away and the cursor back at the citation.
export function PaperBesideSlot({ withPanel }: { withPanel: boolean }) {
  const beside = useBeside((s) => s.paper)
  const paper = usePaperAtRest(beside?.paperId)
  if (!beside || !paper) return null
  return <Beside key={paper.id} paper={paper} withPanel={withPanel} />
}

function Beside({ paper, withPanel }: { paper: Paper; withPanel: boolean }) {
  const navigate = useNavigate()
  const beside = useBeside((s) => s.paper)
  const panelWidth = useAgentWindow((s) => s.panelWidth)
  const setPanelWidth = useAgentWindow((s) => s.setPanelWidth)
  const ownWidth = useBeside((s) => s.width)
  const setOwnWidth = useBeside((s) => s.setWidth)
  const aside = useRef<HTMLElement>(null)
  const page = useLibraryStore((s) => s.papers[paper.id]?.position?.page)
  useReadingVisit(paper.id, true)

  const writing = useWritingDigest(paper.id)
  const digestState = useDigestState(paper)
  const view = usePaperViewOf(paper.id, paper, digestState === "new")
  const showView = (next: PaperView) => usePaperView.getState().setView(paper.id, next)
  const hasPdf = !!paper.pdf
  useEffect(() => reportPaperView(paper.id, view === "pdf" && !hasPdf ? null : view), [paper.id, view, hasPdf])
  const choosing = !!paper.hasDigest || writing || digestState === "failed" || hasPdf || !!paper.text

  // At the cited sentence, ringed, or its page; again for each citation of this paper clicked while it is open
  const place = beside && { page: beside.page, quote: beside.quote }
  useEffect(() => {
    if (place && (place.page || place.quote)) void showInPaper(paper.id, place).catch(() => undefined)
    // It takes focus as the agent panel does, so Esc reaches it
    aside.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beside])

  const close = () => {
    const from = useBeside.getState().paper?.from
    useBeside.getState().close()
    const view = from && openEditor(from.docId)
    if (!view || from.pos > view.state.doc.length) return
    view.focus()
    view.dispatch({ selection: EditorSelection.cursor(from.pos), scrollIntoView: false })
  }
  const title = [citationLabel(paper), shortTitle(paper.title)].join(" · ")
  const pages = paper.pdf?.pages

  return (
    <aside
      ref={aside}
      tabIndex={-1}
      className="relative flex shrink-0 flex-col border-l-[0.5px] bg-sidebar-panel outline-none"
      // Alone, as wide as the agent panel it takes the place of, and narrowed the same way by a narrow
      // window. Beside the panel, its own width, narrowed first when the window leaves the doc less than
      // PAGE_MIN, so the chat keeps the width it was given.
      style={{
        width: withPanel
          ? `clamp(320px, ${ownWidth}px, max(320px, calc(100vw - ${PAGE_MIN + panelWidth}px)))`
          : `clamp(320px, ${panelWidth}px, max(320px, calc(100vw - ${PAGE_MIN}px)))`,
      }}
      aria-label={paper.title}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return
        e.preventDefault()
        close()
      }}
    >
      {withPanel ? (
        <PanelResizeHandle label={t`Resize the paper`} width={ownWidth} setWidth={setOwnWidth} max={() => window.innerWidth - PAGE_MIN - panelWidth} defaultWidth={PANEL_WIDTH} />
      ) : (
        <PanelResizeHandle label={t`Resize the paper`} width={panelWidth} setWidth={setPanelWidth} defaultWidth={PANEL_WIDTH} />
      )}
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b-[0.5px] pr-2 pl-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium" title={paper.title}>
          {title}
        </span>
        {page && view === "pdf" && hasPdf && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{pages ? t`p. ${page} of ${pages}` : t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>
        )}
        {choosing && <SegmentedControl label={t({ message: "Show", comment: "choice between showing the digest or the PDF" })} value={view} onChange={showView} options={paperViews()} />}
        <IconButton
          label={t`Open the paper's page`}
          onClick={() => {
            useBeside.getState().close()
            navigate(`/library/${paper.id}`)
          }}
        >
          <Maximize2Icon />
        </IconButton>
        <IconButton label={t({ message: "Close", comment: "verb: close the paper beside the doc" })} onClick={close}>
          <XIcon />
        </IconButton>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="isolate flex min-h-0 flex-1 flex-col" inert={choosing && view === "digest"}>
          {hasPdf ? <PdfReader paper={paper} /> : <NoPdf key={paper.id} paper={paper} />}
        </div>
        {choosing && view === "digest" && (
          <div className="absolute inset-0 z-10">
            <Digest paper={paper} onShowPage={(p) => void showInPaper(paper.id, { page: p + 1 }).catch(() => undefined)} />
          </div>
        )}
      </div>
    </aside>
  )
}

// The paper, kept as it was while only its reading positions move: the reader saves its place at every
// scroll pause, and nothing here but the page number follows it
function usePaperAtRest(id: string | undefined): Paper | undefined {
  return useLibraryStore(useMemo(() => paperAtRest(id), [id]))
}

function paperAtRest(id: string | undefined) {
  let kept: Paper | undefined
  return (s: { papers: Record<string, Paper>; aliases: Record<string, string> }) => {
    const next = id ? paperById(s.papers, s.aliases, id) : undefined
    if (!next || !kept || next.id !== kept.id || !onlyPositionMoved(next, kept)) kept = next
    return kept
  }
}

function onlyPositionMoved(a: Paper, b: Paper) {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Paper)[])
  keys.delete("position")
  keys.delete("digestPosition")
  return [...keys].every((k) => a[k] === b[k])
}
