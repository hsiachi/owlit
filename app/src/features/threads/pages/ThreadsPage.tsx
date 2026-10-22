import { plural, t } from "@lingui/core/macro"
import type { ThreadSummary } from "@owlit/protocol"
import { useState } from "react"
import { FindField } from "@/components/find-field"
import { hasAllWords, queryWords } from "@/lib/words"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, givesWayToRowMenu, RowMenuButton } from "@/components/action-menu"
import { EmptyPlace } from "@/components/empty-place"
import { Button } from "@/components/ui/button"
import { findPrompt } from "@/features/chat/lib/starters"
import { PageShell, PageTitle } from "@/components/page"
import { NoteDot, StoppedDot } from "@/components/marks"
import { shortDate } from "@/lib/time"
import { useThreadMenu } from "../components/ThreadMenu"
import { useThreadWork, workWords } from "../work"
import { useThread, useThreadsStore, useSummaries } from "../store"
import { useThreadFresh } from "@/app/seen"

// Threads: Owlit's reports on the questions the user asked it, the most recently changed first. A row is
// the title with Owlit's one line on the thread under it, and at the right how many papers and when it last
// changed; the slot says whether Owlit changed it since the user looked. Threads are made and changed in a
// chat, so the page's one button leads there: Chat, with the question that starts one begun in the composer.
export function ThreadsPage() {
  const all = useSummaries()
  const loaded = useThreadsStore((s) => s.loaded)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  // What is typed finds threads by title and one line. Enter opens the first one found, the way a find
  // field does.
  const words = queryWords(query)
  const summaries = words.length ? all.filter((c) => hasAllWords(`${c.title} ${c.one}`, words)) : all
  const enter = () => {
    const first = words.length ? summaries[0] : undefined
    if (first) navigate(`/threads/${first.id}`)
  }
  const findPapers = () => navigate("/chat", { state: { starter: findPrompt() } })
  const starter = t({ message: "Find papers on a question…", comment: "button: opens Chat with the question that starts a thread begun" })
  return (
    <PageShell width="narrow">
      <header className="flex items-center gap-2 px-0.5">
        <PageTitle>{t`Threads`}</PageTitle>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={findPapers}>
          {starter}
        </Button>
      </header>
      <FindField value={query} onChange={setQuery} onEnter={enter} placeholder={t`Find a thread`} label={t`Find a thread`} />
      {loaded && !all.length && !words.length ? (
        <EmptyPlace className="mt-24" title={t`No threads yet`} detail={t`Ask Owlit to find papers on a question; the thread appears here.`}>
          <Button variant="outline" size="sm" onClick={findPapers}>
            {starter}
          </Button>
        </EmptyPlace>
      ) : (
        <div className="mt-6 flex flex-col gap-0.5">
          {summaries.map((c) => (
            <ThreadRow key={c.id} summary={c} />
          ))}
        </div>
      )}
    </PageShell>
  )
}

function ThreadRow({ summary }: { summary: ThreadSummary }) {
  const navigate = useNavigate()
  const thread = useThread(summary.id)
  const groups = useThreadMenu(thread)
  const open = () => navigate(`/threads/${summary.id}`)
  const work = useThreadWork(summary.id)
  const fresh = useThreadFresh(summary.id)
  const running = work.running[0]
  const size = summary.papers ? plural(summary.papers, { one: "# paper", other: "# papers" }) : t({ message: "Found nothing", comment: "a thread whose search found no papers" })

  return (
    <ActionsOnRightClick groups={groups} className="w-56">
      <div
        role="link"
        tabIndex={0}
        onClick={(e) => !(e.target as HTMLElement).closest("button") && open()}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
        className="group/row relative flex min-h-9 cursor-default items-start gap-2 rounded-md py-1.5 pr-1 pl-2.5 text-sm outline-none select-none hover:bg-muted focus-key:bg-muted has-data-[state=open]:bg-muted data-[state=open]:bg-muted"
      >
        {/* The slot keeps titles in line; Owlit's dot fills it while something changed since the user looked.
            While Owlit works on the thread, the second line says so and the slot stays empty. */}
        <span className="-ml-0.5 grid h-5 w-5 shrink-0 place-items-center">
          {running ? null : work.failed ? <StoppedDot label={t`Owlit stopped.`} /> : fresh && <NoteDot />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate leading-5">{summary.title}</span>
          {/* Owlit's one line wraps rather than cuts: in Chinese it is often the whole point of the row */}
          {running ? (
            <span className="text-detail leading-5 text-muted-foreground">
              <span className="shimmer">{workWords()}</span>
            </span>
          ) : (
            summary.one && <span className="line-clamp-2 text-detail leading-5 text-muted-foreground">{summary.one}</span>
          )}
        </span>
        {/* The ⋯ floats over the date's end, which keeps its room, so the title's column never changes width */}
        <span className={cn("flex h-5 shrink-0 items-center pr-1.5 text-detail whitespace-nowrap text-muted-foreground tabular-nums", givesWayToRowMenu)}>
          {size} · {shortDate(summary.updatedAt)}
        </span>
        <RowMenuButton groups={groups} label={t`Thread actions`} menuClassName="w-56" className="absolute top-1.5 right-1" />
      </div>
    </ActionsOnRightClick>
  )
}
