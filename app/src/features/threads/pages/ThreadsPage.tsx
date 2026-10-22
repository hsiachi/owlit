import { plural, t } from "@lingui/core/macro"
import type { Project, ThreadSummary } from "@owlit/protocol"
import { useState } from "react"
import { FindField } from "@/components/find-field"
import { hasAllWords, queryWords } from "@/lib/words"
import { useNavigate } from "react-router-dom"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { EmptyPlace } from "@/components/empty-place"
import { Button } from "@/components/ui/button"
import { findPrompt } from "@/features/chat/lib/starters"
import { GroupLabel } from "@/components/group-label"
import { PageShell, PageTitle } from "@/components/page"
import { NoteDot, StoppedDot } from "@/components/marks"
import { useTakeParam } from "@/hooks/use-take-param"
import { shortDate } from "@/lib/time"
import { useProjects, useProjectsStore } from "@/features/projects/store"
import { useThreadMenu } from "../components/ThreadMenu"
import { useThreadWork, workWords } from "../work"
import { byProject } from "../lib"
import { useThread, useThreadsStore, useSummaries } from "../store"
import { useThreadFresh } from "@/app/seen"

// Threads: Owlit's reports on the questions the user asked it, by project. A row is the title with
// Owlit's one line on the thread under it, and at the right how many papers and when it last changed;
// the slot says whether Owlit changed it since the user looked. Threads are made and changed in a chat,
// so the page's one button leads there: Chat, with the question that starts one begun in the composer.
export function ThreadsPage() {
  const all = useSummaries()
  const loaded = useThreadsStore((s) => s.loaded)
  const projects = useProjects()
  const projectsLoaded = useProjectsStore((s) => s.loaded)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  // What is typed finds threads by title and one line. Enter opens the first one found, the way a find
  // field does.
  const words = queryWords(query)
  const summaries = words.length ? all.filter((c) => hasAllWords(`${c.title} ${c.one}`, words)) : all
  // Until the workspace's projects are known, a thread's project isn't taken for gone
  const groups = byProject(summaries, projectsLoaded ? projects : undefined)
  const enter = () => {
    const first = words.length ? groups[0]?.threads[0] : undefined
    if (first) navigate(`/threads/${first.id}`)
  }
  // The breadcrumb's project opens the list at that project's group
  useTakeParam("project", (at) => document.getElementById(`project-${at}`)?.scrollIntoView({ block: "start" }), { enabled: loaded })
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
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} id={`project-${g.key}`} className="scroll-mt-6">
              {g.label && <GroupLabel>{g.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {g.threads.map((c) => (
                  <ThreadRow key={c.id} summary={c} was={c.was} projects={projects} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  )
}

// was: the project path the thread names, which is no project any more; projects: the workspace's, for its
// menu
function ThreadRow({ summary, was, projects }: { summary: ThreadSummary; was?: string; projects: Project[] }) {
  const navigate = useNavigate()
  const thread = useThread(summary.id)
  const groups = useThreadMenu(thread, projects)
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
          <span className="flex min-w-0 items-baseline gap-2 leading-5">
            <span className="truncate">{summary.title}</span>
            {was && (
              // The thread names a folder that is no project any more (its project.md deleted, or the
              // folder moved): said with the path it names, so the person can find the folder or file it
              // again from the menu. A long title gives way to it, up to about half the row.
              <span className="max-w-[55%] shrink-0 truncate text-detail text-muted-foreground" title={was}>
                {t({ message: `${was} · no project here any more`, comment: "after a thread's title: the folder path the thread was filed under is no project now (its project.md is gone)" })}
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
