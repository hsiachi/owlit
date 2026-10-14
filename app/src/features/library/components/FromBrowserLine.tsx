import { plural, t } from "@lingui/core/macro"
import { LoaderCircleIcon, XIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { InlineLink } from "@/components/inline-link"
import { Button } from "@/components/ui/button"
import { cancelTask, resumeTask } from "@/features/tasks/store"
import { continueLabel, dismissRun, getInBrowser, showBrowser, stoppedLine, useFromBrowserRun, useLastRun, useStoppedOn, useWaitingForBrowser, type RunTally } from "../from-browser"
import { useLibraryUi } from "../ui-store"

// Getting PDFs from the user's own browser, in the import's place at the top of the Library and on the
// same ladder (DESIGN.md): while it runs, one quiet grey line with how far it has got and Stop; stopped
// on the user, the amber dot and what their browser shows, with Show browser, Stop and Continue (I've
// signed in, for a sign-in). Once it has ended, what it did, each part opening its papers, until put
// away. With no run going, the dot again with the papers not yet tried and Get them, whatever the
// filter: the rail's dot sends the user here, so what it waits for is the first thing on the page, and the
// sentence shows those papers under Needs you.
export function FromBrowserLine() {
  const run = useFromBrowserRun()
  const stoppedOn = useStoppedOn()
  const last = useLastRun()
  const waiting = useWaitingForBrowser()
  const filter = useLibraryUi((s) => s.filter)
  const setFilter = useLibraryUi((s) => s.setFilter)
  if (!run && !last && !waiting.length) return null

  let mark: React.ReactNode = null
  let words: React.ReactNode
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
      words = run.waiting?.detail ?? stoppedLine(stoppedOn)
      actions = (
        <>
          <Button variant="text" size="inline" onClick={() => void showBrowser(stoppedOn?.id)}>
            {t`Show browser`}
          </Button>
          {stop}
          <Button variant="text" size="inline" onClick={() => void resumeTask(run.id)}>
            {continueLabel(stoppedOn)}
          </Button>
        </>
      )
    } else {
      mark = <LoaderCircleIcon className="size-3.5 animate-spin" />
      words = t`Getting PDFs in your browser · ${done} of ${total}`
      actions = stop
    }
  } else if (last) {
    words = <Tally tally={last.tally} />
    actions = (
      <IconButton label={t`Dismiss`} onClick={() => dismissRun(last.task.id)}>
        <XIcon />
      </IconButton>
    )
  } else {
    mark = <span className="size-2 rounded-full bg-warning" />
    const sentence = plural(waiting.length, { one: "# paper waits for your browser", other: "# papers wait for your browser" })
    words = filter === "needs" ? sentence : <InlineLink onClick={() => setFilter("needs")}>{sentence}</InlineLink>
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

// "Got 5 of 9 from Dia · 2 no access · 2 to save from their pages · 1 didn't come", each part showing
// its papers
function Tally({ tally }: { tally: RunTally }) {
  const showOnly = useLibraryUi((s) => s.showOnly)
  const browser = tally.browser
  const got = tally.got.length
  const total = got + tally.noAccess.length + tally.pages.length + tally.missed.length
  const parts: React.ReactNode[] = []
  const part = (ids: string[], words: string, label: string) =>
    parts.push(
      <InlineLink key={label} onClick={() => showOnly(ids, label)}>
        {words}
      </InlineLink>,
    )
  // Nothing came by itself: no "got none", only what is left, under the browser's name
  if (got) part(tally.got, browser ? t`Got ${got} of ${total} from ${browser}` : t`Got ${got} of ${total} from your browser`, t`Got from your browser`)
  if (tally.noAccess.length) part(tally.noAccess, plural(tally.noAccess.length, { one: "# no access", other: "# no access" }), t`No access`)
  if (tally.pages.length) part(tally.pages, plural(tally.pages.length, { one: "# to save from its page", other: "# to save from their pages" }), t`To save from their pages`)
  if (tally.missed.length) part(tally.missed, plural(tally.missed.length, { one: "# didn't come", other: "# didn't come" }), t`Didn't come`)
  return (
    <>
      {!got && <span>{browser ? t`${browser}:` : t`Your browser:`} </span>}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </>
  )
}
