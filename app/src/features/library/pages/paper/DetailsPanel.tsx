import { plural, t } from "@lingui/core/macro"
import { nameOf, useMe } from "@/lib/actors"
import { MentionToken } from "@/components/mention/mention-token"
import { useThreadsStore } from "@/features/threads/store"
import { threadsByPaper } from "@/features/threads/lib"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ago } from "@/lib/time"
import { cn } from "@/lib/utils"
import { FoldButton } from "@/components/fold"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CopyAllHighlights, HighlightsList } from "../../components/HighlightsList"
import { PaperByline, PaperQuickActions } from "../../components/PaperByline"
import { TagsEditor } from "../../components/TagsEditor"
import { externalLinks, type ExternalLink } from "../../lib/format"
import { linkedPaperIds } from "../../lib/cite"
import { stripLatex } from "../../lib/latex"
import { useHighlightCount } from "../../lib/use-highlights"
import { NoteChanges } from "../../notes/NoteChanges"
import { NoteEditor } from "../../notes/NoteEditor"
import { addHighlightToNote } from "../../notes/note-actions"
import { PANEL_DEFAULT, PANEL_MIN, usePrefsStore, type PanelTab } from "../../prefs-store"
import { useLibraryStore } from "../../store"
import { docUri, paperUri, type Highlight, type Paper } from "@owlit/protocol"
import { useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { mentionRoute } from "@/features/docs/lib/mentions"
import { isDesktop, rpc } from "@/lib/rpc"
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
        <CopyOf paper={paper} />
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
              <TabsTrigger value="about" className="px-1.5">{t({ message: "About", comment: "tab: a paper's abstract and details" })}</TabsTrigger>
            </TabsList>
            {tab === "highlights" && <CopyAllHighlights paperId={paper.id} />}
          </div>
          <TabsContent value="notes" className="flex flex-col">
            <NoteChanges key={paper.id} paperId={paper.id} />
            <NoteEditor paperId={paper.id} />
          </TabsContent>
          <TabsContent value="highlights">
            <HighlightsList paperId={paper.id} hasPdf={!!paper.pdf} onAddToNote={addToNote} />
          </TabsContent>
          <TabsContent value="about">
            <About paper={paper} />
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  )
}

// A paper core found to be a copy of another (copyOf), kept apart because the person worked with this one.
// The line links the other paper; a Merge that moves this one's star, tags, highlights and note onto it
// isn't built, so the person compares and removes one by hand.
function CopyOf({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const other = useLibraryStore((s) => (paper.copyOf ? s.papers[paper.copyOf] : undefined))
  if (!other) return null
  return (
    <p className="mt-2 text-detail text-muted-foreground">
      {t({ message: "This looks like the same paper as", comment: "followed by a link to the other paper in the library" })}{" "}
      <MentionToken label={other.title} onClick={() => navigate(`/library/${other.id}`)} />
    </p>
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
  const viewer = useMe()
  const who = nameOf(paper.addedBy)
  const pages = paper.pdf?.pages
  const threads = useThreadsStore((s) => s.threads)
  const aliases = useLibraryStore((s) => s.aliases)
  const inThreads = useMemo(() => threadsByPaper(threads, { [paper.id]: paper }, aliases).get(paper.id) ?? [], [threads, paper, aliases])
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
        <dd>{paper.addedBy === viewer ? when : t({ message: `${when} by ${who}`, comment: "when a paper was added, and who added it: Owlit, a name or outside owlit" })}</dd>
        {inThreads.length > 0 && (
          <>
            <dt className="text-muted-foreground">{t({ message: "In threads", comment: "label before the threads that hold this paper" })}</dt>
            {/* Each thread with what it says about this paper, so reading the paper shows Owlit's take on
                it without going there */}
            <dd className="flex min-w-0 flex-col gap-2.5">
              {inThreads.map((c) => (
                <div key={c.id}>
                  <MentionToken label={c.title} onClick={() => navigate(`/threads/${c.id}?paper=${encodeURIComponent(paper.id)}`)} />
                  {c.lines.map((l, i) => (
                    <p key={i} className="mt-0.5 line-clamp-2 leading-normal text-muted-foreground">
                      {l.label && <span className="text-foreground/80">{l.label}: </span>}
                      {l.text}
                    </p>
                  ))}
                </div>
              ))}
            </dd>
          </>
        )}
        <CitedIn paper={paper} />
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

// The docs that link to this paper, from the search index's links (an old id of the paper included), so
// reading a paper shows where the person's writing leans on it. Asked again when the paper changes;
// the browser preview has no index and reads its mock docs.
function CitedIn({ paper }: { paper: Paper }) {
  const navigate = useNavigate()
  const [paths, setPaths] = useState<string[]>([])
  const docs = useDocsStore((s) => s.files)
  useEffect(() => {
    let live = true
    const found = isDesktop
      ? rpc.links.to({ uri: paperUri(paper.id) }).then((links) => links.filter((l) => l.source === "doc").map((l) => l.key))
      : Promise.resolve(Object.values(useDocsStore.getState().files).filter((f) => linkedPaperIds(f.content ?? "").includes(paper.id)).map((f) => f.path))
    found.then(
      (next) => live && setPaths(next.sort((a, b) => a.localeCompare(b))),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [paper])
  // Only docs still there, as the docs list names them
  const shown = paths.filter((path) => Object.values(docs).some((f) => f.path === path))
  if (!shown.length) return null
  return (
    <>
      <dt className="text-muted-foreground">{t({ message: "Cited in", comment: "label before the docs that cite this paper" })}</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
        {shown.map((path) => (
          <MentionToken
            key={path}
            label={displayName(path)}
            onClick={() => {
              const route = mentionRoute(docUri(path))
              if (route) navigate(route)
            }}
          />
        ))}
      </dd>
    </>
  )
}

// The abstract. With a digest on the page, the note says more, so the abstract folds to its first
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
