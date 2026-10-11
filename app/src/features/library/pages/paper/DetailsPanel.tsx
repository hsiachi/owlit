import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ago } from "@/lib/time"
import { cn } from "@/lib/utils"
import { rpc } from "@/lib/rpc"
import { GroupLabel } from "@/components/group-label"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { KnowledgeTab, KnowledgeTabLabel } from "@/features/knowledge/paper/KnowledgeTab"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"
import { CopyAllHighlights, HighlightsList } from "../../components/HighlightsList"
import { PaperByline, PaperQuickActions } from "../../components/PaperByline"
import { TagsEditor } from "../../components/TagsEditor"
import { externalLinks, type ExternalLink } from "../../lib/format"
import { useHighlightCount } from "../../lib/use-highlights"
import { NoteEditor } from "../../notes/NoteEditor"
import { addHighlightToNote } from "../../notes/note-actions"
import { PANEL_DEFAULT, PANEL_MIN, usePrefsStore, type PanelTab } from "../../prefs-store"
import { useLibraryStore } from "../../store"
import type { Highlight, Paper } from "../../types"
import { useLibraryUi } from "../../ui-store"

// Drag the panel's left edge to widen it for writing (up to half the row); double-click puts it back
function ResizeHandle() {
  const width = usePrefsStore((s) => s.panelWidth)
  const setWidth = usePrefsStore((s) => s.setPanelWidth)
  return (
    <PanelResizeHandle
      label="Resize details"
      width={width}
      setWidth={setWidth}
      min={PANEL_MIN}
      max={(panel) => Math.max(PANEL_MIN, panel.parentElement!.clientWidth / 2)}
      defaultWidth={PANEL_DEFAULT}
    />
  )
}

export function DetailsPanel({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const width = usePrefsStore((s) => s.panelWidth)
  const tab = usePrefsStore((s) => s.panelTab)
  const setTab = usePrefsStore((s) => s.setPanelTab)
  const highlightCount = useHighlightCount(paper.id)

  const addToNote = (h: Highlight) => {
    addHighlightToNote(h)
    setTab("notes")
  }

  return (
    // The resize edge sits on this box rather than on the panel, which scrolls and would carry it along
    <div className="relative flex shrink-0">
      <ResizeHandle />
      <aside style={{ width }} className="flex shrink-0 flex-col overflow-y-auto px-6 pt-2.5 pb-4">
        <h1 className="text-lg leading-snug font-medium text-balance">{paper.title}</h1>
        <PaperByline paper={paper} className="mt-2" />
        <div className="mt-3 -ml-2.5 flex items-center gap-0.5">
          <PaperQuickActions paper={paper} align="start" afterRemove={() => navigate("/library")} />
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
    </div>
  )
}

const LINK_NAMES: Record<ExternalLink["kind"], string> = { doi: "DOI", arxiv: "arXiv", url: "Link" }

function About({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const setTags = useLibraryStore((s) => s.setTags)
  const showTag = useLibraryUi((s) => s.showTag)
  const links = externalLinks(paper)
  return (
    <div>
      {paper.abstract ? <p className="text-sm leading-relaxed">{paper.abstract}</p> : <p className="text-sm text-muted-foreground">No abstract.</p>}
      <Digest paper={paper} />
      <dl className="mt-5 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-3 text-detail">
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
            <dt className="text-muted-foreground">{LINK_NAMES[l.kind]}</dt>
            <dd className="min-w-0 truncate">
              <a href={l.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
                {l.value}
              </a>
            </dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Added</dt>
        <dd>
          {ago(paper.addedAt)}
          {paper.addedBy === "agent" && " by an agent"}
        </dd>
        <dt className="text-muted-foreground">File</dt>
        <dd className={cn(!paper.pdf && "text-muted-foreground")}>{paper.pdf ? (paper.pdf.pages ? `PDF, ${paper.pdf.pages} pages` : "PDF") : "No PDF"}</dd>
        {paper.text && (
          <>
            <dt className="text-muted-foreground">Text</dt>
            <dd className={cn(paper.text === "basic" && "text-muted-foreground")}>{paper.text === "full" ? "Full" : "Basic"}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

// Reading notes an agent wrote for the paper (digest.md), or that one is being written. Here for now;
// its place is the interface's to settle.
function Digest({ paper }: { paper: Paper }) {
  const [text, setText] = useState<string | null>(null)
  const writing = useTasksStore((s) => openTasksFor(s, paper.id).some((t) => t.kind === "paper.digest"))
  useEffect(() => {
    if (!paper.hasDigest) return
    let live = true
    rpc.library
      .digest({ id: paper.id })
      .then((t) => live && setText(t))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [paper.id, paper.hasDigest])
  // A note fetched for a paper that has since lost it isn't shown
  const shown = paper.hasDigest ? text : null
  if (!shown && !writing) return null
  return (
    <section className="mt-5">
      <GroupLabel as="h3" flush>
        Digest
      </GroupLabel>
      {shown ? (
        <Markdown text={shown} className="text-sm" />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Owlit is writing a reading note…
        </p>
      )}
    </section>
  )
}
