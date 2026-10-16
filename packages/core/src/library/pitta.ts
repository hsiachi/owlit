import { t } from "@lingui/core/macro"
import type { PaperIds, PaperKind, PaperRecord } from "@owlit/protocol"
import { cp, copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { exists, readJson, writeFileAtomic } from "../fs-util.ts"
import { migrate, type Acquisition, type AcquisitionV1 } from "./acquisition.ts"
import { isPaperId, paperDir } from "./paths.ts"
import { cleanDoi, isArxivDoi, parseRef, stripArxivVersion } from "./refs.ts"
import { clean } from "../util.ts"

// A pitta library (~/.pitta) brought into the workspace once. Each papers/<id>/ becomes
// library/papers/<id>/ under the same id: metadata.json → paper.json, the PDF, the raw service
// answers, download.json → acquisition.json, MinerU's parsed.md → text.md (pdfium then adds the
// coordinates), digest.md as it is. The source is only read.

// pitta v2's metadata.json
interface PittaMetadata {
  paper_id?: string
  source?: string
  external_ids?: { arxiv?: string; doi?: string; s2?: string }
  title?: string
  authors?: string[]
  abstract?: string
  published?: string
  pdf_url?: string | null
  doi?: string | null
  venue?: string
  added_at?: string
}

interface PittaDownload {
  attempts?: { route?: string; url?: string; error?: string; status?: number; at?: string }[]
  pdf_source?: string | null
  attempted_at?: string | null
}

// The first line of a text.md taken from pitta: pdfium leaves such a text.md alone
export const LEGACY_TEXT_MARK = "<!-- source: mineru-legacy -->"

export interface PittaPaper {
  id: string
  dir: string
}

// The papers a pitta library holds
export async function pittaPapers(root: string): Promise<PittaPaper[]> {
  const papers = path.join(root, "papers")
  const names = await readdir(papers).catch(() => {
    throw new Error(t`There is no papers folder in ${root}.`)
  })
  const found: PittaPaper[] = []
  for (const name of names.sort()) {
    if (!isPaperId(name)) continue
    const dir = path.join(papers, name)
    if ((await stat(path.join(dir, "metadata.json")).catch(() => undefined))?.isFile()) found.push({ id: name, dir })
  }
  return found
}

// Writes one pitta paper into the workspace; what it brought along
export async function importPittaPaper(root: string, paper: PittaPaper): Promise<{ pdf: boolean; text: boolean; digest: boolean }> {
  const meta = (await readJson<PittaMetadata>(path.join(paper.dir, "metadata.json"))) ?? {}
  const dest = paperDir(root, paper.id)
  await mkdir(dest, { recursive: true })

  const ids = idsOf(paper.id, meta)
  const source = meta.source === "semantic_scholar" ? "s2" : (meta.source ?? "pitta")
  const year = meta.published ? Number(meta.published.slice(0, 4)) : undefined
  const record: PaperRecord = clean({
    version: 1 as const,
    id: paper.id,
    ids,
    title: meta.title?.trim() || paper.id,
    authors: meta.authors ?? [],
    year: Number.isFinite(year) ? year : undefined,
    date: meta.published || undefined,
    venue: meta.venue?.trim() || undefined,
    abstract: meta.abstract?.trim() || undefined,
    kind: kindOf(meta, ids),
    pdfUrls: meta.pdf_url ? [meta.pdf_url] : undefined,
    fields: Object.fromEntries(["title", "authors", "abstract", "venue", "year", "date"].map((f) => [f, `pitta:${source}`])),
    fetchedAt: meta.added_at ? Date.parse(meta.added_at) || undefined : undefined,
  })
  await writeFileAtomic(path.join(dest, "paper.json"), JSON.stringify(record, null, 2) + "\n")

  // The raw answers pitta kept, as they are
  if (await exists(path.join(paper.dir, "sources"))) await cp(path.join(paper.dir, "sources"), path.join(dest, "sources"), { recursive: true })

  const pdf = await exists(path.join(paper.dir, "paper.pdf"))
  if (pdf) await copyFile(path.join(paper.dir, "paper.pdf"), path.join(dest, "paper.pdf"))
  const download = await readJson<PittaDownload>(path.join(paper.dir, "download.json")).catch(() => undefined)
  if (download || pdf) await writeFileAtomic(path.join(dest, "acquisition.json"), JSON.stringify(acquisitionOf(download, pdf, dest), null, 2) + "\n")

  const parsed = await readFile(path.join(paper.dir, "parsed.md"), "utf8").catch(() => undefined)
  if (parsed) await writeFileAtomic(path.join(dest, "text.md"), `${LEGACY_TEXT_MARK}\n\n${parsed}`)

  const digest = await exists(path.join(paper.dir, "digest.md"))
  if (digest) await copyFile(path.join(paper.dir, "digest.md"), path.join(dest, "digest.md"))
  return { pdf, text: !!parsed, digest }
}

function idsOf(id: string, meta: PittaMetadata): PaperIds {
  const ids: PaperIds = {}
  const fromId = parseRef(id)
  if (fromId && fromId.kind !== "url") Object.assign(ids, { [fromId.kind]: fromId.value })
  const external = meta.external_ids ?? {}
  if (external.arxiv) ids.arxiv = stripArxivVersion(external.arxiv)
  const doi = external.doi ?? meta.doi
  if (doi && !isArxivDoi(doi)) ids.doi = cleanDoi(doi)
  if (external.s2) ids.s2 = external.s2.toLowerCase()
  return ids
}

function kindOf(meta: PittaMetadata, ids: PaperIds): PaperKind | undefined {
  if (meta.source === "arxiv" && !ids.doi) return "preprint"
  return undefined
}

// download.json → acquisition.json: what pitta tried, and whether it ended with a PDF. pitta's attempts
// have the shape of owlit's first acquisition.json, so they are read into tries the way that is.
function acquisitionOf(download: PittaDownload | undefined, pdf: boolean, dest: string): Acquisition {
  const tried: AcquisitionV1["tried"] = (download?.attempts ?? []).map((a) => ({
    route: a.route ?? "pitta",
    url: a.url ?? "",
    ...(a.status !== undefined ? { status: a.status } : {}),
    ...(a.error ? { error: a.error } : {}),
    at: (a.at && Date.parse(a.at)) || 0,
  }))
  const at = tried.at(-1)?.at || (download?.attempted_at ? Date.parse(download.attempted_at) : 0) || Date.now()
  return migrate(
    clean({
      version: 1 as const,
      result: pdf ? ("ok" as const) : ("no_pdf" as const),
      route: pdf ? (download?.pdf_source ?? "pitta") : undefined,
      tried,
      at,
      dropHere: path.join(dest, "paper.pdf"),
    }),
  )
}
