import type { ExtensionWait, Paper, PdfRunView } from "@owlit/protocol"

// The rows of the Library's PDF block while a Get PDFs is up (PdfBlock), as counts: what the block says,
// apart from its words. Every paper of the run is in exactly one row, so the rows and the saved add up to
// the run's papers; a site waiting for papers outside the run shows only those.

export type RowModel =
  | { kind: "wait"; wait: ExtensionWait; papers: number }
  | { kind: "manual"; papers: number; ids: string[]; sites: { host: string; papers: number }[] }
  | { kind: "unreachable"; at: string; until: number; papers: number }
  | { kind: "closed" | "away" | "none" | "skipped" | "stopped" | "getting" | "going"; papers: number }

// rows: the run's, in the order the user can do something about them: its waits (the most papers first,
// as core sorts them), the downloads by hand, the papers waiting for the browser to open and those that
// didn't reach it; then those with no PDF, those the user found none for or stopped, those held back by
// a site that didn't answer, those being fetched now and those waiting their turn. A wait the run counts
// that the waits list doesn't have yet (the two come by one notification, but a paper can be read
// between) has no row until it does.
// outside: the other waits, each with its papers that aren't the run's. A paper of the run under a wait
// is the run's to count, where core put it (PdfRunView.waits, or getting while the papers lag a moment).
export function blockRows(run: PdfRunView, waits: ExtensionWait[], papers: Record<string, Pick<Paper, "pdfState"> | undefined>): { rows: RowModel[]; outside: RowModel[] } {
  const rows: RowModel[] = []
  for (const w of run.waits) {
    const wait = waits.find((one) => one.id === w.wait)
    if (wait) rows.push({ kind: "wait", wait, papers: w.papers })
  }
  if (run.manual.ids.length) rows.push({ kind: "manual", papers: run.manual.ids.length, ids: run.manual.ids, sites: run.manual.sites })
  for (const kind of ["closed", "away", "none", "skipped", "stopped"] as const) if (run[kind]) rows.push({ kind, papers: run[kind] })
  for (const { at, until, papers: n } of run.unreachable) rows.push({ kind: "unreachable", at, until, papers: n })
  for (const kind of ["getting", "going"] as const) if (run[kind]) rows.push({ kind, papers: run[kind] })
  const ofRun = (wait: ExtensionWait) => run.ids.filter((id) => papers[id]?.pdfState?.extension?.wait === wait.id).length
  const outside = waits
    .filter((w) => !run.waits.some((r) => r.wait === w.id))
    .map((wait): RowModel => ({ kind: "wait", wait, papers: wait.papers - ofRun(wait) }))
    .filter((row) => row.papers > 0)
    .sort((a, b) => b.papers - a.papers)
  return { rows, outside }
}
