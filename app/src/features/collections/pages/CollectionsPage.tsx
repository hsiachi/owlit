import { plural, t } from "@lingui/core/macro"
import type { CollectionSize, CollectionSummary } from "@owlit/protocol"
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
import { NoteDot } from "@/components/marks"
import { shortDate } from "@/lib/time"
import { useCollectionMenu, useProjects } from "../components/CollectionMenu"
import { gather, runWords, useCollectionWork } from "../runs"
import { byProject } from "../lib"
import { editCollection, useCollection, useCollectionsStore, useSummaries } from "../store"
import { useCollectionsUi } from "../ui-store"

// Collections: what Owlit gathered for the questions the user gave it, by project. A row is the title, how
// many papers (and columns, once it is a table), and when it last changed; the slot says whether Owlit
// changed it since the user looked. No counts beyond that and nothing to clear.
export function CollectionsPage() {
  const all = useSummaries()
  const loaded = useCollectionsStore((s) => s.loaded)
  const projects = useProjects()
  const [query, setQuery] = useState("")
  const [size, setSize] = useState<CollectionSize>("few")
  const [project, setProject] = useState("")
  // What is typed finds collections by title too; Enter asks Owlit to collect papers on it
  const words = queryWords(query)
  const summaries = words.length ? all.filter((c) => hasAllWords(c.title, words)) : all
  const groups = byProject(summaries)
  const collect = async () => {
    const question = query.trim()
    if (!question) return
    if (await gather(question, size, project)) setQuery("")
  }
  return (
    <PageShell width="narrow">
      <header className="px-0.5">
        <PageTitle>{t`Collections`}</PageTitle>
      </header>
      <FindField value={query} onChange={setQuery} onEnter={() => void collect()} placeholder={t`Collect papers on…`} label={t`Collect papers on a question`}>
        {projects.length > 0 && (
          <ChoiceMenu
            value={project}
            onChange={setProject}
            label={t`Project`}
            options={[{ value: "", label: t({ message: "No project", comment: "a collection that belongs to no project folder" }) }, ...projects.map((p) => ({ value: p, label: p }))]}
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
      {words.length > 0 && !summaries.length && loaded && <p className="mt-6 px-2.5 text-sm text-muted-foreground">{t`Press Enter and Owlit collects papers on it.`}</p>}
      {loaded && !all.length ? (
        <EmptyPlace
          className="mt-24"
          title={t`No collections yet`}
          detail={t`Ask Owlit in a chat to find papers on something. What it finds gathers here, with what each paper says about your question.`}
        />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key}>
              {g.label && <GroupLabel>{g.label}</GroupLabel>}
              <div className="flex flex-col gap-0.5">
                {g.collections.map((c) => (
                  <CollectionRow key={c.id} summary={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function CollectionRow({ summary }: { summary: CollectionSummary }) {
  const navigate = useNavigate()
  const collection = useCollection(summary.id)
  const groups = useCollectionMenu(collection)
  const renaming = useCollectionsUi((s) => s.renaming === summary.id)
  const set = useCollectionsUi((s) => s.set)
  const open = () => navigate(`/collections/${summary.id}`)
  const work = useCollectionWork(summary.id)
  const running = work.running[0]
  const papers = plural(summary.papers, { one: "# paper", other: "# papers" })
  const size = summary.papers
    ? summary.columns
      ? `${papers} · ${plural(summary.columns, { one: "# column", other: "# columns" })}`
      : papers
    : t({ message: "Found nothing", comment: "a collection whose search found no papers" })

  if (renaming) {
    return (
      <RenameInput
        initial={summary.title}
        label={t`Collection name`}
        onDone={(name) => {
          if (name !== null) void editCollection(summary.id, { op: "rename", title: name })
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
        {/* The slot keeps titles in line; Owlit's dot fills it while something changed since the user looked */}
        <span className="-ml-0.5 grid size-5 shrink-0 place-items-center">
          {running ? (
            <span className="size-2 animate-ring-breathe rounded-full bg-muted-foreground motion-reduce:animate-none" />
          ) : work.broken ? (
            <span className="size-2 rounded-full bg-destructive" title={t`Owlit stopped.`} />
          ) : summary.fresh ? (
            <NoteDot />
          ) : (
            <span className="size-2 rounded-full border-[1.5px] border-muted-foreground/55" />
          )}
        </span>
        <span className="shrink-0 truncate">{summary.title}</span>
        <span className="min-w-0 flex-1 truncate text-detail text-muted-foreground">
          {running ? <span className="shimmer">{runWords(running, collection)}</span> : size}
        </span>
        <span className="shrink-0 pr-1.5 text-detail text-muted-foreground tabular-nums group-hover/row:hidden group-focus-key/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">
          {shortDate(summary.updatedAt)}
        </span>
        <RowMenuButton groups={groups} label={t`Collection actions`} menuClassName="w-56" />
      </div>
    </ActionsOnRightClick>
  )
}
