import { plural, t } from "@lingui/core/macro"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ago } from "@/lib/time"
import { cn } from "@/lib/utils"
import { FoldButton } from "@/components/fold"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { KnowledgeTab, KnowledgeTabLabel } from "@/features/knowledge/paper/KnowledgeTab"
import { CopyAllHighlights, HighlightsList } from "../../components/HighlightsList"
import { PaperByline, PaperQuickActions } from "../../components/PaperByline"
import { TagsEditor } from "../../components/TagsEditor"
import { externalLinks, type ExternalLink } from "../../lib/format"
import { stripLatex } from "../../lib/latex"
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
      label={t`Resize details`}
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
              <TabsTrigger value="notes" className="px-1.5">{t({ message: "Notes", comment: "tab: the user's notes on a paper" })}</TabsTrigger>
              <TabsTrigger value="highlights" className="px-1.5">
                {t({ message: "Highlights", comment: "tab: the passages highlighted in a paper" })}
                {highlightCount > 0 && <span className="font-normal text-muted-foreground tabular-nums">{highlightCount}</span>}
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="px-1.5">
                <KnowledgeTabLabel paper={paper} />
              </TabsTrigger>
              <TabsTrigger value="about" className="px-1.5">{t({ message: "About", comment: "tab: a paper's abstract and details" })}</TabsTrigger>
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

// DOI and arXiv are names; only a plain link is a word
const linkName = (kind: ExternalLink["kind"]) => (kind === "doi" ? "DOI" : kind === "arxiv" ? "arXiv" : t({ message: "Link", comment: "noun: a web link to the paper" }))

function About({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const setTags = useLibraryStore((s) => s.setTags)
  const showTag = useLibraryUi((s) => s.showTag)
  const links = externalLinks(paper)
  const when = ago(paper.addedAt)
  const pages = paper.pdf?.pages
  return (
    <div>
      {paper.abstract ? <Abstract text={stripLatex(paper.abstract)} folded={!!paper.hasDigest} /> : <p className="text-sm text-muted-foreground">{t`No abstract.`}</p>}
      <dl className="mt-5 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-3 text-detail">
        <dt className="text-muted-foreground">{t`Tags`}</dt>
        <dd>
          <TagsEditor
            tags={paper.tags}
            onChange={(tags) => setTags(paper.id, tags)}
            onOpenTag={(tag) => {
              showTag(tag)
              navigate("/library")
            }}
          />
        </dd>
        {links.map((l) => (
          <div key={l.href} className="contents">
            <dt className="text-muted-foreground">{linkName(l.kind)}</dt>
            <dd className="min-w-0 truncate">
              <a href={l.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
                {l.value}
              </a>
            </dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t({ message: "Added", context: "when the paper was added to the library" })}</dt>
        <dd>{paper.addedBy === "agent" ? t`${when} by Owlit` : when}</dd>
        <dt className="text-muted-foreground">{t({ message: "File", comment: "the paper's PDF file" })}</dt>
        <dd className={cn(!paper.pdf && "text-muted-foreground")}>{paper.pdf ? (pages ? plural(pages, { one: "PDF, # page", other: "PDF, # pages" }) : "PDF") : t`No PDF`}</dd>
        {paper.text && (
          <>
            <dt className="text-muted-foreground">{t({ message: "Text", comment: "how much of the paper's text owlit has read" })}</dt>
            <dd className={cn(paper.text === "basic" && "text-muted-foreground")}>{paper.text === "full" ? t({ message: "Full", comment: "the paper's text: read in full" }) : t({ message: "Basic", comment: "the paper's text: read plainly, without layout" })}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

// The abstract. With a reading note on the page, the note says more, so the abstract folds to its first
// lines until asked for.
function Abstract({ text, folded }: { text: string; folded: boolean }) {
  const [open, setOpen] = useState(false)
  const shut = folded && !open
  return (
    <div>
      <p className={cn("text-sm leading-relaxed whitespace-pre-line", shut && "line-clamp-4")}>{text}</p>
      {folded && (
        <FoldButton open={open} onClick={() => setOpen(!open)} className="mt-1">
          {open ? t`Show less` : t`Show more`}
        </FoldButton>
      )}
    </div>
  )
}
