import type { PaperIds, PaperRecord } from "@owlit/protocol"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { isPaperId, paperDir, PAPERS_DIR } from "./paths.ts"
import type { Resolution } from "./resolve.ts"
import type { SourceRecord } from "./sources/types.ts"

// library/papers/<id>/paper.json and sources/: what the services said about a paper

export const readRecord = (root: string, id: string) =>
  readJson<PaperRecord>(path.join(paperDir(root, id), "paper.json")).catch(() => undefined)

export const writeRecord = (root: string, record: PaperRecord) =>
  writeJsonAtomic(path.join(paperDir(root, record.id), "paper.json"), record)

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
  private loaded: Promise<void> | undefined
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async load() {
    this.loaded ??= this.scan()
    await this.loaded
  }

  // The paper that has any of these ids
  async find(ids: PaperIds): Promise<string | undefined> {
    await this.load()
    for (const key of keysOf(ids)) {
      const id = this.byKey.get(key)
      if (id) return id
    }
    return undefined
  }

  set(id: string, ids: PaperIds) {
    this.delete(id)
    const keys = keysOf(ids)
    this.keysOf.set(id, keys)
    for (const key of keys) this.byKey.set(key, id)
  }

  delete(id: string) {
    for (const key of this.keysOf.get(id) ?? []) if (this.byKey.get(key) === id) this.byKey.delete(key)
    this.keysOf.delete(id)
  }

  private async scan() {
    let names: string[]
    try {
      names = await readdir(path.join(this.root, PAPERS_DIR))
    } catch {
      return
    }
    for (const name of names) {
      if (!isPaperId(name)) continue
      const record = await readRecord(this.root, name)
      if (record) this.set(name, record.ids)
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
