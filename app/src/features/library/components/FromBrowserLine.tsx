import { plural, t } from "@lingui/core/macro"
import { LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cancelTask, resumeTask } from "@/features/tasks/store"
import { getInBrowser, showBrowser, useFromBrowserRun, useWaitingForBrowser } from "../from-browser"
import { useLibraryUi } from "../ui-store"

// Getting the ACM's PDFs from the user's own browser, in the import's place at the top of the Library and
// on the same ladder (DESIGN.md): while it runs, one quiet grey line with how far it has got and Stop;
// stopped on the user, the amber dot and what their browser may be asking, with Show browser and
// Continue. Under Needs you, with no run going, the dot again with the papers waiting for it and Get them.
export function FromBrowserLine() {
  const run = useFromBrowserRun()
  const waiting = useWaitingForBrowser()
  const filter = useLibraryUi((s) => s.filter)
  if (!run && (filter !== "needs" || !waiting.length)) return null

  let mark: React.ReactNode = null
  let words: string
  let actions: React.ReactNode
  if (run) {
    const done = run.progress?.done ?? 0
    const total = run.progress?.total ?? done
    const stop = (
      <Button variant="text" size="inline" onClick={() => void cancelTask(run.id)}>
        {t({ message: "Stop", comment: "stop getting PDFs from the browser" })}
      </Button>
    )
    if (run.state === "waiting_for_you") {
      mark = <span className="size-2 rounded-full bg-warning" />
      words = run.waiting?.detail ?? t`Your browser may be asking you something.`
      actions = (
        <>
          <Button variant="text" size="inline" onClick={() => void showBrowser()}>
            {t`Show browser`}
          </Button>
          {stop}
          <Button variant="text" size="inline" onClick={() => void resumeTask(run.id)}>
            {t({ message: "Continue", context: "carry on getting PDFs from the browser" })}
          </Button>
        </>
      )
    } else {
      mark = <LoaderCircleIcon className="size-3.5 animate-spin" />
      words = t`Getting ACM PDFs in your browser · ${done} of ${total}`
      actions = stop
    }
  } else {
    mark = <span className="size-2 rounded-full bg-warning" />
    words = plural(waiting.length, { one: "# ACM paper waits for your browser", other: "# ACM papers wait for your browser" })
    actions = (
      <Button variant="text" size="inline" onClick={() => void getInBrowser(waiting.map((p) => p.id))}>
        {plural(waiting.length, { one: "Get it", other: "Get them" })}
      </Button>
    )
  }
  return (
    <div className="mt-3 -mb-1 flex min-h-7 items-center gap-3 text-detail text-muted-foreground" role="status">
      <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">
        {mark && <span className="grid size-3.5 shrink-0 place-items-center">{mark}</span>}
        <span className="truncate">{words}</span>
      </span>
      <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">{actions}</span>
    </div>
  )
}
