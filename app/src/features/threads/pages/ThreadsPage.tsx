import { plural, t } from "@lingui/core/macro"
import type { ThreadSummary } from "@owlit/protocol"
import { useState } from "react"
import { FindField } from "@/components/find-field"
import { hasAllWords, queryWords } from "@/lib/words"
import { useNavigate } from "react-router-dom"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { EmptyPlace } from "@/components/empty-place"
import { GroupLabel } from "@/components/group-label"
import { PageShell, PageTitle } from "@/components/page"
import { NoteDot, StoppedDot } from "@/components/marks"
import { useTakeParam } from "@/hooks/use-take-param"
import { shortDate } from "@/lib/time"
import { useDocsStore } from "@/features/docs/store"
import { useThreadMenu, useProjects } from "../components/ThreadMenu"
import { useThreadWork, workWords } from "../work"
import { byProject } from "../lib"
import { useThread, useThreadsStore, useSummaries } from "../store"
import { useThreadFresh } from "@/app/seen"

// Threads: Owlit's reports on the questions the user asked it, by project. A row is the title with
// Owlit's one line on the thread under it, and at the right how many papers and when it last changed;
// the slot says whether Owlit changed it since the user looked. Threads are made and changed in a chat,
// so the page has nothing to start one with.
export function ThreadsPage() {
  const all = useSummaries()
  const loaded = useThreadsStore((s) => s.loaded)
  const projects = useProjects()
  const docsLoaded = useDocsStore((s) => s.loaded)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  // What is typed finds threads by title and one line. Enter opens the first one found, the way a find
  // field does.
  const words = queryWords(query)
  const summaries = words.length ? all.filter((c) => hasAllWords(`${c.title} ${c.one}`, words)) : all
  // Until the workspace's folders are known, a thread's project isn't taken for gone
  const groups = byProject(summaries, docsLoaded ? projects : undefined)
  const enter = () => {
    const first = words.length ? groups[0]?.threads[0] : undefined
    if (first) navigate(`/threads/${first.id}`)
  }
  // The breadcrumb's project opens the list at that project's group
  useTakeParam("project", (at) => document.getElementById(`project-${at}`)?.scrollIntoView({ block: "start" }), { enabled: loaded })
  return (
    <PageShell width="narrow">
      <header className="px-0.5">
        <PageTitle>{t`Threads`}</PageTitle>
      </header>
      <FindField value={query} onChange={setQuery} onEnter={enter} placeholder={t`Find a thread`} label={t`Find a thread`} />
      {loaded && !all.length && !words.length ? (
        <EmptyPlace className="mt-24" title={t`No threads yet`} detail={t`Ask Owlit in a chat to find papers; the thread appears here.`} />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} id={`project-${g.key}`} className="scroll-mt-6">
              {g.label && <GroupLabel>{g.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {g.threads.map((c) => (
                  <ThreadRow key={c.id} summary={c} was={c.was} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  )
}

// was: the project folder the thread names, which is gone
function ThreadRow({ summary, was }: { summary: ThreadSummary; was?: string }) {
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
        className="group/row flex min-h-9 cursor-default items-start gap-2 rounded-md py-1.5 pr-1 pl-2.5 text-sm outline-none select-none hover:bg-muted focus-key:bg-muted has-data-[state=open]:bg-muted data-[state=open]:bg-muted"
      >
        {/* The slot keeps titles in line; Owlit's dot fills it while something changed since the user looked.
            While Owlit works on the thread, the second line says so and the slot stays empty. */}
        <span className="-ml-0.5 grid h-5 w-5 shrink-0 place-items-center">
          {running ? null : work.failed ? <StoppedDot label={t`Owlit stopped.`} /> : fresh && <NoteDot />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate leading-5">
            {summary.title}
            {was && (
              <span className="ml-2 text-detail text-muted-foreground">
                {t({ message: `was in ${was}`, comment: "a thread whose project folder was renamed or deleted, then that folder's old name" })}
              </span>
            )}
          </span>
          {/* Owlit's one line wraps rather than cuts: in Chinese it is often the whole point of the row */}
          {running ? (
            <span className="text-detail leading-5 text-muted-foreground">
              <span className="shimmer">{workWords()}</span>
            </span>
          ) : (
            summary.one && <span className="line-clamp-2 text-detail leading-5 text-muted-foreground">{summary.one}</span>
          )}
        </span>
        <span className="flex h-5 shrink-0 items-center pr-1.5 text-detail whitespace-nowrap text-muted-foreground tabular-nums group-hover/row:hidden group-focus-key/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">
          {size} · {shortDate(summary.updatedAt)}
        </span>
        <RowMenuButton groups={groups} label={t`Thread actions`} menuClassName="w-56" className="self-start" />
      </div>
    </ActionsOnRightClick>
  )
}
