import { t } from "@lingui/core/macro"
import type { AddPaperBody, ExtensionPaper, Paper, PaperIds } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { z } from "zod"
import type { Library } from "../library/library.ts"
import { isPdfBytes } from "../library/pdf.ts"
import { paperIdOf, parseRef } from "../library/refs.ts"
import { clean } from "../util.ts"
import { HttpFailure } from "./http.ts"

// What the extension asks of the Library: whether a page's paper is in it, adding it, and its PDF

export const shown = (paper: Paper): ExtensionPaper => ({ id: paper.id, title: paper.title, hasPdf: !!paper.pdf })

// The ids a page names: its DOI, its arXiv id, and one found in its address, as the app's Add reads them
export function idsOfPage(page: { doi?: string; arxiv?: string; url?: string }): PaperIds {
  const ids: PaperIds = {}
  for (const [kind, raw] of [["doi", page.doi], ["arxiv", page.arxiv && `arXiv:${page.arxiv.replace(/^arxiv:\s*/i, "")}`], ["url", page.url]] as const) {
    if (!raw?.trim()) continue
    const ref = parseRef(kind === "doi" ? `doi:${raw.replace(/^doi:\s*/i, "")}` : raw)
    if (ref?.kind === "doi" || ref?.kind === "arxiv") ids[ref.kind] ??= ref.value
  }
  return ids
}

// The id of a paper added from a page that resolved to nothing: its address, or else its title, hashed
const localIdOf = (page: { url?: string; title?: string }) => {
  const key = page.url ?? page.title?.trim()
  return key ? `local-${createHash("sha256").update(key).digest("hex").slice(0, 12)}` : undefined
}

// The Library's paper for a page: by the ids it names; for a page that names none, the one added from
// this address, or one with its title
export async function findPaper(library: Library, page: { doi?: string; arxiv?: string; url?: string; title?: string }): Promise<Paper | undefined> {
  const ids = idsOfPage(page)
  const inputs = [ids.doi && `doi:${ids.doi}`, ids.arxiv && `arXiv:${ids.arxiv}`].filter((v): v is string => !!v)
  for (const id of await library.known(inputs)) {
    const paper = id ? await library.get(id) : undefined
    if (paper) return paper
  }
  if (inputs.length) return undefined
  const local = localIdOf(page)
  const added = local ? await library.get(local) : undefined
  if (added) return added
  const title = page.title?.trim()
  const twin = title ? await library.index.twin(title, {}) : undefined
  return twin ? library.get(twin) : undefined
}

export const addBody = z.object({
  doi: z.string().max(400).optional(),
  arxiv: z.string().max(100).optional(),
  url: z.string().max(4096).optional(),
  title: z.string().max(2000).optional(),
  authors: z.array(z.string().max(400)).max(500).optional(),
  year: z.number().int().min(1000).max(3000).optional(),
  venue: z.string().max(1000).optional(),
  pdfUrl: z.string().max(4096).optional(),
})

// The page's paper, added as the app's Add does: looked up by its DOI or arXiv id, else taken as the page
// describes it. One the Library has already is returned as it is.
export async function addPaper(library: Library, body: AddPaperBody): Promise<{ paper: Paper; existed: boolean }> {
  const ids = idsOfPage(body)
  const already = await findPaper(library, body)
  if (already) return { paper: already, existed: true }
  const input = ids.doi ? `doi:${ids.doi}` : ids.arxiv ? `arXiv:${ids.arxiv}` : undefined
  if (input) {
    const looked = await library.resolve(input).catch(() => undefined)
    if (looked) {
      const existing = looked.existingId ? await library.get(looked.existingId) : undefined
      if (existing) return { paper: existing, existed: true }
      return library.addNew(looked.paper)
    }
  }
  // Nothing answered (offline, an id the services don't know): the page's own words stand in, and the
  // paper's details are looked up again later
  const title = body.title?.trim()
  if (!title) throw new HttpFailure(400, "bad-request", t`This page doesn't say which paper it is.`)
  const own = { ...ids, ...(body.url && !ids.doi && !ids.arxiv ? { url: body.url } : {}) }
  const id = paperIdOf(own) ?? localIdOf({ url: body.url, title })!
  return library.addNew(clean({ id, title, authors: body.authors ?? [], ids: own, year: body.year, venue: body.venue?.trim() || undefined }))
}

// Whether a file starts as a PDF does
export async function startsAsPdf(file: string) {
  const handle = await open(file, "r")
  try {
    const head = Buffer.alloc(1024)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return isPdfBytes(head.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
