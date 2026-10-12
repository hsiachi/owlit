import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FoldChevron } from "@/components/fold"
import { GroupLabel } from "@/components/group-label"
import { KindIcon } from "@/components/kind-icon"
import { ListRow } from "@/components/list-row"
import { NoteDot } from "@/components/marks"
import { Unfold } from "@/components/unfold"
import { Button } from "@/components/ui/button"
import { useAgentWindow } from "@/features/agent/store"
import { useLibraryStore } from "@/features/library/store"
import { LineBody, TopicLine } from "@/features/knowledge/components/TopicLine"
import { topicUri, wasBefore } from "@/features/knowledge/format"
import { DAY, shortDate } from "@/lib/time"
import { changedSince, useKnowledgeStore, useTopics } from "@/features/knowledge/store"
import type { Line, Topic, TopicSidecar } from "@/features/knowledge/types"
import { cn } from "@/lib/utils"
import { plural } from "@/lib/words"

// After three days or more away: one row per topic Owlit changed meanwhile, opening in place to the
// changed lines, and one line for papers Owlit added. It belongs to this launch only; what the user
// doesn't open keeps its dot on the Knowledge page.

export const AWAY_FOR = 3 * DAY

interface Changed {
  topic: Topic
  side: TopicSidecar
  lines: Line[]
  what: string
}

// "2 lines added, 1 rewritten", or "New topic, 3 lines", from Owlit's history since the user left
function summary(side: TopicSidecar, since: number, lines: Line[]) {
  const lineCount = (n: number) => plural(n, "line")
  const recent = side.history.filter((h) => h.by === "owlit" && h.at > since)
  if (recent.some((h) => h.what === "Topic started")) return `New topic, ${lineCount(lines.length)}`
  const counts = new Map<string, number>()
  for (const h of recent) if (h.lineId) counts.set(h.what.toLowerCase(), (counts.get(h.what.toLowerCase()) ?? 0) + 1)
  const parts = [...counts].map(([what, n], i) => (i === 0 ? `${lineCount(n)} ${what}` : `${n} ${what}`))
  return parts.length ? parts.join(", ") : `${lineCount(lines.length)} changed`
}

export function SinceYouLeft({ since }: { since: number }) {
  const navigate = useNavigate()
  const topics = useTopics()
  const sides = useKnowledgeStore((s) => s.topics)
  const papers = useLibraryStore((s) => s.papers)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const changed = useMemo<Changed[]>(
    () =>
      topics.flatMap((topic) => {
        const side = sides[topic.id]
        const lines = side && !topic.archived ? changedSince(topic, side, since) : []
        return lines.length ? [{ topic, side, lines, what: summary(side, since, lines) }] : []
      }),
    [topics, sides, since],
  )
  const added = useMemo(() => Object.values(papers).filter((p) => p.addedBy === "agent" && p.addedAt > since).length, [papers, since])

  if (!changed.length && !added) return null

  const toggle = (c: Changed) => {
    const opening = !open[c.topic.id]
    setOpen((o) => ({ ...o, [c.topic.id]: opening }))
    // Every changed line is on screen once the row is open, which is what a look at the topic means
    if (opening) useKnowledgeStore.getState().markSeen(c.topic.id)
  }

  return (
    <section className="mt-8">
      <GroupLabel>Since you left on {shortDate(since)}</GroupLabel>
      <div className="flex flex-col gap-0.5">
        {changed.map((c) => {
          const isOpen = !!open[c.topic.id]
          const unseen = changedSince(c.topic, c.side).length > 0
          return (
            <div key={c.topic.id}>
              <ListRow
                aria-expanded={isOpen}
                onClick={() => toggle(c)}
                className={cn(isOpen && "bg-muted")}
                mark={<NoteDot gone={!unseen} />}
                title={c.topic.name}
                detail={c.what}
                end={<FoldChevron open={isOpen} className="size-4" />}
              />
              <Unfold open={isOpen}>
                <Peek c={c} since={since} />
              </Unfold>
            </div>
          )
        })}
        {added > 0 && (
          <ListRow
            onClick={() => navigate("/library")}
            mark={<KindIcon kind="paper" className="size-4" />}
            title={`Owlit added ${plural(added, "paper")} to your Library`}
          />
        )}
      </div>
    </section>
  )
}

// The changed lines as the topic page draws them: who and how, the line, its sources, and what it was
function Peek({ c, since }: { c: Changed; since: number }) {
  const navigate = useNavigate()
  return (
    <div className="mt-1 mb-3 pr-2.5 pl-9">
      {c.lines.map((l) => (
        <TopicLine key={l.id} line={l} className="py-1.5">
          <div className="min-w-0">
            <LineBody line={l} was={wasBefore(l.id, c.side, since)} />
          </div>
        </TopicLine>
      ))}
      <div className="mt-1 ml-[128px] flex gap-1">
        <Button variant="text" size="inline" className="-ml-1.5" onClick={() => navigate(`/knowledge/${c.topic.id}`)}>
          Open topic
        </Button>
        <Button
          variant="text"
          size="inline"
          onClick={() => useAgentWindow.getState().open({ text: c.lines.map((l) => l.text).join("\n"), source: { id: c.topic.id, kind: "knowledge", title: c.topic.name, uri: topicUri(c.topic.id) } })}
        >
          Chat about this
        </Button>
      </div>
    </div>
  )
}
