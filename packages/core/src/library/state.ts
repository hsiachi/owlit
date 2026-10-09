import type { Highlight, Paper, PaperNote, PaperOverrides, PaperPatch, PaperRecord, PaperState } from "@owlit/protocol"
import { readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import { readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { paperDir, paperStateDir } from "./paths.ts"

// .owlit/papers/<id>/: state.json, highlights.jsonl, note.md — the user's side of a paper

const METADATA_KEYS = ["title", "authors", "year", "venue", "abstract", "kind"] as const

export const readState = (root: string, id: string) =>
  readJson<PaperState>(path.join(paperStateDir(root, id), "state.json")).catch(() => undefined)

export const writeState = (root: string, id: string, state: PaperState) =>
  writeJsonAtomic(path.join(paperStateDir(root, id), "state.json"), state)

export const freshState = (addedBy: Paper["addedBy"], addedAt = Date.now()): PaperState => ({
  version: 1,
  addedAt,
  addedBy,
  starred: false,
  status: "unread",
  tags: [],
})

// The paper as the app sees it: the record, the user's corrections over it, the user's state beside it
export function toPaper(record: PaperRecord, state: PaperState, pdf: boolean): Paper {
  const o = state.overrides ?? {}
  return clean({
    id: record.id,
    title: o.title ?? record.title,
    authors: o.authors ?? record.authors,
    // An override of null is a field the user cleared
    year: "year" in o ? (o.year ?? undefined) : record.year,
    venue: "venue" in o ? (o.venue ?? undefined) : record.venue,
    abstract: "abstract" in o ? (o.abstract ?? undefined) : record.abstract,
    kind: o.kind ?? record.kind,
    ids: clean({ ...record.ids, ...o.ids }),
    pdf: pdf ? { url: workspaceFileUrl(path.posix.join("library/papers", record.id, "paper.pdf")) } : undefined,
    addedAt: state.addedAt,
    addedBy: state.addedBy,
    starred: state.starred,
    status: state.status,
    tags: state.tags,
    lastOpenedAt: state.lastOpenedAt,
    position: state.position,
  })
}

// A change from the app, applied to the state: judgement and position as they are; a field the user
// corrected becomes an override, or stops being one when it is set back to what the record says
export function applyPatch(state: PaperState, record: PaperRecord, patch: PaperPatch): PaperState {
  const next: PaperState = { ...state }
  for (const key of ["starred", "status", "tags", "position", "lastOpenedAt"] as const) {
    if (key in patch) (next as unknown as Record<string, unknown>)[key] = patch[key]
  }
  const overrides: PaperOverrides = { ...state.overrides }
  for (const key of METADATA_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (same(value, record[key])) delete overrides[key]
    // Cleared is kept as null: undefined would vanish from the file and the record's value come back
    else (overrides as Record<string, unknown>)[key] = value ?? null
  }
  if (patch.ids) {
    const ids = { ...overrides.ids }
    for (const [key, value] of Object.entries(patch.ids) as [keyof PaperRecord["ids"], string | undefined][]) {
      if (same(value, record.ids[key])) delete ids[key]
      else ids[key] = value
    }
    if (Object.keys(ids).length) overrides.ids = ids
    else delete overrides.ids
  }
  if (Object.keys(overrides).length) next.overrides = overrides
  else delete next.overrides
  return clean(next)
}

// ---- Highlights: one JSON object per line, rewritten whole on each change (a paper has dozens)

const highlightsFile = (root: string, id: string) => path.join(paperStateDir(root, id), "highlights.jsonl")

export async function readHighlights(root: string, id: string): Promise<Highlight[]> {
  let text: string
  try {
    text = await readFile(highlightsFile(root, id), "utf8")
  } catch {
    return []
  }
  const highlights: Highlight[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      highlights.push({ ...(JSON.parse(line) as Highlight), paperId: id })
    } catch {
      // A line cut short; the rest still count
    }
  }
  return highlights
}

export async function writeHighlights(root: string, id: string, highlights: Highlight[]) {
  if (!highlights.length) return rm(highlightsFile(root, id), { force: true })
  await writeFileAtomic(highlightsFile(root, id), highlights.map((h) => JSON.stringify(h)).join("\n") + "\n")
}

// ---- The note: plain Markdown; mentions are owlit:// links

const noteFile = (root: string, id: string) => path.join(paperStateDir(root, id), "note.md")

export async function readNote(root: string, id: string): Promise<PaperNote | undefined> {
  try {
    const file = noteFile(root, id)
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)])
    return { paperId: id, content, updatedAt: info.mtimeMs }
  } catch {
    return undefined
  }
}

// An empty note is no file
export async function writeNote(root: string, id: string, content: string): Promise<PaperNote> {
  const file = noteFile(root, id)
  if (!content.trim()) {
    await rm(file, { force: true })
    return { paperId: id, content: "", updatedAt: Date.now() }
  }
  await writeFileAtomic(file, content)
  return { paperId: id, content, updatedAt: (await stat(file)).mtimeMs }
}

export const hasPdf = (root: string, id: string) =>
  stat(path.join(paperDir(root, id), "paper.pdf")).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  )

// How the window reads a file in the workspace (owlit-file://, served by the desktop app)
export const workspaceFileUrl = (relativePath: string) => `owlit-file://workspace/${relativePath.split("/").map(encodeURIComponent).join("/")}`

function same(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return (a ?? undefined) === (b ?? undefined)
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
