import { GROUPING_COLUMN, relabelReport, type Thread, type ThreadAsked, type ThreadCell, type ThreadColumn, type ThreadGroup, type ThreadPaper, type ThreadRow } from "./threads.ts"

// Threads as older versions kept them, and the one way up to the current version. Version 2 kept a
// snapshot of each paper on its row, a memo of sentences and what the user did to Owlit's text in
// `overrides`; version 1 kept one grouping in `groups`. The upgrade applies the user's changes once into
// the data, so what the user saw is what the thread now holds.

interface RowV2 {
  id: string
  paper: ThreadPaper
  cells: Record<string, ThreadCell>
  in?: Record<string, string[]>
  foundBy?: string
  addedAt: number
}

interface OverridesV2 {
  edits: Record<string, { text: string; at: number; was: string }>
  removed: Record<string, { text: string; at: number }>
  // By "<column>:<paper>:<group>"
  placed: Record<string, { in: boolean; at: number }>
  // By "<column>:<group>": the group it went into
  merged: Record<string, string>
  view?: { groupBy?: string }
}

export interface ThreadV2 {
  version: 2
  id: string
  title: string
  asked: ThreadAsked
  alsoAsked?: ThreadAsked[]
  project: string
  sources: string[]
  memo: { id: string; text: string }[]
  columns: ThreadColumn[]
  rows: RowV2[]
  size?: "few" | "many"
  createdAt: number
  updatedAt: number
  overrides: OverridesV2
  splitFrom?: { id: string; rows: RowV2[]; asked?: ThreadAsked; group?: { column: string; id: string }; copied?: string[] }
}

type RowV1 = Omit<RowV2, "in"> & { group?: string }

export type ThreadV1 = Omit<ThreadV2, "version" | "rows" | "overrides" | "splitFrom"> & {
  version: 1
  groups: ThreadGroup[]
  rows: RowV1[]
  overrides: Pick<OverridesV2, "edits" | "removed">
  splitFrom?: { id: string; rows: RowV1[]; asked?: ThreadAsked }
}

// A thread.json of any version
export type StoredThread = Thread | ThreadV2 | ThreadV1

// The paper snapshots an older thread kept on its rows, by row id, for the rows the user hadn't removed:
// the Library takes those it lacks when the thread is upgraded
export function keptPapers(c: StoredThread): Record<string, ThreadPaper> {
  if (c.version === 3) return {}
  const removed = c.overrides.removed
  return Object.fromEntries(c.rows.filter((r) => !removed[`row:${r.id}`]).map((r) => [r.id, r.paper]))
}

// A thread as it is kept now, from any version
export function upgradeThread(c: StoredThread): Thread {
  if (c.version === 3) return c
  return fromV2(c.version === 1 ? fromV1(c) : c)
}

// Version 1's groups become a hidden grouping column (Topic), each row's group its place there, and a
// renamed group's item gains the column. Which of the rows' groups were the user's moves can't be told
// any more: they all become Owlit's.
function fromV1(c: ThreadV1): ThreadV2 {
  const { groups, splitFrom: _splitFrom, ...rest } = c
  let col: string | undefined
  if (groups.length || c.rows.some((r) => r.group)) {
    col = GROUPING_COLUMN
    for (let n = 2; c.columns.some((x) => x.id === col); n++) col = `${GROUPING_COLUMN}${n}`
  }
  const row = (r: RowV1): RowV2 => {
    const { group, ...kept } = r
    return group && col ? { ...kept, in: { [col]: [group] } } : kept
  }
  const rekey = <T>(items: Record<string, T>) => Object.fromEntries(Object.entries(items).map(([k, v]) => [col && /^group:[^:]+$/.test(k) ? `group:${col}:${k.slice(6)}` : k, v]))
  return {
    ...rest,
    version: 2,
    columns: col ? [...c.columns, { id: col, question: "Topic", kind: "grouping", hidden: true, groups }] : c.columns,
    rows: c.rows.map(row),
    overrides: { edits: rekey(c.overrides.edits), removed: rekey(c.overrides.removed), placed: {}, merged: {} },
  }
}

// What the user saw becomes the data: their rewrites are the text, what they removed is gone, each
// grouping is as they left it. The memo's sentences join into one paragraph, the report; its first
// sentence, without its links, is the thread's one line. The memo named papers by their whole titles,
// which a report's link tokens cut short mid-word: its links are named as a report's are (reportLabel). The size asked for and the record of a split
// have nothing left to serve.
function fromV2(c: ThreadV2): Thread {
  const { edits, removed } = c.overrides
  const text = (item: string, owlit: string) => edits[item]?.text ?? owlit
  const views = c.columns.filter((col) => col.kind === "grouping").map((col) => ({ col, view: groupingView(c.overrides, col) }))
  const papers = new Map(c.rows.map((r) => [r.id, r.paper]))
  const memo = c.memo
    .filter((s) => !removed[`memo:${s.id}`])
    .map((s) => relabelReport(text(`memo:${s.id}`, s.text).trim(), (id) => papers.get(id)))
    .filter(Boolean)
  const rows = c.rows
    .filter((r) => !removed[`row:${r.id}`])
    .map((r): ThreadRow => {
      const placed = Object.fromEntries(views.map(({ col, view }) => [col.id, view.of(r)] as const).filter(([, ids]) => ids.length))
      return {
        id: r.id,
        cells: Object.fromEntries(Object.entries(r.cells).map(([col, cell]) => [col, { ...cell, text: text(`cell:${r.id}:${col}`, cell.text) }])),
        ...(Object.keys(placed).length ? { in: placed } : {}),
        ...(r.foundBy ? { foundBy: r.foundBy } : {}),
        addedAt: r.addedAt,
      }
    })
  return {
    version: 3,
    id: c.id,
    title: text("title", c.title),
    asked: c.asked,
    ...(c.alsoAsked?.length ? { alsoAsked: c.alsoAsked } : {}),
    project: c.project,
    sources: c.sources,
    report: joinSentences(memo),
    one: memo[0] ? plainLine(memo[0]) : "",
    columns: c.columns.map((col) => (col.kind === "grouping" ? { ...col, groups: views.find((v) => v.col === col)!.view.groups } : col)),
    rows,
    ...(c.overrides.view ? { view: c.overrides.view } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

// Sentences as one paragraph: a space after a sentence that ends in Latin punctuation, none after a
// Chinese or Japanese full stop
function joinSentences(sentences: string[]) {
  return sentences.reduce((out, s) => (!out ? s : /[　-〿＀-￯]$/.test(out) ? out + s : `${out} ${s}`), "")
}

// A sentence of Markdown as plain words: a link keeps its label, emphasis and code keep their words
export function plainLine(markdown: string) {
  return markdown
    .replace(/\[((?:\\.|[^\]\\])+)\]\([^)\s]+\)/g, (_, label: string) => label.replace(/\\(.)/g, "$1"))
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

// One grouping as the user of version 2 saw it: Owlit's groups with what the user did laid over them. A
// group they merged sends its papers to the one it went into, one they ungrouped to its parent (or to
// none); a group sits under a top-level group whatever was merged where, so there are two levels at most;
// and a paper is in what Owlit put it in, then what the user put it in or took it out of, latest last. A
// paper in a subgroup is in its parent too, so it isn't also put in the parent itself.
function groupingView(o: OverridesV2, col: ThreadColumn) {
  const { edits, removed, placed, merged } = o
  const defs = new Map((col.groups ?? []).map((g) => [g.id, g]))
  // Where a group's papers are now: itself, or where they went; undefined for nowhere
  const target = (id: string | undefined): string | undefined => {
    const seen = new Set<string>()
    while (id !== undefined && !seen.has(id)) {
      seen.add(id)
      const into = merged[`${col.id}:${id}`]
      if (into !== undefined) id = into
      else if (!defs.has(id)) return undefined
      else if (removed[`group:${col.id}:${id}`]) id = defs.get(id)!.parent
      else return id
    }
    return undefined
  }
  // The top-level group above a live one (or itself)
  const top = (id: string) => {
    const seen = new Set<string>()
    for (let at = id; ; ) {
      seen.add(at)
      const up = target(defs.get(at)?.parent)
      if (up === undefined || seen.has(up)) return at
      at = up
    }
  }
  const parentOf = (g: ThreadGroup) => {
    const p = target(g.parent)
    if (p === undefined || p === g.id) return undefined
    const above = top(p)
    return above === g.id ? undefined : above
  }
  const groups: ThreadGroup[] = (col.groups ?? [])
    .filter((g) => target(g.id) === g.id)
    .map((g) => {
      const { parent: _parent, ...rest } = g
      const parent = parentOf(g)
      return { ...rest, name: edits[`group:${col.id}:${g.id}`]?.text ?? g.name, ...(parent ? { parent } : {}) }
    })
  const parents = new Map(groups.map((g) => [g.id, g.parent]))
  // The user's placements in this grouping, by paper, oldest first
  const byPaper = new Map<string, { group: string; in: boolean; at: number }[]>()
  for (const [key, p] of Object.entries(placed)) {
    if (!key.startsWith(`${col.id}:`)) continue
    const paper = key.slice(col.id.length + 1, key.lastIndexOf(":"))
    const list = byPaper.get(paper) ?? []
    list.push({ group: key.slice(key.lastIndexOf(":") + 1), ...p })
    byPaper.set(paper, list)
  }
  for (const list of byPaper.values()) list.sort((a, b) => a.at - b.at)
  const order = new Map(groups.map((g, i) => [g.id, i]))
  const of = (row: Pick<RowV2, "id" | "in">): string[] => {
    const ids = new Set<string>()
    for (const id of row.in?.[col.id] ?? []) {
      const at = target(id)
      if (at) ids.add(at)
    }
    for (const p of byPaper.get(row.id) ?? []) {
      const at = target(p.group)
      if (!at) continue
      if (p.in) ids.add(at)
      else ids.delete(at)
    }
    for (const id of [...ids]) {
      const parent = parents.get(id)
      if (parent) ids.delete(parent)
    }
    return [...ids].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
  }
  return { groups, of }
}
