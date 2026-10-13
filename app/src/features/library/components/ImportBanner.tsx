import { plural, t } from "@lingui/core/macro"
import { useMemo } from "react"
import type { ImportSummary, Task } from "@owlit/protocol"
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cancelTask, useTasksStore } from "@/features/tasks/store"
import { answerImport, continueImport, dismissImport, useImports } from "../imports"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// "from Zotero", "from refs.bib", "from the Papers folder"
export function importOrigin(i: Pick<ImportSummary, "source" | "path">) {
  const name = i.path.split("/").filter(Boolean).at(-1) ?? i.path
  return i.source === "zotero" ? t`from Zotero` : i.source === "bibtex" ? t`from ${name}` : t`from the ${name} folder`
}

// The newest import the person hasn't put away, at the top of the Library. While it runs it is one quiet
// line (working is grey, DESIGN.md); when it stopped or asks something, the line says so with its one or
// two answers; once it is done it becomes the one card on the page, since a whole collection arriving is
// news worth seeing, with Show the 104 as its button. It stays until put away.
export function ImportBanner() {
  const list = useImports((s) => s.list)
  const current = list.find((i) => !i.dismissed)
  const task = useTasksStore((s) => (current ? s.byId[current.taskId] : undefined))
  if (!current) return null
  if (current.finishedAt) return <Done summary={current} />
  return <Line summary={current} task={task} />
}

function Line({ summary, task }: { summary: ImportSummary; task: Task | undefined }) {
  const origin = importOrigin(summary)
  const done = summary.added.length + summary.existed + summary.failed.length
  const total = summary.total
  // A task that came back to the window as finished before the summary did
  const stopped = !task || task.state === "cancelled" || task.state === "failed"
  const asks = task?.state === "waiting_for_you" && task.waiting?.reason === "confirm_spend"
  const fresh = total !== undefined ? total - summary.existed : 0

  let words: React.ReactNode
  let actions: React.ReactNode
  if (asks) {
    words = plural(fresh, { one: `Import ${origin}: should MinerU read the new paper's PDF?`, other: `Import ${origin}: should MinerU read the PDFs of # new papers?` })
    actions = (
      <>
        <Button variant="text" size="inline" onClick={() => void answerImport(summary.id, true)}>
          {t`Read them`}
        </Button>
        <Button variant="text" size="inline" onClick={() => void answerImport(summary.id, false)}>
          {t`Not this time`}
        </Button>
      </>
    )
  } else if (stopped) {
    words = task?.state === "failed" ? t`The import ${origin} stopped: ${task.error ?? ""}` : total ? t`Import stopped after ${done} of ${total}` : t`Import stopped`
    actions = (
      <>
        <Button variant="text" size="inline" onClick={() => void continueImport(summary.id)}>
          {t({ message: "Continue", comment: "carry on with a stopped import" })}
        </Button>
        <IconButton label={t`Put away`} onClick={() => void dismissImport(summary.id)}>
          <XIcon />
        </IconButton>
      </>
    )
  } else {
    words = (
      <>
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
        {total === undefined ? t`Reading the collection ${origin}…` : t`Importing ${origin} · ${done} of ${total}`}
      </>
    )
    actions = (
      <Button variant="text" size="inline" onClick={() => task && void cancelTask(task.id)}>
        {t`Cancel`}
      </Button>
    )
  }
  return (
    <div className="mt-3 -mb-1 flex min-h-7 items-center gap-3 text-detail text-muted-foreground" role="status">
      <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">{words}</span>
      <span className="flex shrink-0 items-center gap-1">{actions}</span>
    </div>
  )
}

function Done({ summary }: { summary: ImportSummary }) {
  const papers = useLibraryStore((s) => s.papers)
  const showOnly = useLibraryUi((s) => s.showOnly)
  const added = summary.added.length
  const origin = importOrigin(summary)
  // Said once every new paper's PDF lookup has ended, so the number doesn't count down in front of you
  const withoutPdf = useMemo(() => {
    const here = summary.added.map((id) => papers[id]).filter(Boolean)
    if (here.some((p) => !p.pdf && !p.noPdf)) return null
    return here.filter((p) => !p.pdf).length
  }, [summary.added, papers])

  const parts: React.ReactNode[] = []
  if (summary.existed) parts.push(plural(summary.existed, { one: "# was here already", other: "# were here already" }))
  if (summary.failed.length) parts.push(<Failures key="failed" summary={summary} />)
  if (withoutPdf) parts.push(plural(withoutPdf, { one: "# without a PDF", other: "# without a PDF" }))

  return (
    <div className="mt-4 -mb-1 flex items-center gap-3.5 rounded-xl border bg-card py-3.5 pr-3 pl-4 shadow-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-owlit-mark/15 text-owlit-mark">
        <CheckIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          {added ? plural(added, { one: `# paper came in ${origin}`, other: `# papers came in ${origin}` }) : t`Nothing new came in ${origin}`}
        </p>
        {parts.length > 0 && (
          <p className="text-detail text-muted-foreground">
            {parts.map((part, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {part}
              </span>
            ))}
          </p>
        )}
      </div>
      {added > 0 && (
        <Button size="sm" onClick={() => showOnly(summary.added, t`From this import`)}>
          {plural(added, { one: "Show it", other: "Show the #" })}
        </Button>
      )}
      <IconButton label={t`Put away`} onClick={() => void dismissImport(summary.id)}>
        <XIcon />
      </IconButton>
    </div>
  )
}

// "2 couldn't be added", opening which ones and why
function Failures({ summary }: { summary: ImportSummary }) {
  const n = summary.failed.length
  return (
    <Popover>
      <PopoverTrigger className="underline decoration-foreground/30 underline-offset-3 hover:text-foreground">
        {plural(n, { one: "# couldn't be added", other: "# couldn't be added" })}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-96 overflow-y-auto p-3">
        <ul className="flex flex-col gap-2.5 text-detail">
          {summary.failed.map((f) => (
            <li key={f.key}>
              <div className="font-medium">{f.title ?? f.key}</div>
              <div className="text-muted-foreground">{f.error}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
