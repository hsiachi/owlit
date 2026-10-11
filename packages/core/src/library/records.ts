import type { PaperIds, PaperRecord } from "@owlit/protocol"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { isPaperId, paperDir, PAPERS_DIR } from "./paths.ts"
import type { Resolution } from "./resolve.ts"
import { titleKey } from "./sources/crossref.ts"
import type { SourceRecord } from "./sources/types.ts"

// library/papers/<id>/paper.json and sources/: what the services said about a paper

// undefined when missing or not a paper record (another program's half-written file, an empty {})
export async function readRecord(root: string, id: string): Promise<PaperRecord | undefined> {
  const record = await readJson<PaperRecord>(path.join(paperDir(root, id), "paper.json")).catch(() => undefined)
  if (!record || typeof record !== "object" || typeof record.title !== "string" || typeof record.ids !== "object" || !record.ids) return undefined
  return { ...record, authors: Array.isArray(record.authors) ? record.authors : [], fields: record.fields ?? {} }
}

export const writeRecord = (root: string, record: PaperRecord) =>
  writeJsonAtomic(path.join(paperDir(root, record.id), "paper.json"), record)

// The round of checks a record has had. 1 (2026-10-11): titles with their subtitles from Crossref,
// abstracts that belong to another paper dropped, id-only records given their DOI. Raise it when a new
// check should reach the papers already in libraries.
export const METADATA_CHECKS = 1

// Whether a resolution had every check: a published paper's needs Crossref's answer (a search result
// or a failed request lacks it)
export const fullyChecked = (resolution: Resolution) => !resolution.ids.doi || !!resolution.crossrefAnswered

// A resolution as the paper's record. The new answer wins field by field; fields it lacks keep what
// the record had (the services fall silent now and then), and so do ids.
export function recordFrom(id: string, resolution: Resolution, previous?: PaperRecord): PaperRecord {
  const fresh: Partial<PaperRecord> = {
    title: resolution.title,
    authors: resolution.authors,
    year: resolution.year,
    date: resolution.date,
    venue: resolution.venue,
    abstract: resolution.abstract,
    kind: resolution.kind,
    tldr: resolution.tldr,
    citationCount: resolution.citationCount,
  }
  const merged: PaperRecord = {
    ...previous,
    version: 1,
    id,
    ids: { ...previous?.ids, ...resolution.ids },
    title: previous?.title ?? resolution.title,
    authors: previous?.authors ?? [],
    fields: { ...previous?.fields, ...resolution.fields },
    pdfUrls: resolution.pdfUrls.length ? resolution.pdfUrls : previous?.pdfUrls,
    fetchedAt: Date.now(),
  }
  for (const [key, value] of Object.entries(fresh)) {
    if (value === undefined || (Array.isArray(value) && !value.length)) continue
    ;(merged as unknown as Record<string, unknown>)[key] = value
  }
  // A field found wrong (an abstract of another paper) goes, rather than staying as the record had it
  for (const field of Object.keys(resolution.dropped ?? {}) as (keyof typeof fresh & keyof PaperRecord["fields"])[]) {
    if (fresh[field] !== undefined) continue
    delete (merged as unknown as Record<string, unknown>)[field]
    delete merged.fields[field]
  }
  if (fullyChecked(resolution)) merged.checked = METADATA_CHECKS
  return merged
}

// Each service's answer as it came: sources/openalex.json, sources/s2.json, sources/arxiv.xml
export async function keepSources(root: string, id: string, records: SourceRecord[]) {
  const dir = path.join(paperDir(root, id), "sources")
  for (const record of records) {
    await writeFileAtomic(path.join(dir, `${record.source}.${record.raw.trimStart().startsWith("<") ? "xml" : "json"}`), record.raw)
  }
}

// Which paper in the library has a given id, of any kind: a paper added by DOI is found again from its
// arXiv id. Built by reading every paper.json; kept current by add() and paper.metadata.
export class PaperIndex {
  private byKey = new Map<string, string>()
  private keysOf = new Map<string, string[]>()
  // Each paper's title key and ids, for twin()
  private byTitle = new Map<string, Set<string>>()
  private known = new Map<string, { title?: string; ids: PaperIds }>
  private loaded: Promise<void> | undefined
  private lastCatchUp = 0
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async load() {
    this.loaded ??= this.scan()
    await this.loaded
  }

  // The paper that has any of these ids. On a miss, folders the index hasn't read yet are read (at
  // most once a second): the watcher can miss a paper written the moment it started.
  async find(ids: PaperIds): Promise<string | undefined> {
    await this.load()
    const found = this.lookup(ids)
    if (found || Date.now() - this.lastCatchUp < 1000) return found
    this.lastCatchUp = Date.now()
    await this.scan(true)
    return this.lookup(ids)
  }

  private lookup(ids: PaperIds) {
    for (const key of keysOf(ids)) {
      const id = this.byKey.get(key)
      if (id) return id
    }
    return undefined
  }

  // Every paper the index knows
  ids() {
    return [...this.keysOf.keys()]
  }

  // The paper that is this one under another record: the same title, where one of the two has no DOI.
  // Two DOIs with one title are two works (a full paper and its extended abstract, a preprint server's
  // and a journal's); a record without one is a stray copy, as an S2 or OpenAlex id-only record often is.
  // Short titles ("Editorial", "Introduction") say too little to judge by.
  async twin(title: string, ids: PaperIds, self?: string): Promise<string | undefined> {
    await this.load()
    const key = titleKey(title)
    if (key.length < 20) return undefined
    for (const other of this.byTitle.get(key) ?? []) {
      if (other === self) continue
      const theirs = this.known.get(other)?.ids
      if (theirs && (!ids.doi || !theirs.doi)) return other
    }
    return undefined
  }

  set(id: string, ids: PaperIds, title?: string) {
    this.delete(id)
    const keys = keysOf(ids)
    this.keysOf.set(id, keys)
    for (const key of keys) this.byKey.set(key, id)
    this.known.set(id, { ids, title })
    if (title) {
      const key = titleKey(title)
      if (!this.byTitle.has(key)) this.byTitle.set(key, new Set())
      this.byTitle.get(key)!.add(id)
    }
  }

  delete(id: string) {
    for (const key of this.keysOf.get(id) ?? []) if (this.byKey.get(key) === id) this.byKey.delete(key)
    this.keysOf.delete(id)
    const title = this.known.get(id)?.title
    if (title) this.byTitle.get(titleKey(title))?.delete(id)
    this.known.delete(id)
  }

  private async scan(onlyNew = false) {
    let names: string[]
    try {
      names = await readdir(path.join(this.root, PAPERS_DIR))
    } catch {
      return
    }
    for (const name of names) {
      if (!isPaperId(name) || (onlyNew && this.keysOf.has(name))) continue
      const record = await readRecord(this.root, name)
      if (record) this.set(name, record.ids, record.title)
    }
  }
}

function keysOf(ids: PaperIds) {
  const keys: string[] = []
  if (ids.doi) keys.push(`doi:${ids.doi.toLowerCase()}`)
  if (ids.arxiv) keys.push(`arxiv:${ids.arxiv.replace(/v\d+$/, "").toLowerCase()}`)
  if (ids.s2) keys.push(`s2:${ids.s2.toLowerCase()}`)
  if (ids.openalex) keys.push(`openalex:${ids.openalex.toUpperCase()}`)
  return keys
}
