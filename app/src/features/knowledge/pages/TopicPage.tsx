import { paperUri } from "@owlit/protocol"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon, MessageSquareIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { FoldButton } from "@/components/fold"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAgentWindow } from "@/features/agent/store"
import { GroupLabel } from "@/components/group-label"
import { Info } from "@/components/info"
import { Dot, NoteDot } from "@/components/marks"
import { MentionLink, MentionToken } from "@/components/mention/mention-token"
import { isHidden } from "@/features/docs/lib/tree"
import { useDocsStore } from "@/features/docs/store"
import { displayName, type WorkspaceFile } from "@/features/docs/types"
import { Refs, SentenceEditor } from "../components/bits"
import { TopicMenuContent } from "../components/TopicMenu"
import { firstWords, isAbstractOnly, paperRef, topicUri, verbOf } from "../format"
import { ringBlock } from "../lib/ring"
import { dayLabel, shortDate } from "@/lib/time"
import { changedSince, editLine, lineKey, provenance, removeLine, renameTopic, useKnowledgeStore, useTopic } from "../store"
import type { Change, Line, Topic, TopicSidecar } from "../types"
import { useKnowledgeUi } from "../ui-store"
import { toastUndo } from "@/lib/toast"

// Hard caps keep a topic to a screen; the renderer folds anything beyond
const MAX_LINES = 7
const MAX_QUESTIONS = 5
// A changed line counts as looked at once it has been on screen this long
const DWELL_MS = 800

export function TopicPage() {
  const { topicId = "" } = useParams()
  // A fresh visit per topic, so what counts as new is measured from each topic's own last look
  return <TopicView key={topicId} topicId={decodeURIComponent(topicId)} />
}

function TopicView({ topicId }: { topicId: string }) {
  const navigate = useNavigate()
  const topic = useTopic(topicId)
  const side = useKnowledgeStore((s) => (topic ? s.topics[topic.id] : undefined))

  // What changed since the last look stays marked for this visit. The topic counts as looked at once every
  // changed line has been on screen, not when the page opens, so a glance never clears the trail.
  const [seenBefore] = useState(() => side?.seenAt ?? 0)
  const freshIds = useMemo(() => (topic && side ? changedSince(topic, side, seenBefore).map((l) => l.id) : []), [topic, side, seenBefore])
  const viewed = useRef(new Set<string>())
  const onViewed = useCallback(
    (id: string) => {
      viewed.current.add(id)
      if (topic && freshIds.every((x) => viewed.current.has(x))) useKnowledgeStore.getState().markSeen(topic.id)
    },
    [topic, freshIds],
  )
  useEffect(() => {
    if (topic && freshIds.length === 0) useKnowledgeStore.getState().markSeen(topic.id)
  }, [topic?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!topic)
    return <NotFound title="This topic is gone" detail="It may have been merged, deleted or renamed outside owlit." back={{ label: "Back to Knowledge", to: "/knowledge" }} />

  const sidecar: TopicSidecar = side ?? { seenAt: 0, history: [], edits: {}, removed: {}, said: {}, changedAt: {} }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: "Knowledge", to: "/knowledge" }]} current={topic.name}>
        <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" onClick={() => useAgentWindow.getState().open()}>
          <MessageSquareIcon />
          Chat about this
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Topic actions" className="text-muted-foreground data-[state=open]:bg-muted">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <TopicMenuContent topic={topic} afterDelete={() => navigate("/knowledge")} />
        </DropdownMenu>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-3xl px-4 pt-8 pb-32">
          <Intro topic={topic} side={sidecar} seenBefore={seenBefore} freshIds={freshIds} />
          <Questions topic={topic} />
          <SoFar topic={topic} side={sidecar} seenBefore={seenBefore} freshIds={freshIds} onViewed={onViewed} />
          <Sources topic={topic} />
          <Changes topic={topic} history={sidecar.history} />
        </article>
      </div>
    </div>
  )
}

// "Cited in Related work · Acting with tools": a draft that cites one of the topic's papers, computed
function citedIn(topic: Topic, files: Record<string, WorkspaceFile>) {
  const papers = new Set(topic.lines.flatMap((l) => l.sources.flatMap((r) => paperRef(r.uri)?.id ?? [])))
  for (const f of Object.values(files).sort((a, b) => b.modifiedAt - a.modifiedAt)) {
    if (isHidden(f.path) || !f.content || !f.path.startsWith("writing/")) continue
    for (const id of papers) {
      const at = f.content.indexOf(`${paperUri(id)})`)
      if (at < 0) continue
      const heading = [...f.content.slice(0, at).matchAll(/^#{2,}\s+(.+)$/gm)].at(-1)?.[1]
      return { file: f, heading }
    }
  }
  return null
}

function Intro({ topic, side, seenBefore, freshIds }: { topic: Topic; side: TopicSidecar; seenBefore: number; freshIds: string[] }) {
  const renaming = useKnowledgeUi((s) => s.renaming === topic.id)
  const set = useKnowledgeUi((s) => s.set)
  const files = useDocsStore((s) => s.files)
  const cited = citedIn(topic, files)
  return (
    <>
      {renaming ? (
        <RenameInput
          initial={topic.name}
          label="Topic name"
          onDone={(name) => {
            if (name !== null) renameTopic(topic.id, name)
            set({ renaming: null })
          }}
          // The name stays where it was: the border and padding are taken back out of the margins
          className="-mx-[5px] -my-px px-1 text-title leading-tight font-medium tracking-tight"
        />
      ) : (
        <PageTitle onDoubleClick={() => set({ renaming: topic.id })}>{topic.name}</PageTitle>
      )}
      <p className="mt-2 text-detail text-muted-foreground">
        Updated {shortDate(topic.updatedAt)}
        {side.paused && " · updates paused"}{" "}
        <Info>Owlit keeps this topic from your notes, papers and chats. Each line says who it comes from. Click a line to see where it came from and how it changed. Edit a line and it stays in your words.</Info>
      </p>
      {cited && (
        <p className="mt-1 text-detail text-muted-foreground">
          Cited in <MentionLink label={displayName(cited.file.path)} to={`/docs/${cited.file.id}`} />
          {cited.heading && <> · {cited.heading}</>}
        </p>
      )}
      {/* The topic's own words, not a quote, so in body tone behind the rule */}
      {topic.summary && <p className="mt-5 border-l-2 pl-4 text-body leading-relaxed text-pretty">{topic.summary}</p>}
      {freshIds.length > 0 && (
        <Button variant="text" size="inline" onClick={() => ringBlock(freshIds[0])} className="-ml-1.5 mt-4 flex gap-2">
          <NoteDot />
          {freshIds.length} line{freshIds.length === 1 ? "" : "s"} changed since you last looked{seenBefore > 0 && ` on ${shortDate(seenBefore)}`}
        </Button>
      )}
    </>
  )
}

// Lands on #q1 or #s3 from a mention or a link: scrolls there and rings it once
function useTarget(id: string) {
  const { hash } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const hit = hash.replace(/^#\^?/, "") === id
  useEffect(() => {
    if (hit) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [hit])
  return { ref, hit }
}

function Questions({ topic }: { topic: Topic }) {
  const [all, setAll] = useState(false)
  if (!topic.questions.length) return null
  const shown = all ? topic.questions : topic.questions.slice(0, MAX_QUESTIONS)
  return (
    <section className="mt-10">
      <GroupLabel flush>Your questions</GroupLabel>
      <div className="flex flex-col gap-4">
        {shown.map((q) => (
          <QuestionRow key={q.id} topic={topic} id={q.id} text={q.text} status={q.status} />
        ))}
      </div>
      {topic.questions.length > MAX_QUESTIONS && <MoreButton open={all} hidden={topic.questions.length - MAX_QUESTIONS} onClick={() => setAll((a) => !a)} />}
    </section>
  )
}

function QuestionRow({ topic, id, text, status }: { topic: Topic; id: string; text: string; status?: string }) {
  const { ref, hit } = useTarget(id)
  return (
    <div ref={ref} id={id} className={cn("-mx-2 rounded-md px-2 py-0.5", hit && "animate-highlight-flash")}>
      <p className="text-body leading-relaxed">{text}</p>
      {status && <p className="text-detail leading-relaxed text-muted-foreground">{status}</p>}
      <span className="sr-only">In {topic.name}</span>
    </div>
  )
}

function MoreButton({ open, hidden, onClick }: { open: boolean; hidden: number; onClick: () => void }) {
  return (
    <FoldButton open={open} onClick={onClick} className="mt-2">
      {open ? "Show fewer" : `Show ${hidden} more`}
    </FoldButton>
  )
}

function SoFar({ topic, side, seenBefore, freshIds, onViewed }: { topic: Topic; side: TopicSidecar; seenBefore: number; freshIds: string[]; onViewed: (id: string) => void }) {
  // A changed line under the fold would never be seen, so the fold opens for it
  const [all, setAll] = useState(() => topic.lines.findIndex((l) => freshIds.includes(l.id)) >= MAX_LINES)
  if (!topic.lines.length) return null
  const shown = all ? topic.lines : topic.lines.slice(0, MAX_LINES)
  return (
    <section className="mt-10">
      <GroupLabel flush>So far</GroupLabel>
      <div className="-mx-2 flex flex-col gap-1">
        {shown.map((l) => (
          <LineRow key={l.id} topic={topic} line={l} side={side} seenBefore={seenBefore} fresh={freshIds.includes(l.id) ? freshness(l.id, side, seenBefore) : null} onViewed={onViewed} />
        ))}
      </div>
      {topic.lines.length > MAX_LINES && <MoreButton open={all} hidden={topic.lines.length - MAX_LINES} onClick={() => setAll((a) => !a)} />}
    </section>
  )
}

// Whether Owlit added or rewrote the line since the user last looked
function freshness(lineId: string, side: TopicSidecar, seenBefore: number): "new" | "changed" | null {
  if ((side.changedAt[lineId] ?? 0) <= seenBefore || side.edits[lineId]) return null
  return side.history.some((h) => h.lineId === lineId && h.at > seenBefore && h.what !== "Added") ? "changed" : "new"
}

// The line before Owlit's latest rewrite, shown while the change is unseen
const wasBefore = (lineId: string, side: TopicSidecar, since: number) => side.history.find((h) => h.lineId === lineId && h.at > since && h.by === "owlit" && h.before)?.before

// Calls back once the element has been on screen for a moment
function useViewed(active: boolean, onViewed: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer)
        if (e.isIntersecting) timer = setTimeout(onViewed, DWELL_MS)
      },
      { threshold: 0.9 },
    )
    io.observe(el)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [active, onViewed])
  return ref
}

// "You wrote", "Schick 2023 found", "Owlit thinks": the name in medium weight, the verb muted
export function Speaker({ line }: { line: Line }) {
  return (
    <>
      <span className="font-medium text-foreground">{line.speaker}</span> <span className="text-muted-foreground">{verbOf(line)}</span>
    </>
  )
}

function LineRow({ topic, line, side, seenBefore, fresh, onViewed }: { topic: Topic; line: Line; side: TopicSidecar; seenBefore: number; fresh: "new" | "changed" | null; onViewed: (id: string) => void }) {
  const key = lineKey(topic.id, line.id)
  const editing = useKnowledgeUi((s) => s.editing === key)
  const open = useKnowledgeUi((s) => s.open === key)
  const set = useKnowledgeUi((s) => s.set)
  const { ref, hit } = useTarget(line.id)
  const viewedRef = useViewed(
    !!fresh,
    useCallback(() => onViewed(line.id), [onViewed, line.id]),
  )
  const abstractOnly = isAbstractOnly(line)
  const was = fresh === "changed" ? wasBefore(line.id, side, seenBefore) : undefined

  const remove = () => {
    const undo = removeLine(topic.id, line.id)
    if (undo) toastUndo("Line removed", undo, { description: "Updates won’t bring it back." })
  }
  const ask = () =>
    useAgentWindow.getState().open({ text: line.text, source: { id: key, kind: "knowledge", title: topic.name, uri: topicUri(topic.id, line.id) } })
  const toggle = () => set({ open: open ? null : key })
  const menu: MenuGroups = editing
    ? []
    : [
        [
          { label: "Edit", onSelect: () => set({ editing: key, open: null }) },
          // Once the menu has closed, so it doesn't take focus back from the agent window
          { label: "Ask Owlit", afterClose: true, onSelect: ask },
        ],
        [{ label: "Remove", destructive: true, onSelect: remove }],
      ]

  return (
    <ActionsOnRightClick groups={menu}>
      <div
        ref={(el) => {
          ref.current = el
          viewedRef.current = el
        }}
        id={line.id}
        tabIndex={editing ? -1 : 0}
        aria-expanded={open}
        className={cn(
          "group/row relative grid grid-cols-[112px_1fr] gap-x-4 rounded-md px-2 py-2 outline-none transition-colors",
          !editing && "cursor-pointer hover:bg-muted/60 focus-key:bg-muted/60 has-data-[state=open]:bg-muted/60 data-[state=open]:bg-muted/60",
          open && "bg-muted/60",
          hit && "animate-highlight-flash",
        )}
        onClick={(e) => {
          if (editing || (e.target as HTMLElement).closest("button, a, [role=menuitem], textarea")) return
          if (window.getSelection()?.toString()) return
          toggle()
        }}
        onKeyDown={(e) => {
          if (editing || e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <div className="relative pt-[3px] text-detail leading-snug">
          {fresh && <NoteDot className="absolute top-[9px] -left-3.5" label={fresh === "changed" ? "Changed since you last looked" : "New since you last looked"} />}
          <Speaker line={line} />
        </div>
        <div className="min-w-0 pr-8">
          {editing ? (
            <SentenceEditor
              value={line.text}
              className="text-body leading-relaxed"
              onCancel={() => set({ editing: null })}
              onSave={(text) => {
                editLine(topic.id, line.id, text)
                set({ editing: null })
              }}
            />
          ) : (
            <>
              <p className={cn("text-body leading-relaxed text-pretty", abstractOnly && "text-muted-foreground")}>{line.text}</p>
              {(line.sources.length > 0 || line.condition || abstractOnly) && (
                <p className="mt-0.5 text-detail leading-relaxed text-muted-foreground">
                  <Refs refs={line.sources} />
                  {line.condition && (
                    <>
                      {line.sources.length > 0 && <Dot />}
                      {line.condition}
                    </>
                  )}
                  {abstractOnly && <span className="ml-2 inline-flex h-5 items-center rounded-md bg-muted px-1.5 align-[0.05em] text-xs">abstract only</span>}
                </p>
              )}
              {was && !open && <p className="mt-0.5 text-detail leading-relaxed text-muted-foreground">Was: “{was}”</p>}
            </>
          )}
          {open && !editing && <LineHistory topic={topic} line={line} side={side} />}
        </div>
        {!editing && <RowMenuButton groups={menu} label="Line actions" className="absolute top-2 right-1.5" />}
      </div>
    </ActionsOnRightClick>
  )
}

// Where a line came from and how it changed, ruled off under it
function LineHistory({ topic, line, side }: { topic: Topic; line: Line; side: TopicSidecar }) {
  const rows: { at: number; text: React.ReactNode }[] = side.history
    .filter((h) => h.lineId === line.id)
    .map((h) => ({
      at: h.at,
      text: (
        <>
          {h.what} <span className="text-muted-foreground">· {h.why}</span>
          {h.before && <span className="block text-muted-foreground">Was: “{h.before}”</span>}
        </>
      ),
    }))
  for (const s of side.said[line.id] ?? []) rows.push({ at: s.at, text: <span className="text-muted-foreground">You said: “{s.text}”</span> })
  if (!side.history.some((h) => h.lineId === line.id && h.what === "Added")) {
    const start = side.history.filter((h) => !h.lineId).at(-1)
    rows.push({ at: start?.at ?? topic.updatedAt, text: <>In this topic since it began {start && <span className="text-muted-foreground">· {start.why}</span>}</> })
  }
  rows.sort((a, b) => a.at - b.at)
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 border-t pt-2.5 text-detail leading-relaxed">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-2">
          <span className="text-muted-foreground tabular-nums">{shortDate(r.at)}</span>
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  )
}

// Every line already carries its source, so the topic's list of them stays folded: when each came in and how
// it was used
function Sources({ topic }: { topic: Topic }) {
  const [open, setOpen] = useState(false)
  if (!topic.sources.length) return null
  return (
    <section className="mt-10">
      <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
        Sources · {provenance(topic)}
      </FoldButton>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-sm">
          {topic.sources.map((s, i) => (
            <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-2 leading-relaxed">
              <span className="text-detail text-muted-foreground tabular-nums">{dayLabel(s.date)}</span>
              <span>
                <Refs refs={[s.ref]} />
                {s.how && <span className="text-muted-foreground"> · {s.how}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// The change log names a line by its opening words, which open it; nothing on the page is numbered
function Changes({ topic, history }: { topic: Topic; history: Change[] }) {
  const [open, setOpen] = useState(false)
  if (!history.length) return null
  const subject = (h: Change): React.ReactNode => {
    if (!h.lineId) return null
    const line = topic.lines.find((l) => l.id === h.lineId)
    if (line) return <MentionToken label={`“${firstWords(line.text)}”`} onClick={() => ringBlock(line.id)} />
    const q = topic.questions.find((x) => x.id === h.lineId)
    if (q) return <MentionToken label={`“${firstWords(q.text)}”`} onClick={() => ringBlock(q.id)} />
    return h.before ? <>“{firstWords(h.before)}”</> : "A line"
  }
  return (
    <section className="mt-6">
      <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
        {history.length} change{history.length === 1 ? "" : "s"}
      </FoldButton>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-detail leading-relaxed">
          {history.map((h) => {
            const who = subject(h)
            return (
              <div key={h.id} className="grid grid-cols-[4.5rem_1fr] gap-2">
                <span className="text-muted-foreground tabular-nums">{shortDate(h.at)}</span>
                <span>
                  {who ? (
                    <>
                      {who} {h.what.charAt(0).toLowerCase() + h.what.slice(1)}
                    </>
                  ) : (
                    h.what
                  )}{" "}
                  <span className="text-muted-foreground">· {h.why}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
