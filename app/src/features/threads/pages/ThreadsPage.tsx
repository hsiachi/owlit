import { plural, t } from "@lingui/core/macro"
import type { ThreadSize, ThreadSummary } from "@owlit/protocol"
import { useState } from "react"
import { ChoiceMenu } from "@/components/choice-menu"
import { FindField } from "@/components/find-field"
import { hasAllWords, queryWords } from "@/lib/words"
import { useNavigate } from "react-router-dom"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { EmptyPlace } from "@/components/empty-place"
import { GroupLabel } from "@/components/group-label"
import { PageShell, PageTitle } from "@/components/page"
import { RenameInput } from "@/components/rename-input"
import { NoteDot, StoppedDot } from "@/components/marks"
import { useTakeParam } from "@/hooks/use-take-param"
import { shortDate } from "@/lib/time"
import { useThreadMenu, useProjects } from "../components/ThreadMenu"
import { gather, useThreadWork, workWords } from "../work"
import { byProject } from "../lib"
import { editThread, useThread, useThreadsStore, useSummaries } from "../store"
import { useThreadsUi } from "../ui-store"
import { useThreadFresh } from "@/app/seen"

// Threads: what Owlit gathered for the questions the user gave it, by project. A row is the title, how
// many papers (and columns, once it is a table), and when it last changed; the slot says whether Owlit
// changed it since the user looked. No counts beyond that and nothing to clear.
export function ThreadsPage() {
  const all = useSummaries()
  const loaded = useThreadsStore((s) => s.loaded)
  const projects = useProjects()
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const [size, setSize] = useState<ThreadSize>("few")
  // A new thread goes where the user last worked (the most recently changed thread's project)
  // until they pick another
  const [picked, setPicked] = useState<string | null>(null)
  const recent = all[0]?.project ?? ""
  const project = picked ?? (projects.includes(recent) ? recent : "")
  // What is typed finds threads by title. Enter opens the first one found, the way a find field does;
  // collecting papers is its own row under the list, since it starts Owlit on a search in the background.
  const words = queryWords(query)
  const summaries = words.length ? all.filter((c) => hasAllWords(c.title, words)) : all
  const groups = byProject(summaries)
  const question = query.trim()
  const collect = async () => {
    if (!question) return
    if (await gather(question, size, project)) setQuery("")
  }
  const enter = () => {
    const first = words.length ? groups[0]?.threads[0] : undefined
    if (first) navigate(`/threads/${first.id}`)
    else void collect()
  }
  // The breadcrumb's project opens the list at that project's group
  useTakeParam("project", (at) => document.getElementById(`project-${at}`)?.scrollIntoView({ block: "start" }), { enabled: loaded })
  return (
    <PageShell width="narrow">
      <header className="px-0.5">
        <PageTitle>{t`Threads`}</PageTitle>
      </header>
      <FindField value={query} onChange={setQuery} onEnter={enter} placeholder={t`Find a thread, or collect papers on…`} label={t`Find a thread, or collect papers on a question`}>
        {projects.length > 0 && (
          <ChoiceMenu
            value={project}
            onChange={setPicked}
            label={t`Project`}
            options={[{ value: "", label: t({ message: "No project", comment: "a thread that belongs to no project folder" }) }, ...projects.map((p) => ({ value: p, label: p }))]}
            icon={null}
          />
        )}
        <ChoiceMenu
          value={size}
          onChange={setSize}
          label={t`How many papers`}
          options={[
            { value: "few", label: t`About 10 papers` },
            { value: "many", label: t({ message: "As many as it takes", comment: "how many papers to collect: a whole venue or year, up to about 200" }) },
          ]}
          icon={null}
        />
      </FindField>
      {loaded && !all.length && !question ? (
        <EmptyPlace
          className="mt-24"
          title={t`No threads yet`}
          detail={t`Ask Owlit in a chat to find papers on something. What it finds gathers here, with what each paper says about your question.`}
        />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} id={`project-${g.key}`} className="scroll-mt-6">
              {g.label && <GroupLabel>{g.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {g.threads.map((c) => (
                  <ThreadRow key={c.id} summary={c} projects={projects} />
                ))}
              </div>
            </section>
          ))}
          {/* Close under the rows it follows, as one more of them */}
          {question && (
            <div className={summaries.length ? "-mt-5.5" : undefined}>
              <CollectRow question={question} found={summaries.length > 0} onCollect={() => void collect()} />
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}

// Collecting papers on what was typed: a row of its own after what the field found, so it is never the
// surprise behind Enter. With nothing found it is what Enter does, and says so.
function CollectRow({ question, found, onCollect }: { question: string; found: boolean; onCollect: () => void }) {
  return (
    <button
      type="button"
      onClick={onCollect}
      className="flex h-9 w-full cursor-default items-center gap-2 rounded-md pr-2.5 pl-2.5 text-left text-sm outline-none hover:bg-muted focus-key:bg-muted"
    >
      <span className="-ml-0.5 size-5 shrink-0" />
      <span className="min-w-0 truncate">{t`Collect papers on “${question}”`}</span>
      {!found && <span className="ml-auto shrink-0 text-detail text-muted-foreground">{t({ message: "Enter", comment: "the key that does this" })}</span>}
    </button>
  )
}

function ThreadRow({ summary, projects }: { summary: ThreadSummary; projects: string[] }) {
  const navigate = useNavigate()
  const thread = useThread(summary.id)
  const groups = useThreadMenu(thread, projects)
  const renaming = useThreadsUi((s) => s.renaming === summary.id)
  const set = useThreadsUi((s) => s.set)
  const open = () => navigate(`/threads/${summary.id}`)
  const work = useThreadWork(summary.id)
  const fresh = useThreadFresh(summary.id)
  const running = work.running[0]
  const papers = plural(summary.papers, { one: "# paper", other: "# papers" })
  const size = summary.papers
    ? summary.columns
      ? `${papers} · ${plural(summary.columns, { one: "# column", other: "# columns" })}`
      : papers
    : t({ message: "Found nothing", comment: "a thread whose search found no papers" })

  if (renaming) {
    return (
      <RenameInput
        initial={summary.title}
        label={t`Thread name`}
        onDone={(name) => {
          if (name !== null) void editThread(summary.id, { op: "rename", title: name })
          set({ renaming: null })
        }}
        className="h-9 pr-2 pl-[37px]"
      />
    )
  }

  return (
    <ActionsOnRightClick groups={groups} className="w-56">
      <div
        role="link"
        tabIndex={0}
        onClick={(e) => !(e.target as HTMLElement).closest("button") && open()}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
        className="group/row flex h-9 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 text-sm outline-none select-none hover:bg-muted focus-key:bg-muted has-data-[state=open]:bg-muted data-[state=open]:bg-muted"
      >
        {/* The slot keeps titles in line; Owlit's dot fills it while something changed since the user looked.
            While Owlit works on the thread, the row's words say so and the slot stays empty. */}
        <span className="-ml-0.5 grid size-5 shrink-0 place-items-center">
          {running ? null : work.failed ? (
            <StoppedDot label={t`Owlit stopped.`} />
          ) : (
            fresh && <NoteDot />
          )}
        </span>
        <span className="shrink-0 truncate">{summary.title}</span>
        <span className="min-w-0 flex-1 truncate text-detail text-muted-foreground">
          {running ? <span className="shimmer">{workWords(running, thread)}</span> : size}
        </span>
        <span className="shrink-0 pr-1.5 text-detail text-muted-foreground tabular-nums group-hover/row:hidden group-focus-key/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">
          {shortDate(summary.updatedAt)}
        </span>
        <RowMenuButton groups={groups} label={t`Thread actions`} menuClassName="w-56" />
      </div>
    </ActionsOnRightClick>
  )
}
