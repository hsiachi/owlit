import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpenIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentWindow } from "@/features/agent/store"
import { useLibraryStore } from "@/features/library/store"
import { NoteDot, Refs } from "@/features/knowledge/components/bits"
import { topicUri, verbOf } from "@/features/knowledge/format"
import { shortDate } from "@/features/knowledge/lib/when"
import { changedSince, useKnowledgeStore, useTopics } from "@/features/knowledge/store"
import type { Line, Topic, TopicSidecar } from "@/features/knowledge/types"
import { cn } from "@/lib/utils"

// After three days or more away: one row per topic Owlit changed meanwhile, opening in place to the
// changed lines, and one line for papers Owlit added. It belongs to this launch only; what the user
// doesn't open keeps its dot on the Knowledge page.

export const AWAY_FOR = 3 * 86_400_000

interface Changed {
  topic: Topic
  side: TopicSidecar
  lines: Line[]
  what: string
}

// "2 lines added, 1 rewritten", or "New topic, 3 lines", from Owlit's history since the user left
function summary(side: TopicSidecar, since: number, lines: Line[]) {
  const lineCount = (n: number) => `${n} line${n === 1 ? "" : "s"}`
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
      <h2 className="mb-1 px-2.5 text-xs text-muted-foreground">Since you left on {shortDate(since)}</h2>
      <div className="flex flex-col gap-0.5">
        {changed.map((c) => {
          const isOpen = !!open[c.topic.id]
          const unseen = changedSince(c.topic, c.side).length > 0
          return (
            <div key={c.topic.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(c)}
                className={cn("flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none hover:bg-muted focus-key:bg-muted", isOpen && "bg-muted")}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <NoteDot className={cn("transition-opacity duration-500", !unseen && "opacity-0")} />
                </span>
                <span className="max-w-[40%] shrink-0 truncate">{c.topic.name}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{c.what}</span>
                <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && <Peek c={c} since={since} />}
            </div>
          )
        })}
        {added > 0 && (
          <button
            type="button"
            onClick={() => navigate("/library")}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none hover:bg-muted focus-key:bg-muted"
          >
            <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              Owlit added {added} paper{added === 1 ? "" : "s"} to your Library
            </span>
          </button>
        )}
      </div>
    </section>
  )
}

// The changed lines as the topic page draws them: who and how, the line, its sources, and what it was
function Peek({ c, since }: { c: Changed; since: number }) {
  const navigate = useNavigate()
  const before = (lineId: string) => c.side.history.find((h) => h.lineId === lineId && h.at > since && h.before)?.before
  return (
    <div className="mt-1 mb-3 pr-2.5 pl-9">
      {c.lines.map((l) => {
        const was = before(l.id)
        return (
          <div key={l.id} className="grid grid-cols-[112px_1fr] gap-3 py-1.5">
            <div className="pt-px text-sm">
              <span className="font-medium">{l.speaker}</span> <span className="text-muted-foreground">{verbOf(l)}</span>
            </div>
            <div className="text-[15px] leading-normal">
              {l.text}
              {(l.sources.length > 0 || was) && (
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  <Refs refs={l.sources} />
                  {was && <div>Was: “{was}”</div>}
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div className="mt-1 ml-[124px] flex gap-1">
        <Button variant="ghost" size="sm" className="-ml-3 font-normal text-muted-foreground" onClick={() => navigate(`/knowledge/${c.topic.id}`)}>
          Open topic
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          onClick={() => useAgentWindow.getState().open({ text: c.lines.map((l) => l.text).join("\n"), source: { id: c.topic.id, kind: "knowledge", title: c.topic.name, uri: topicUri(c.topic.id) } })}
        >
          Chat about this
        </Button>
      </div>
    </div>
  )
}
