import { plural, t } from "@lingui/core/macro"
import { XIcon } from "lucide-react"
import { useMemo } from "react"
import { IconButton } from "@/components/icon-button"
import { InlineLink } from "@/components/inline-link"
import { WaitingDot } from "@/components/marks"
import { JoinDots, StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { dismissRun, getInBrowser, useFromBrowser, useLastRun, useMightComeThroughBrowser, type RunTally } from "../from-browser"
import { noPdfReason } from "../lib/filter"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { Spinner } from "@/components/ui/spinner"

// Getting PDFs from the user's own browser, in the import's place at the top of the Library and on the
// same ladder (DESIGN.md): while it runs, one quiet grey line with how far it has got and Stop; stopped
// on the user, the amber dot and what their browser shows, with Show browser, Stop and Continue (I've
// signed in, for a sign-in). Once it has ended, what it did, each part opening its papers, until put
// away. With no run going, the dot again with the papers not yet tried and Get them, whatever the
// filter: the rail's dot sends the user here, so what it waits for is the first thing on the page, and the
// sentence shows those papers under Needs you. Article pages still open for the user to save from are
// named after them. Home's row says the same from the same view (useFromBrowser).
export function FromBrowserLine() {
  const { run, waiting, pages } = useFromBrowser()
  const last = useLastRun()
  const filter = useLibraryUi((s) => s.filter)
  const setFilter = useLibraryUi((s) => s.setFilter)
  const showOnly = useLibraryUi((s) => s.showOnly)
  if (!run && !last && !waiting.length && !pages.length) return null

  let mark: React.ReactNode = null
  let words: React.ReactNode
  let actions: React.ReactNode
  if (run) {
    const { done, total } = run
    const stop = (
      <Button variant="text" size="inline" onClick={run.stop.run}>
        {run.stop.label}
      </Button>
    )
    if (run.stopped) {
      mark = <WaitingDot />
      words = run.detail ?? run.what
      actions = (
        <>
          <Button variant="text" size="inline" onClick={run.show}>
            {t`Show browser`}
          </Button>
          {stop}
          {run.resume && (
            <Button variant="text" size="inline" onClick={run.resume.run}>
              {run.resume.label}
            </Button>
          )}
        </>
      )
    } else {
      mark = <Spinner className="size-3.5" />
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
    mark = <WaitingDot />
    const sentence = plural(waiting.length, { one: "# paper waits for your browser", other: "# papers wait for your browser" })
    const toSave = plural(pages.length, { one: "# to save from its page", other: "# to save from their pages" })
    const pagesLink = (
      <InlineLink onClick={() => showOnly(pages.map((p) => p.id), t`To save from their pages`)}>{toSave}</InlineLink>
    )
    words = (
      <JoinDots
        items={[
          ...(waiting.length > 0 ? [filter === "needs" ? sentence : <InlineLink key="waiting" onClick={() => setFilter("needs")}>{sentence}</InlineLink>] : []),
          ...(pages.length > 0 ? [pagesLink] : []),
        ]}
      />
    )
    actions = waiting.length > 0 && (
      <Button variant="text" size="inline" onClick={() => void getInBrowser(waiting.map((p) => p.id))}>
        {plural(waiting.length, { one: "Get it", other: "Get them" })}
      </Button>
    )
  }
  return (
    <StatusLine mark={mark} actions={actions}>
      <span className="truncate">{words}</span>
    </StatusLine>
  )
}

// Under the No PDF filter, the papers that might still come through the user's browser, though owlit
// doesn't expect them to (it found nothing for them): a quiet grey line, no dot, under the amber one
// when that shows. Once tried there, each says what its tab ended on and leaves this count.
export function NoPdfLine() {
  const papers = useLibraryStore((s) => s.papers)
  const total = useMemo(() => Object.values(papers).filter((p) => !!noPdfReason(p)).length, [papers])
  const maybe = useMightComeThroughBrowser()
  const showOnly = useLibraryUi((s) => s.showOnly)
  if (!maybe.length) return null
  const all = plural(total, { one: "# paper without a PDF", other: "# papers without a PDF" })
  const might = plural(maybe.length, { one: "# might come through your browser", other: "# might come through your browser" })
  return (
    <div className="mt-3 -mb-1 flex min-h-7 items-center gap-3 text-detail text-muted-foreground" role="status">
      <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">
        <span className="truncate">
          {all}
          {" · "}
          <InlineLink onClick={() => showOnly(maybe.map((p) => p.id), t`Might come through your browser`)}>{might}</InlineLink>
        </span>
      </span>
      <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">
        <Button variant="text" size="inline" onClick={() => void getInBrowser(maybe.map((p) => p.id))}>
          {plural(maybe.length, { one: "Try it in your browser", other: "Try them in your browser" })}
        </Button>
      </span>
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
      <JoinDots items={parts} />
    </>
  )
}
