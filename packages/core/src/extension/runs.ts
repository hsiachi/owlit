import { pdfWait, type Paper, type PdfRunView, type PdfTry, type WaitId } from "@owlit/protocol"

// Get PDFs (library.fetchPdfs) as core keeps it: which papers went, when, and how far their hand-over
// to the extension got. Kept in memory per workspace (Library), never as running numbers: what the
// window shows (PdfRunView) is counted from the papers each time (classify), so it follows core's word
// for each paper and can't drift from it.

export interface PdfRun {
  id: string
  started: number
  // The papers that went, in order; a second Get PDFs while this one goes on adds to them
  ids: string[]
  // Handed to the extension's queue (each is looked up first, one by one), and those that weren't
  // because no extension was connected by their turn
  handed: Set<string>
  away: Set<string>
  stoppedAt?: number
  endedAt?: number
  dismissedAt?: number
}

// Where one of a run's papers stands
export type RunPlace =
  | { kind: "saved" | "byYou" | "none" | "skipped" | "stopped" | "going" | "away" }
  | { kind: "wait"; wait: WaitId }
  | { kind: "manual"; host?: string }

export interface RunPaper {
  paper: Pick<Paper, "pdf" | "pdfState">
  // Who placed its PDF, when it has one (the record's "pdf" try)
  placedBy?: PdfTry["by"]
}

// connected: an extension is asking for work now; without one, what is in line doesn't move
export function classify(id: string, { paper, placedBy }: RunPaper, run: Pick<PdfRun, "started" | "handed" | "away" | "stoppedAt">, connected: boolean): RunPlace {
  if (paper.pdf) return { kind: placedBy === "person" ? "byYou" : "saved" }
  const s = paper.pdfState
  const ext = s?.extension
  if (ext?.wait) return { kind: "wait", wait: ext.wait }
  if (ext) return { kind: connected ? "going" : "away" }
  // The extension's try, or the user's on the walk through the downloads by hand (Skip) or Stop. One
  // from before the run says nothing of it: the extension hasn't had the paper since.
  if (s?.tried.some((t) => t.by !== "search" && t.at >= run.started)) {
    const wait = pdfWait(paper)
    if (wait === "manual") return { kind: "manual", host: s.reason?.host?.replace(/^www\./, "") }
    if (wait === "skipped" || wait === "stopped") return { kind: wait }
    // Not ended: back with owlit's own look, or waiting for the browser again (the user got through at
    // a wait with no extension connected)
    if (wait && wait !== "finding" && wait !== "offline") return { kind: "none" }
  }
  if (run.stoppedAt !== undefined) return { kind: "stopped" }
  // Handed over, and since in no queue, not out for a try, under no wait, with no try of the run's: it
  // left the extension without an answer (the user got through with no extension to go on, a queue
  // dropped it), and nothing moves it until it is asked for again
  if (run.away.has(id) || run.handed.has(id)) return { kind: "away" }
  // Being looked up before its hand-over
  return { kind: connected ? "going" : "away" }
}

// The run as the window shows it, from its papers (undefined: gone from the library) as they are now
export function runView(run: PdfRun, papers: Map<string, RunPaper | undefined>, connected: boolean, now = Date.now()): PdfRunView {
  const view: PdfRunView = { id: run.id, started: run.started, ids: [], total: 0, saved: 0, byYou: 0, waits: [], manual: { ids: [], sites: [] }, none: 0, skipped: 0, stopped: 0, going: 0, away: 0, running: false }
  const waits = new Map<WaitId, { wait: WaitId; papers: number; ids: string[] }>()
  const sites = new Map<string, number>()
  for (const id of run.ids) {
    const paper = papers.get(id)
    if (!paper) continue
    view.ids.push(id)
    view.total++
    const place = classify(id, paper, run, connected)
    if (place.kind === "wait") {
      const row = waits.get(place.wait) ?? { wait: place.wait, papers: 0, ids: [] }
      row.papers++
      row.ids.push(id)
      waits.set(place.wait, row)
    } else if (place.kind === "manual") {
      view.manual.ids.push(id)
      if (place.host) sites.set(place.host, (sites.get(place.host) ?? 0) + 1)
    } else view[place.kind]++
  }
  view.waits = [...waits.values()].sort((a, b) => b.papers - a.papers)
  view.manual.sites = [...sites].map(([host, papers]) => ({ host, papers })).sort((a, b) => b.papers - a.papers)
  view.running = view.going > 0
  if (!view.running && run.endedAt === undefined) run.endedAt = now
  if (run.stoppedAt !== undefined) view.stoppedAt = run.stoppedAt
  if (run.endedAt !== undefined) view.endedAt = run.endedAt
  return view
}
