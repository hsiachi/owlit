import type { Highlight, Paper, PaperNote, PaperOverrides, PaperPatch, PaperRecord, PaperState } from "@owlit/protocol"
import { readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { readJson, readJsonl, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { paperDir, paperStateDir } from "./paths.ts"
import { clean } from "../util.ts"

// The user's side of a paper: .owlit/papers/<id>/ holds state.json and highlights.jsonl (machine state);
// their note is note.md beside the PDF in library/papers/<id>/, where they find it in Finder

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
    citations:
      record.citationCount !== undefined
        ? { count: record.citationCount, source: record.fields.citationCount ?? "", at: record.citationsAt ?? record.fetchedAt ?? 0 }
        : undefined,
    ids: clean({ ...record.ids, ...o.ids }),
    pdf: pdf ? { url: workspaceFileUrl(path.posix.join("library/papers", record.id, "paper.pdf")) } : undefined,
    addedAt: state.addedAt,
    addedBy: state.addedBy,
    starred: state.starred,
    status: state.status,
    tags: state.tags,
    lastOpenedAt: state.lastOpenedAt,
    position: state.position,
    view: state.view,
    digestPosition: state.digestPosition,
    copyOf: state.copyOf,
  })
}

// A change from the app, applied to the state: judgement and position as they are; a field the user
// corrected becomes an override, or stops being one when it is set back to what the record says
export function applyPatch(state: PaperState, record: PaperRecord, patch: PaperPatch): PaperState {
  const next: PaperState = { ...state }
  for (const key of ["starred", "status", "tags", "position", "view", "digestPosition", "lastOpenedAt"] as const) {
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
  return (await readJsonl<Highlight>(highlightsFile(root, id))).map((h) => ({ ...h, paperId: id }))
}

export async function writeHighlights(root: string, id: string, highlights: Highlight[]) {
  if (!highlights.length) return rm(highlightsFile(root, id), { force: true })
  await writeFileAtomic(highlightsFile(root, id), highlights.map((h) => JSON.stringify(h)).join("\n") + "\n")
}

// ---- The note: plain Markdown; mentions are owlit:// links

// The note's path from the workspace root, as agents and the activity journal name it
export const noteRelPath = (id: string) => path.posix.join("library/papers", id, "note.md")

const noteFile = (root: string, id: string) => path.join(paperDir(root, id), "note.md")

// Older workspaces keep the note in .owlit/papers/<id>/, hidden with the machine state, where users don't
// look for their own words. A note still there moves beside the paper the first time it is read or
// written, so nothing is lost and no second copy appears.
async function moveOldNote(root: string, id: string) {
  const old = path.join(paperStateDir(root, id), "note.md")
  const file = noteFile(root, id)
  if (await stat(file).then(() => true, () => false)) return
  if (!(await stat(old).then(() => true, () => false))) return
  await rename(old, file).catch(() => undefined)
}

export async function readNote(root: string, id: string): Promise<PaperNote | undefined> {
  try {
    await moveOldNote(root, id)
    const file = noteFile(root, id)
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)])
    return { paperId: id, content, updatedAt: info.mtimeMs }
  } catch {
    return undefined
  }
}

// An empty note is no file
export async function writeNote(root: string, id: string, content: string): Promise<PaperNote> {
  await moveOldNote(root, id)
  const file = noteFile(root, id)
  if (!content.trim()) {
    await rm(file, { force: true })
    return { paperId: id, content: "", updatedAt: Date.now() }
  }
  await writeFileAtomic(file, content)
  return { paperId: id, content, updatedAt: (await stat(file)).mtimeMs }
}

// How the window reads a file in the workspace (owlit-file://, served by the desktop app)
export const workspaceFileUrl = (relativePath: string) => `owlit-file://workspace/${relativePath.split("/").map(encodeURIComponent).join("/")}`

function same(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return (a ?? undefined) === (b ?? undefined)
}
