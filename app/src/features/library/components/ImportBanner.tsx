import { plural, t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import type { ImportSummary, Task } from "@owlit/protocol"
import { CheckIcon, CircleXIcon, XIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { InlineLink } from "@/components/inline-link"
import { WaitingDot } from "@/components/marks"
import { JoinDots, StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fileName } from "@/lib/names"
import { cancelTask, useTasksStore } from "@/features/tasks/store"
import { answerImport, continueImport, dismissImport, importAsks, undoImport, useAskingImports, useImports } from "../imports"
import { hasCore } from "@/lib/rpc"
import { pdfWait } from "../lib/pdf-wait"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { Spinner } from "@/components/ui/spinner"

// "from Zotero", "from refs.bib", "from the Papers folder"
export function importOrigin(i: Pick<ImportSummary, "source" | "path">) {
  const name = fileName(i.path)
  return i.source === "zotero" ? t`from Zotero` : i.source === "bibtex" ? t`from ${name}` : t`from the ${name} folder`
}

// The import that asks something, else the newest the person hasn't dismissed, at the top of the Library. It sits on the ladder like any
// other work (DESIGN.md): while it runs, one quiet grey line; asking, the same line led by the amber dot
// with its two answers; broken, a red "Stopped" with why in owlit's words and the error behind Details. One
// the person stopped is not an error and stays muted. Once it is done it becomes the one card on the page,
// since a whole thread arriving is news worth seeing, with Show the 104 as its button. It stays until
// dismissed.
export function ImportBanner() {
  const list = useImports((s) => s.list)
  // One that asks comes first, whichever it is: the sidebar's mark and Home's list send the person here
  // to answer it
  const asking = useAskingImports()[0]
  const current = asking ?? list.find((i) => !i.dismissed)
  const task = useTasksStore((s) => (current ? s.byId[current.taskId] : undefined))
  if (!current) return null
  if (current.finishedAt) return <Done summary={current} />
  // Keyed, so an error opened under one import isn't open under the next
  return <Line key={current.id} summary={current} task={task} />
}

function Line({ summary, task }: { summary: ImportSummary; task: Task | undefined }) {
  const [details, setDetails] = useState(false)
  const origin = importOrigin(summary)
  const done = summary.added.length + summary.existed + summary.failed.length
  const total = summary.total
  // A task that came back to the window as finished before the summary did
  const stopped = !task || task.state === "cancelled" || task.state === "failed"
  const broken = task?.state === "failed"
  const asks = !!task && importAsks(task)
  const fresh = total !== undefined ? total - summary.existed : 0

  const dismiss = (
    <Button variant="text" size="inline" onClick={() => void dismissImport(summary.id)}>
      {t({ message: "Dismiss", comment: "verb: put a stopped import away" })}
    </Button>
  )
  const carryOn = (
    <Button variant="text" size="inline" onClick={() => void continueImport(summary.id)}>
      {t({ message: "Continue", context: "carry on with a stopped import" })}
    </Button>
  )

  let mark: React.ReactNode = null
  let words: React.ReactNode
  let actions: React.ReactNode
  if (asks) {
    mark = <WaitingDot />
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
  } else if (broken) {
    mark = <CircleXIcon className="size-3.5 text-destructive" />
    words = (
      <span className="truncate">
        <span className="text-destructive">{t({ message: "Stopped", comment: "an import that broke" })}</span>
        {" · "}
        {total ? t`The import ${origin} couldn't go on after ${done} of ${total}.` : t`The import ${origin} couldn't go on.`}
      </span>
    )
    actions = (
      <>
        {task?.error && (
          <Button variant="text" size="inline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
            {t`Details`}
          </Button>
        )}
        {dismiss}
        {carryOn}
      </>
    )
  } else if (stopped) {
    words = total ? t`Import stopped after ${done} of ${total}` : t`Import stopped`
    actions = (
      <>
        {dismiss}
        {carryOn}
      </>
    )
  } else {
    mark = <Spinner className="size-3.5" />
    words = total === undefined ? t`Reading ${origin}…` : t`Importing ${origin} · ${done} of ${total}`
    actions = (
      <Button variant="text" size="inline" onClick={() => task && void cancelTask(task.id)}>
        {t`Cancel`}
      </Button>
    )
  }
  return (
    <StatusLine
      mark={mark}
      actions={actions}
      below={
        // The error in the library's or the network's own words, a detail as under a broken reply
        details &&
        broken &&
        task?.error && <p className="mt-1 ml-5.5 rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{task.error}</p>
      }
    >
      {words}
    </StatusLine>
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
    if (here.some((p) => pdfWait(p) === "finding")) return null
    return here.filter((p) => !p.pdf).length
  }, [summary.added, papers])

  const parts: React.ReactNode[] = []
  if (summary.existed) parts.push(plural(summary.existed, { one: "# was here already", other: "# were here already" }))
  if (summary.attached) parts.push(plural(summary.attached, { one: "# of those got its PDF", other: "# of those got their PDF" }))
  if (summary.failed.length) parts.push(<Failures key="failed" summary={summary} />)
  if (withoutPdf) parts.push(plural(withoutPdf, { one: "# without a PDF", other: "# without a PDF" }))

  return (
    <div className="mt-4 -mb-1 flex items-center gap-3.5 rounded-xl border bg-card py-3.5 pr-3 pl-4 shadow-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground">
        <CheckIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          {added ? plural(added, { one: `# paper came in ${origin}`, other: `# papers came in ${origin}` }) : t`Nothing new came in ${origin}`}
        </p>
        {parts.length > 0 && (
          <p className="text-detail text-muted-foreground">
            <JoinDots items={parts} />
          </p>
        )}
      </div>
      {added > 0 && hasCore && (
        <Button variant="ghost" size="sm" onClick={() => void undoImport(summary, t`The import ${origin}`)}>
          {t({ message: "Undo", comment: "verb: take back what was just done" })}
        </Button>
      )}
      {added > 0 && (
        <Button size="sm" onClick={() => showOnly(summary.added, t`From this import`)}>
          {plural(added, { one: "Show it", other: "Show the #" })}
        </Button>
      )}
      <IconButton label={t`Dismiss`} onClick={() => void dismissImport(summary.id)}>
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
      <PopoverTrigger asChild>
        <InlineLink>{plural(n, { one: "# couldn't be added", other: "# couldn't be added" })}</InlineLink>
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
