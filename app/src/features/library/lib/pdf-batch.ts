import type { ExtensionWait, Paper } from "@owlit/protocol"
import { pdfWait } from "./pdf-wait"

// The block atop the Library counts a batch of papers sent to the extension (Get PDFs) by what happens
// next to each: saved; held at a site until the user signs in, verifies, allows or gets past a block; to
// download by hand; with no PDF to be had; or waiting its turn. Worked out from the papers alone, so the
// block follows core's word for each paper and never keeps a count of its own.

export type RowKind = ExtensionWait["kind"] | "manual" | "none" | "waiting"

export interface BatchRow {
  kind: RowKind
  papers: number
  // A site wait's row: the host the wait names (ExtensionWait.host), and whether it is the library's proxy
  host?: string
  proxied?: boolean
  ids: string[]
  // A manual row: how many of its papers are at each site, the most first
  sites?: { host: string; papers: number }[]
}

export interface BatchView {
  // The batch's papers still in the library
  total: number
  saved: number
  // Papers held at a site that waits on the user, and how many such sites ("2 things need you")
  held: number
  things: number
  // Something is still being fetched, or is in line to be: the block says "Getting…" and offers Stop.
  // Otherwise it is the summary.
  running: boolean
  rows: BatchRow[]
}

const ORDER: Record<RowKind, number> = { "sign-in": 0, check: 0, permission: 0, blocked: 0, manual: 1, none: 2, waiting: 3 }

// Where a paper of a batch started at `at` stands. A paper the extension hasn't had yet (the batch's
// papers are handed over one by one, after a look-up each) is still waiting, whatever its record said
// before the batch.
function placeOf(p: Paper, at: number): { kind: RowKind | "saved"; host?: string; proxied?: boolean } {
  if (p.pdf) return { kind: "saved" }
  const ext = p.pdfState?.extension
  if (ext) return ext.waits ? { kind: ext.waits, host: ext.waitsAt ?? ext.host, proxied: !!ext.proxied } : { kind: "waiting" }
  const tried = p.pdfState?.tried.some((t) => t.by === "extension" && t.at >= at)
  if (!tried) return { kind: "waiting" }
  const wait = pdfWait(p)
  if (wait === "manual") return { kind: "manual", host: p.pdfState?.reason?.host?.replace(/^www\./, "") }
  // Back with owlit's own looking, or waiting to be handed to the extension again (after a restart)
  if (!wait || wait === "finding" || wait === "offline" || wait === "for-sign-in" || wait === "for-check" || wait === "for-permission" || wait === "blocked") return { kind: "waiting" }
  return { kind: "none" }
}

export function batchView(batch: { ids: string[]; at: number }, papers: Record<string, Paper>): BatchView {
  let saved = 0
  const rows = new Map<string, BatchRow>()
  const manualSites = new Map<string, number>()
  let total = 0
  for (const id of batch.ids) {
    const p = papers[id]
    if (!p) continue
    total++
    const place = placeOf(p, batch.at)
    if (place.kind === "saved") {
      saved++
      continue
    }
    if (place.kind === "manual" && place.host) manualSites.set(place.host, (manualSites.get(place.host) ?? 0) + 1)
    const key = ORDER[place.kind] === 0 ? `${place.kind}:${place.host}` : place.kind
    const row = rows.get(key)
    if (row) {
      row.papers++
      row.ids.push(id)
    } else rows.set(key, { kind: place.kind, papers: 1, ids: [id], ...(ORDER[place.kind] === 0 ? { host: place.host, proxied: place.proxied } : {}) })
  }
  const manual = rows.get("manual")
  if (manual && manualSites.size) manual.sites = [...manualSites].map(([host, papers]) => ({ host, papers })).sort((a, b) => b.papers - a.papers)
  const sorted = sortRows([...rows.values()])
  const waits = sorted.filter((r) => ORDER[r.kind] === 0)
  return {
    total,
    saved,
    held: waits.reduce((n, r) => n + r.papers, 0),
    things: waits.length,
    running: rows.has("waiting"),
    rows: sorted,
  }
}

// The sites the extension waits at, as the block's rows when no batch is up
export function siteRows(waits: ExtensionWait[]): BatchRow[] {
  return sortRows(waits.map((w) => ({ kind: w.kind, papers: w.papers, ids: [], host: w.host, proxied: w.proxied })))
}

// What the user can do first: the sites that wait on them, the most papers first; then the downloads by
// hand, the papers with none, and those waiting their turn
const sortRows = (rows: BatchRow[]) => rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (ORDER[a.kind] === 0 ? b.papers - a.papers : 0))
