import { plural, t } from "@lingui/core/macro"
import type { ExtensionWait, Paper } from "@owlit/protocol"
import { XIcon } from "lucide-react"
import { useMemo } from "react"
import { IconButton } from "@/components/icon-button"
import { Info } from "@/components/info"
import { WaitingDot } from "@/components/marks"
import { JoinDots } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useExtension, useExtensionWaits } from "@/features/extension/store"
import { actOnWait, browserName, doneWords, putAwayBatch, resumeWait, stillWaits, stillWords, stopBatch, useBatch, useOpenedWaits, useRetried, waitWords, walkManual, type OpenedWait, type Retried } from "@/features/extension/waits"
import { libraryNameOf } from "@/features/settings/library-name"
import { useSettings } from "@/features/settings/store"
import { cn } from "@/lib/utils"
import { batchView, outsideRows, siteRows, type BatchRow } from "../lib/pdf-batch"
import { waitsOnYou } from "../lib/pdf-wait"
import { useLibraryStore } from "../store"

// Atop the Library, getting PDFs through the extension in the user's browser, counted by what happens
// next: one row per thing the user can do (sign in, verify, allow, get past a block, download by hand),
// its count, its sentence, the why behind an info icon and one button; then the papers waiting their
// turn. While a batch the user started (Get PDFs) is fetched, its header says how far it got, with Stop;
// once nothing of it is fetched any more, the same block is its summary until put away. Without a batch,
// the sites the extension waits at show as the same rows, amber only once the user asked for one of their
// papers (waitsOnYou).
export function PdfBlock() {
  const batch = useBatch((s) => s.batch)
  const papers = useLibraryStore((s) => s.papers)
  const waits = useExtensionWaits()
  const opened = useOpenedWaits((s) => s.list)
  const retried = useRetried((s) => s.list)
  const paired = useExtension((s) => s.view?.paired)
  const browser = browserName(paired)
  const library = useSettings((s) => libraryNameOf(s.view?.library.proxy))
  const view = useMemo(() => (batch ? batchView(batch, papers) : null), [batch, papers])

  if (view && view.total > 0) {
    const { total, saved, things, running } = view
    // "the rest need you" only while there is something of the user's to do
    const yours = view.rows.some((r) => r.kind !== "none" && r.kind !== "skipped" && r.kind !== "waiting")
    // Sites waiting for papers outside the batch stay in view, under its rows, as they are without one
    const outside = outsideRows(waits, view.rows)
    const outsideOnYou = waits.some((w) => waitsOnYou(w) && outside.some((r) => r.kind === w.kind && r.host === w.host))
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
        mark={things > 0 || (!running && yours) || outsideOnYou ? <WaitingDot /> : running ? <Spinner className="size-3.5" /> : null}
        header={header}
        action={
          running ? (
            <Button variant="text" size="inline" onClick={() => void stopBatch()}>
              {t({ message: "Stop", comment: "button: stop getting PDFs through the browser; the papers still in line are left" })}
            </Button>
          ) : (
            <IconButton label={t`Dismiss`} onClick={putAwayBatch}>
              <XIcon />
            </IconButton>
          )
        }
        bar={running && <Bar total={total} saved={saved} held={view.held} />}
      >
        {[...view.rows, ...outside].map((row) => (
          <Row key={`${row.kind}:${row.host ?? ""}`} row={row} waits={waits} opened={opened} retried={retried} browser={browser} library={library} papers={papers} />
        ))}
      </Block>
    )
  }

  const rows = siteRows(waits)
  if (!rows.length) return null
  const n = rows.reduce((sum, r) => sum + r.papers, 0)
  return (
    <Block mark={waits.some(waitsOnYou) ? <WaitingDot /> : null} header={<span className="text-foreground">{plural(n, { one: "# paper needs you", other: "# papers need you" })}</span>}>
      {rows.map((row) => (
        <Row key={`${row.kind}:${row.host}`} row={row} waits={waits} opened={opened} retried={retried} browser={browser} library={library} papers={papers} />
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

function Row({ row, waits, opened, retried, browser, library, papers }: { row: BatchRow; waits: ExtensionWait[]; opened: OpenedWait[]; retried: Retried[]; browser: string; library: string | undefined; papers: Record<string, Paper> }) {
  const { kind, papers: n } = row
  let need: string
  let why: string
  let action: React.ReactNode = null
  // The rows of what the user can do read in ink; what only waits, in grey
  let muted = false
  if (kind === "manual") {
    need = plural(n, { one: "Needs you to download it", other: "Need you to download them" })
    const sites = (row.sites ?? []).map((s) => `${s.host} ${s.papers}`).join(" · ")
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
  } else if (kind === "none") {
    muted = true
    need = plural(n, { one: "Has no PDF owlit can get", other: "Have no PDF owlit can get" })
    why = t`Their publishers have no PDF of them, or your library doesn't give you access. If you have one, drag it onto the paper.`
  } else if (kind === "skipped") {
    muted = true
    need = t({ message: "You found none", comment: "papers the user looked for on the publisher's page and found no PDF (Skip in the browser)" })
    why = t`You looked on their pages in your browser and found no PDF. If you find one later, drag it onto the paper.`
  } else if (kind === "waiting") {
    muted = true
    need = plural(n, { one: "Waiting its turn", other: "Waiting their turn" })
    // Through the library's proxy every paper is in one line: those behind a paper that waits at a
    // publisher for the user go on once that's done
    const first = row.behind?.[0]
    const host = first?.host
    why = first
      ? plural(first.papers, {
          one: `One paper at a time per site, so no publisher sees a burst of downloads. # of them is in line behind a paper waiting at ${host}, through your library's proxy; it goes on once that's done.`,
          other: `One paper at a time per site, so no publisher sees a burst of downloads. # of them are in line behind a paper waiting at ${host}, through your library's proxy; they go on once that's done.`,
        })
      : t`One paper at a time per site, so no publisher sees a burst of downloads`
  } else {
    const wait = waits.find((w) => w.kind === kind && w.host === row.host)
    const words = waitWords({ kind, host: row.host ?? "", proxied: !!row.proxied }, n, library)
    need = words.need
    why = words.why
    const open = opened.find((o) => o.host === row.host && o.kind === kind)
    const done = open && doneWords(kind)
    // owlit tried at once after I've verified it and met the same page: said until the user acts again
    if (!open && wait && stillWaits(retried, wait)) {
      need = stillWords(wait, library)
      const again = doneWords(kind) ?? ""
      why = t`owlit tried again just now and met the same page. Open it, finish there, then press ${again}.`
    }
    if (done && wait) {
      const where = open.browser ?? browser
      why = kind === "sign-in" ? t`Opened in ${where}. Once you've signed in there, owlit usually notices by itself; if it doesn't, tell it here.` : t`Opened in ${where}. Once you've verified there, owlit usually notices by itself; if it doesn't, tell it here.`
      action = (
        <Button variant="text" size="inline" onClick={() => void resumeWait(wait)}>
          {done}
        </Button>
      )
    } else if (wait) {
      action = (
        <Button variant="text" size="inline" onClick={() => void actOnWait(wait)}>
          {words.action}
        </Button>
      )
    }
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
