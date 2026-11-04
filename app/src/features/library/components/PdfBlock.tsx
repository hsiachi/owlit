import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait, Paper } from "@owlit/protocol"
import { XIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { Info } from "@/components/info"
import { WaitingDot } from "@/components/marks"
import { JoinDots } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useExtension, useExtensionWaits, usePdfRun } from "@/features/extension/store"
import { actOnWait, browserName, dismissRun, doneWords, resumeWait, stillWords, stopRun, waitWords, walkManual } from "@/features/extension/waits"
import { libraryNameOf } from "@/features/settings/library-name"
import { useSettings } from "@/features/settings/store"
import { clock } from "@/lib/time"
import { cn } from "@/lib/utils"
import { blockRows, type RowModel } from "../lib/pdf-block-rows"
import { waitsOnYou } from "../lib/pdf-wait"
import { useLibraryStore } from "../store"

// Atop the Library, getting PDFs through the extension in the user's browser, counted by what happens
// next: one row per thing the user can do (sign in, verify, allow, get past a block, download by hand),
// its count, its sentence, the why behind an info icon and one button; then the papers waiting their
// turn. While a Get PDFs is going (core's run, ExtensionView.runs, counted there from the papers), its
// header says how far it got, with Stop; once nothing of it is going any more, the same block is its
// summary until put away. Without one, the sites the extension waits at show as the same rows, amber
// only once the user asked for one of their papers (waitsOnYou).
export function PdfBlock() {
  const run = usePdfRun()
  const papers = useLibraryStore((s) => s.papers)
  const waits = useExtensionWaits()
  const paired = useExtension((s) => s.view?.paired)
  const browser = browserName(paired)
  const library = useSettings((s) => libraryNameOf(s.view?.library.proxy))
  const byPapers = (a: ExtensionWait, b: ExtensionWait) => b.papers - a.papers

  if (run && run.total > 0) {
    const { total, running } = run
    const saved = run.saved + run.byYou
    // Sites waiting for papers outside the run stay in view, under its rows, as they are without one
    const { rows, outside } = blockRows(run, waits, papers)
    const things = rows.filter((r) => r.kind === "wait").length
    const held = rows.reduce((n, r) => (r.kind === "wait" ? n + r.papers : n), 0)
    // "the rest need you" only while there is something of the user's to do
    const yours = things > 0 || run.manual.ids.length > 0 || run.away > 0 || run.closed > 0
    const header = running ? (
      <JoinDots
        items={[
          <span className="text-foreground">{plural(total, { one: `Getting a PDF for # paper using ${browser}…`, other: `Getting PDFs for # papers using ${browser}…` })}</span>,
          t({ message: `${saved} of ${total} saved`, comment: "PDFs saved so far, of the papers in the batch" }),
          ...(things > 0 ? [plural(things, { one: "# thing needs you", other: "# things need you" })] : []),
        ]}
      />
    ) : (
      <JoinDots
        items={[
          <span className="text-foreground">{saved === total ? plural(total, { one: "Saved the PDF", other: "Saved all # PDFs" }) : t`Saved ${saved} of ${total} PDFs`}</span>,
          ...(saved < total && yours ? [t({ message: "the rest need you", comment: "after: Saved 0 of 34 PDFs" })] : []),
        ]}
      />
    )
    return (
      <Block
        mark={things > 0 || (!running && yours) || outside.some((r) => r.kind === "wait" && waitsOnYou(r.wait)) ? <WaitingDot /> : running ? <Spinner className="size-3.5" /> : null}
        header={header}
        action={
          running ? (
            <Button variant="text" size="inline" onClick={() => void stopRun(run)}>
              {t({ message: "Stop", comment: "button: stop getting PDFs through the browser; the papers still in line are left" })}
            </Button>
          ) : (
            <IconButton label={t`Dismiss`} onClick={() => void dismissRun(run)}>
              <XIcon />
            </IconButton>
          )
        }
        bar={running && <Bar total={total} saved={saved} held={held} />}
      >
        {[...rows, ...outside].map((row) => (
          <Row key={row.kind === "wait" ? `wait:${row.wait.id}` : row.kind === "unreachable" ? `unreachable:${row.at}` : row.kind} row={row} browser={browser} library={library} papers={papers} />
        ))}
      </Block>
    )
  }

  if (!waits.length) return null
  const n = waits.reduce((sum, w) => sum + w.papers, 0)
  return (
    <Block mark={waits.some(waitsOnYou) ? <WaitingDot /> : null} header={<span className="text-foreground">{plural(n, { one: "# paper needs you", other: "# papers need you" })}</span>}>
      {[...waits].sort(byPapers).map((wait) => (
        <Row key={`wait:${wait.id}`} row={{ kind: "wait", wait, papers: wait.papers }} browser={browser} library={library} papers={papers} />
      ))}
    </Block>
  )
}

// The block's shape: the header as a status line (StatusLine's mark slot, words and edge action), the bar
// under it, then the rows, their counts in a column of their own so the sentences start at one place
function Block({ mark, header, action, bar, children }: { mark: React.ReactNode; header: React.ReactNode; action?: React.ReactNode; bar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-3 -mb-1 text-detail text-muted-foreground" role="status">
      <div className="flex min-h-7 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">
          {mark && <span className="grid size-3.5 shrink-0 place-items-center">{mark}</span>}
          <span className="truncate">{header}</span>
        </span>
        {action && <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">{action}</span>}
      </div>
      {bar}
      <div className="mt-0.5">{children}</div>
    </section>
  )
}

// How far the batch got: saved in Owlit's green, held at a site for the user in amber, the rest on the
// track. Each part a share of the papers, so a glance says how much is held up.
function Bar({ total, saved, held }: { total: number; saved: number; held: number }) {
  const share = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="mt-1 mb-1 flex h-1 overflow-hidden rounded-full bg-border" aria-hidden>
      <span className="h-full bg-owlit transition-[width] duration-(--t-layout) ease-(--ease)" style={{ width: share(saved) }} />
      <span className="h-full bg-warning transition-[width] duration-(--t-layout) ease-(--ease)" style={{ width: share(held) }} />
    </div>
  )
}

function Row({ row, browser, library, papers }: { row: RowModel; browser: string; library: string | undefined; papers: Record<string, Paper> }) {
  const { papers: n } = row
  let need: string
  let why: string
  let action: React.ReactNode = null
  // The rows of what the user can do read in ink; what only waits, in grey
  let muted = false
  if (row.kind === "wait") {
    const { wait } = row
    const words = waitWords(wait, n, library)
    need = words.need
    why = words.why
    const done = wait.opened && doneWords(wait.kind)
    // owlit tried at once after I've verified it and met the same page: said until the user acts again
    if (wait.retried?.again) {
      need = stillWords(wait, library)
      const again = doneWords(wait.kind) ?? ""
      why = t`owlit tried again just now and met the same page. Open it, finish there, then press ${again}.`
    }
    if (done) {
      const where = wait.opened?.browser ?? browser
      why = wait.kind === "sign-in" ? t`Opened in ${where}. Once you've signed in there, owlit usually notices by itself; if it doesn't, tell it here.` : t`Opened in ${where}. Once you've verified there, owlit usually notices by itself; if it doesn't, tell it here.`
      action = (
        <Button variant="text" size="inline" onClick={() => void resumeWait(wait)}>
          {done}
        </Button>
      )
    } else {
      action = (
        <Button variant="text" size="inline" onClick={() => void actOnWait(wait)}>
          {words.action}
        </Button>
      )
    }
  } else if (row.kind === "manual") {
    need = plural(n, { one: "Needs you to download it", other: "Need you to download them" })
    const sites = row.sites.map((s) => `${s.host} ${s.papers}`).join(" · ")
    why = sites
      ? t`owlit couldn't open these sites' pages: ${sites}. Open each one and click its PDF button; owlit saves it.`
      : t`owlit couldn't open these sites' pages. Open each one and click its PDF button; owlit saves it.`
    const doi = row.ids.map((id) => papers[id]?.ids.doi).find(Boolean)
    if (doi) {
      action = (
        <Button variant="text" size="inline" onClick={() => void walkManual(row.ids, `https://doi.org/${doi}`)}>
          {t({ message: `Open in ${browser}`, comment: "button: opens a paper's page in the browser the owlit extension is in, e.g. Open in Dia" })}
        </Button>
      )
    }
  } else if (row.kind === "closed") {
    need = t({ message: `Waiting for ${browser} to open`, comment: "papers of Get PDFs in line at the owlit extension in the browser (e.g. Dia), which isn't open" })
    why = t`The owlit extension in ${browser} isn't connected. Open ${browser} and these go on by themselves.`
  } else if (row.kind === "away") {
    need = t({ message: `Didn't reach ${browser}`, comment: "papers of Get PDFs the owlit extension in the browser (e.g. Dia) never got, because it wasn't connected" })
    why = t`The owlit extension in ${browser} wasn't connected when their turn came. Open ${browser}, then press Get PDFs again.`
  } else if (row.kind === "none") {
    muted = true
    need = plural(n, { one: "Has no PDF owlit can get", other: "Have no PDF owlit can get" })
    why = t`Their publishers have no PDF of them, or your library doesn't give you access. If you have one, drag it onto the paper.`
  } else if (row.kind === "skipped") {
    muted = true
    need = t({ message: "You found none", comment: "papers the user looked for on the publisher's page and found no PDF (Skip in the browser)" })
    why = t`You looked on their pages in your browser and found no PDF. If you find one later, drag it onto the paper.`
  } else if (row.kind === "stopped") {
    muted = true
    need = t({ message: "Stopped", comment: "the user stopped getting the paper's PDF (Stop on Get PDFs) while it waited for them at its site" })
    why = t`You stopped getting these while they waited for you at their site. Look again on a paper tries it once more.`
  } else if (row.kind === "unreachable") {
    muted = true
    const { at } = row
    const time = clock(row.until)
    // A retry of owlit's own after the run ended: said here, the header staying the run's summary
    need = row.trying
      ? t({ message: `Trying ${at} again…`, comment: "owlit is trying again, by itself, a site that didn't answer the user's browser earlier" })
      : t({ message: `Can't reach ${at} right now · trying again at ${time}`, comment: "the site didn't answer the user's browser; time: when owlit tries it again, e.g. 14:05" })
    if (row.trying) action = <Spinner className="size-3.5" />
    why = t`${at} didn't answer your browser. owlit tries these again by itself, and goes on with the other sites meanwhile; on another network (or a VPN) it may get through.`
  } else if (row.kind === "getting") {
    muted = true
    need = t({ message: "Getting…", comment: "papers whose PDF the owlit extension is fetching in the user's browser right now" })
    why = t`The owlit extension in ${browser} is fetching these now.`
  } else {
    // In line, or being looked up before its hand-over
    muted = true
    need = plural(n, { one: "Waiting its turn", other: "Waiting their turn" })
    why = t`One paper at a time per site, so no publisher sees a burst of downloads`
  }
  return (
    <div className="flex min-h-7 items-center gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("w-7 shrink-0 text-right tabular-nums", muted ? "" : "font-medium text-foreground")}>{n}</span>
        <span className={cn("truncate", !muted && "text-foreground")}>{need}</span>
        <Info>{why}</Info>
      </span>
      {action && <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">{action}</span>}
    </div>
  )
}
