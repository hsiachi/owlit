import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon, MessageSquareIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { FoldButton } from "@/components/fold"
import { NotFound, PageHeader, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAgentWindow } from "@/features/agent/store"
import { GroupLabel } from "@/components/group-label"
import { Info } from "@/components/info"
import { NoteDot } from "@/components/marks"
import { MentionLink } from "@/components/mention/mention-token"
import { useDocsStore } from "@/features/docs/store"
import { displayName } from "@/features/docs/types"
import { useLibraryStore } from "@/features/library/store"
import { Prose } from "../components/bits"
import { LineRow } from "../components/LineRow"
import { TopicMenuContent } from "../components/TopicMenu"
import { Changes, Sources } from "../components/TopicLog"
import { citingDocs, freshness, paperRef, withAliases } from "../format"
import { useTarget } from "../hooks"
import { ringBlock } from "../lib/ring"
import { shortDate } from "@/lib/time"
import { plural, t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { changedSince, renameTopic, useKnowledgeStore, useTopic } from "../store"
import type { Topic, TopicSidecar } from "../types"
import { useKnowledgeUi } from "../ui-store"

// Hard caps keep a topic to a screen; the renderer folds anything beyond
const MAX_LINES = 7
const MAX_QUESTIONS = 5

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
    return (
      <NotFound title={t`This topic is gone`} detail={t`It may have been merged, deleted or renamed outside owlit.`} back={{ label: t`Back to Knowledge`, to: "/knowledge" }} />
    )

  const sidecar: TopicSidecar = side ?? { seenAt: 0, history: [], edits: {}, removed: {}, said: {}, changedAt: {} }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: t`Knowledge`, to: "/knowledge" }]} current={topic.name}>
        <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" onClick={() => useAgentWindow.getState().open()}>
          <MessageSquareIcon />
          {t`Chat about this`}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t`Topic actions`} className="text-muted-foreground data-[state=open]:bg-muted">
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

// "Cited in Related work · Acting with tools": the latest doc citing one of the topic's papers
function useCitedIn(topic: Topic) {
  const files = useDocsStore((s) => s.files)
  const aliases = useLibraryStore((s) => s.aliases)
  const ids = useMemo(() => withAliases([...new Set(topic.lines.flatMap((l) => l.sources.flatMap((r) => paperRef(r.uri)?.id ?? [])))], aliases), [topic, aliases])
  return useMemo(() => citingDocs(files, ids)[0], [files, ids])
}

function Intro({ topic, side, seenBefore, freshIds }: { topic: Topic; side: TopicSidecar; seenBefore: number; freshIds: string[] }) {
  const renaming = useKnowledgeUi((s) => s.renaming === topic.id)
  const set = useKnowledgeUi((s) => s.set)
  const cited = useCitedIn(topic)
  const updated = shortDate(topic.updatedAt)
  const lastLook = shortDate(seenBefore)
  return (
    <>
      {renaming ? (
        <RenameInput
          initial={topic.name}
          label={t`Topic name`}
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
        {side.paused ? t`Updated ${updated} · updates paused` : t`Updated ${updated}`}{" "}
        <Info>
          {t`Owlit keeps this topic from your notes, papers and chats. Each line says who it comes from. Click a line to see where it came from and how it changed. Edit a line and it stays in your words.`}
        </Info>
      </p>
      {cited && (
        <p className="mt-1 text-detail text-muted-foreground">
          <Trans>
            Cited in <MentionLink label={displayName(cited.file.path)} to={`/docs/${cited.file.id}`} />
          </Trans>
          {cited.heading && <> · {cited.heading}</>}
        </p>
      )}
      {/* The topic's own words, not a quote, so in body tone behind the rule */}
      {topic.summary && (
        <p className="mt-5 border-l-2 pl-4 text-body leading-relaxed text-pretty">
          <Prose text={topic.summary} topic={topic} />
        </p>
      )}
      {freshIds.length > 0 && (
        <Button variant="text" size="inline" onClick={() => ringBlock(freshIds[0])} className="-ml-1.5 mt-4 flex gap-2">
          <NoteDot />
          {seenBefore > 0
            ? plural(freshIds.length, { one: `# line changed since you last looked on ${lastLook}`, other: `# lines changed since you last looked on ${lastLook}` })
            : plural(freshIds.length, { one: "# line changed since you last looked", other: "# lines changed since you last looked" })}
        </Button>
      )}
    </>
  )
}

function Questions({ topic }: { topic: Topic }) {
  const [all, setAll] = useState(false)
  if (!topic.questions.length) return null
  const shown = all ? topic.questions : topic.questions.slice(0, MAX_QUESTIONS)
  return (
    <section className="mt-10">
      <GroupLabel flush>{t`Your questions`}</GroupLabel>
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
  const name = topic.name
  return (
    <div ref={ref} id={id} className={cn("-mx-2 rounded-md px-2 py-0.5", hit && "animate-highlight-flash")}>
      <p className="text-body leading-relaxed">
        <Prose text={text} topic={topic} />
      </p>
      {status && (
        <p className="text-detail leading-relaxed text-muted-foreground">
          <Prose text={status} topic={topic} />
        </p>
      )}
      <span className="sr-only">{t`In ${name}`}</span>
    </div>
  )
}

function MoreButton({ open, hidden, onClick }: { open: boolean; hidden: number; onClick: () => void }) {
  return (
    <FoldButton open={open} onClick={onClick} className="mt-2">
      {open ? t`Show less` : t`Show ${hidden} more`}
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
      <GroupLabel flush>{t`So far`}</GroupLabel>
      {/* A wider left gutter than right, for the note dot, so the words still line up with the label */}
      <div className="-mr-2 -ml-5 flex flex-col gap-1">
        {shown.map((l) => (
          <LineRow key={l.id} topic={topic} line={l} side={side} seenBefore={seenBefore} fresh={freshIds.includes(l.id) ? freshness(l.id, side, seenBefore) : null} onViewed={onViewed} />
        ))}
      </div>
      {topic.lines.length > MAX_LINES && <MoreButton open={all} hidden={topic.lines.length - MAX_LINES} onClick={() => setAll((a) => !a)} />}
    </section>
  )
}
