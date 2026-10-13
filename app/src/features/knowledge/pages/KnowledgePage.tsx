import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { FindField } from "@/components/find-field"
import { FoldButton } from "@/components/fold"
import { GroupLabel } from "@/components/group-label"
import { ListRow } from "@/components/list-row"
import { NoteDot } from "@/components/marks"
import { PageShell, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Prose } from "../components/bits"
import { KnowledgeEmpty } from "../components/KnowledgeEmpty"
import { TopicMenuItems } from "../components/TopicMenu"
import { ago, DAY, shortDate } from "@/lib/time"
import { hasAllWords, queryWords } from "@/lib/words"
import { plural, t } from "@lingui/core/macro"
import { changedSince, renameTopic, useKnowledgeStore, useTopics } from "../store"
import type { Topic } from "../types"
import { useKnowledgeUi } from "../ui-store"

// A run counts as recent for this long; after that the page says nothing about runs
const RECENT_MS = 48 * 3_600_000
// The find field appears once the list is longer than a screen
const FIND_FROM = 9

const matches = (topic: Topic, words: string[]) => hasAllWords([topic.name, topic.summary, ...topic.lines.map((l) => l.text), ...topic.questions.map((q) => q.text)].join(" "), words)

export function KnowledgePage() {
  const topics = useTopics()
  const loose = useKnowledgeStore((s) => s.loose)
  const query = useKnowledgeUi((s) => s.query)
  const setQuery = useKnowledgeUi((s) => s.setQuery)
  const [asideOpen, setAsideOpen] = useState(false)

  const words = queryWords(query)
  const shown = useMemo(() => topics.filter((t) => matches(t, queryWords(query))), [topics, query])
  const live = shown.filter((t) => !t.archived)
  // This week means the last seven days
  const weekAgo = Date.now() - 7 * DAY
  const groups = [
    { key: "week", label: t`This week`, topics: live.filter((topic) => topic.updatedAt > weekAgo) },
    { key: "earlier", label: t({ message: "Earlier", comment: "group of topics updated more than a week ago" }), topics: live.filter((topic) => topic.updatedAt <= weekAgo) },
  ].filter((g) => g.topics.length)
  const archived = shown.filter((topic) => topic.archived)
  const looseHit = words.length > 0 && loose.some((l) => hasAllWords(l.quote, words))
  const aside = [
    archived.length > 0 && plural(archived.length, { one: "# archived", other: "# archived" }),
    loose.length > 0 && plural(loose.length, { one: "# loose passage", other: "# loose passages" }),
  ].filter(Boolean)
  const asideList = aside.join(" · ")

  return (
    <PageShell width="narrow">
      <header className="px-0.5">
        {/* Questions may join as a second view; until then a lone tab strip would say nothing */}
        <PageTitle>{t`Knowledge`}</PageTitle>
      </header>
      {/* With no topics the empty state says when Owlit last read */}
      {topics.length > 0 && <RecentRun />}
      {(topics.length >= FIND_FROM || query) && (
        <FindField value={query} onChange={setQuery} placeholder={t`Find a topic, a line or a question`} label={t`Find in Knowledge`} />
      )}
      {topics.length === 0 ? (
        <KnowledgeEmpty />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key}>
              {/* The group label earns its place only when it splits the list */}
              {groups.length > 1 && <GroupLabel>{g.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {g.topics.map((t) => (
                  <TopicRow key={t.id} topic={t} />
                ))}
              </div>
            </section>
          ))}
          {words.length > 0 && !live.length && !archived.length && !looseHit && <p className="py-10 text-center text-sm text-muted-foreground">{t`No topics match.`}</p>}
          {words.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              {archived.map((t) => (
                <TopicRow key={t.id} topic={t} />
              ))}
              {looseHit && <LooseRow count={loose.length} />}
            </section>
          ) : (
            aside.length > 0 && (
              <section className="flex flex-col gap-0.5">
                <FoldButton open={asideOpen} onClick={() => setAsideOpen((o) => !o)} className="ml-0 h-9 gap-1.5 px-2.5">
                  {t`Set aside · ${asideList}`}
                </FoldButton>
                {asideOpen && (
                  <>
                    {archived.map((t) => (
                      <TopicRow key={t.id} topic={t} />
                    ))}
                    {loose.length > 0 && <LooseRow count={loose.length} />}
                  </>
                )}
              </section>
            )
          )}
        </div>
      )}
    </PageShell>
  )
}

// Notes and chat lines no topic holds; it never needs doing, so it sits folded with the archived topics
function LooseRow({ count }: { count: number }) {
  return (
    <ListRow
      to="/knowledge/loose"
      title={plural(count, { one: "Not in a topic yet · # passage", other: "Not in a topic yet · # passages" })}
      className="text-muted-foreground hover:text-foreground"
    />
  )
}

// "Updated 3 min ago · 2 topics", only after a recent run; it opens what changed
function RecentRun() {
  const run = useKnowledgeStore((s) => s.lastRun)
  const topics = useTopics()
  const navigate = useNavigate()
  // The clock moves once a minute so "3 min ago" stays true
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  if (!run || now - run.at > RECENT_MS) return null
  const n = new Set(run.items.map((i) => i.topicId)).size
  const when = ago(run.at, { inSentence: true })
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="text" size="inline" className="-ml-1.5 mt-3 data-[state=open]:bg-muted data-[state=open]:text-foreground">
          {plural(n, { one: `Updated ${when} · # topic`, other: `Updated ${when} · # topics` })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-1">
        {run.items.map((i, n) => {
          const topic = topics.find((x) => x.id === i.topicId)
          if (!topic) return null
          return (
            <button
              key={n}
              type="button"
              onClick={() => navigate(`/knowledge/${topic.id}`)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left outline-none hover:bg-accent focus-key:bg-accent"
            >
              <span className="text-sm font-medium">{topic.name}</span>
              <span className="text-detail text-muted-foreground">{i.what}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// The topic's name, its summary inline in muted text, the date at the right. No counts, no badges: the
// only mark is the dot, on a topic Owlit changed since the user last looked at it.
function TopicRow({ topic }: { topic: Topic }) {
  const navigate = useNavigate()
  const renaming = useKnowledgeUi((s) => s.renaming === topic.id)
  const set = useKnowledgeUi((s) => s.set)
  const side = useKnowledgeStore((s) => s.topics[topic.id])
  const fresh = !!side && changedSince(topic, side).length > 0
  const menu = <TopicMenuItems topic={topic} />

  if (renaming) {
    return (
      <RenameInput
        initial={topic.name}
        label={t`Topic name`}
        onDone={(name) => {
          if (name !== null) renameTopic(topic.id, name)
          set({ renaming: null })
        }}
        className="h-9 pr-2 pl-[9px]"
      />
    )
  }

  return (
    // The same menu as the row's ⋯, on a right-click
    <ActionsOnRightClick menu={menu} className="w-48">
      <div
        role="link"
        tabIndex={0}
        onClick={(e) => !(e.target as HTMLElement).closest("button") && navigate(`/knowledge/${topic.id}`)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(`/knowledge/${topic.id}`)}
        className="group/row flex h-9 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 text-sm outline-none select-none hover:bg-muted focus-key:bg-muted has-data-[state=open]:bg-muted data-[state=open]:bg-muted"
      >
        {fresh && <NoteDot className="-ml-0.5" label={t`Changed since you last looked`} />}
        <span className={cn("shrink-0 truncate", topic.archived && "text-muted-foreground")}>{topic.name}</span>
        <span className="min-w-0 flex-1 truncate text-detail text-muted-foreground">
          {/* Lines named by id can't be pointed at from a row, so the ids are left out */}
          <Prose text={topic.summary} />
        </span>
        {/* The date gives way to the row's actions */}
        <span className="shrink-0 pr-1.5 text-detail text-muted-foreground group-hover/row:hidden group-focus-key/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">
          {shortDate(topic.updatedAt)}
        </span>
        <RowMenuButton menu={menu} label={t`Topic actions`} menuClassName="w-48" />
      </div>
    </ActionsOnRightClick>
  )
}
