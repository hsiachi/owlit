import type { PaperRecord } from "@owlit/protocol"
import { createWriteStream } from "node:fs"
import { rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { HttpError, hostOf, type Http } from "../net/http.ts"
import { paperDir } from "./paths.ts"
import { fill, publisherOf, type PublisherApi, type PublisherKeys } from "./publisher-table.ts"
import { messageOf } from "../util.ts"

// Where a paper's PDF can come from, tried in order until one gives a real PDF. Not finding one is a
// fact about this machine and moment (acquisition.json says what was tried), not an error.

// The largest PDF owlit keeps
export const PDF_MAX_BYTES = 200 * 1024 * 1024

// Whether these are the first bytes of a PDF
export const isPdfBytes = (head: Uint8Array) => head.length >= 5 && Buffer.from(head.subarray(0, 5)).toString("latin1") === "%PDF-"

export type RouteKind = "arxiv" | "upstream" | "api" | "publisher" | "unpaywall" | "browser"

export interface Route {
  kind: RouteKind
  // A name to show: "arxiv", "openalex", "publisher:springer", "unpaywall/repository", "api:elsevier"
  name: string
  url: string
  // Sent with the request and never written down (a publisher's API key)
  headers?: Record<string, string>
  // Refuses a PDF the route gave that isn't the paper (PublisherApi.verify)
  verify?: PublisherApi["verify"]
  // Found on a page or by title rather than built from the paper's ids: the PDF's first pages must be
  // the paper's before it is kept
  checkTitle?: boolean
}

// The publisher's API route for a DOI, when owlit has its key
export function apiRoute(doi: string, keys: PublisherKeys): Route | undefined {
  const publisher = publisherOf(doi)
  const api = publisher?.api
  const key = api && keys[api.key]
  if (!api || !key) return undefined
  return { kind: "api", name: `api:${publisher.name}`, url: api.url(doi), headers: { [api.header]: key }, ...(api.verify ? { verify: api.verify } : {}) }
}

export interface Attempt {
  route: string
  url: string
  // HTTP status, or 0 when nothing answered
  status?: number
  error?: string
  at: number
}

// library/papers/<id>/acquisition.json
export interface Acquisition {
  version: 1
  result: "ok" | "no_pdf"
  // The route that gave the PDF
  route?: string
  tried: Attempt[]
  at: number
  // Where a PDF found by hand goes
  dropHere: string
  // Of the PDF in place: the same file dropped again is recognised
  sha256?: string
  // The publisher's page wanted a person (a check, a sign-in), and the host whose page it was: the
  // user's own browser is the way. refused: a check came back after the user passed it. browser: the
  // publisher lets only the user's own browser in, which gets the PDF at url.
  needs?: { reason: "challenge" | "login" | "refused" | "browser"; route: string; at: number; host?: string; url?: string }
  // The user's own browser reached the publisher and was told no (refused: the library proxy hasn't got
  // it), with the page it ended on; or it was sent and nothing came (missed). Kept across owlit's own
  // looks and restarts, until a PDF comes or the user's browser is sent again and ends otherwise.
  yourBrowser?: { outcome: "no-access" | "refused" | "missing" | "missed"; at: number; host?: string; title?: string }
  // What owlit's own browser found on the publisher's page when it gave no PDF: an offer to buy, reached
  // through the library's proxy (no-access), or a page that wasn't there (missing). Kept through the
  // plain routes' looks, until owlit's browser looks again.
  looked?: { outcome: "no-access" | "missing"; at: number; host?: string; title?: string }
  // How many looks in a row found no PDF, for spacing out the daily look (library.retryMissingDaily)
  looks?: number
  // When the user's browser was last sent for it, and whether to an article page for them to save the
  // PDF from: their Downloads is looked at from then, across restarts (library.resumeDownloads)
  sentToBrowser?: { at: number; page: boolean }
}

// The routes for a paper, best first, without repeats. Landing pages and Unpaywall cost a request,
// so they are looked up only when the free routes before them have failed.
export async function* routesFor(
  record: PaperRecord,
  lookups: { landing: (doi: string) => Promise<string | undefined>; unpaywall: (doi: string) => Promise<Route[]>; keys?: PublisherKeys },
): AsyncGenerator<Route> {
  const seen = new Set<string>()
  const fresh = (route: Route) => {
    if (seen.has(route.url)) return false
    seen.add(route.url)
    return true
  }
  const { doi, arxiv } = record.ids
  if (arxiv) {
    const route: Route = { kind: "arxiv", name: "arxiv", url: `https://arxiv.org/pdf/${arxiv}` }
    if (fresh(route)) yield route
  }
  // Before the services' links: for ACL's 10.3115 DOIs those point at the ACM, which only lists them
  const acl = aclAnthologyId(record.ids)
  if (acl) {
    const route: Route = { kind: "upstream", name: "acl-anthology", url: `https://aclanthology.org/${acl}.pdf` }
    if (fresh(route)) yield route
  }
  for (const url of record.pdfUrls ?? []) {
    const route: Route = { kind: url.includes("arxiv.org/") ? "arxiv" : "upstream", name: url.includes("arxiv.org/") ? "arxiv" : "open-access", url }
    if (fresh(route)) yield route
  }
  if (!doi) return
  // The publisher's own API before its site: licensed for this, and never behind a check
  const api = lookups.keys ? apiRoute(doi, lookups.keys) : undefined
  if (api && fresh(api)) yield api
  const publisher = publisherOf(doi)
  if (publisher?.pdf) {
    let url: string | undefined = fill(publisher.pdf, doi)
    if (url.includes("{landing}")) {
      const landing = await lookups.landing(doi)
      url = landing ? url.replace("{landing}", landing.replace(/\/$/, "")) : undefined
    }
    if (url) {
      const route: Route = { kind: "publisher", name: `publisher:${publisher.name}`, url }
      if (fresh(route)) yield route
    }
  }
  // OSF's preprints (PsyArXiv, SocArXiv: 10.31234/osf.io/hcn5a) are open, as a file under their id; one
  // that isn't a PDF (a Word manuscript) is turned away like any other
  const osf = /^10\.\d+\/osf\.io\/([a-z0-9]+)$/i.exec(doi)
  if (osf) {
    const route: Route = { kind: "publisher", name: "publisher:osf", url: `https://osf.io/${osf[1]}/download` }
    if (fresh(route)) yield route
  }
  for (const route of await lookups.unpaywall(doi)) if (fresh(route)) yield route
}

// A paper's id in the ACL Anthology, where all of ACL's papers are open: Semantic Scholar's, or the one
// ACL's own DOIs end in (10.18653/v1/2023.acl-long.1). ACL's older DOIs, 10.3115/1654595.1654614, were
// registered by the ACM and are registered to its Digital Library, which lists the papers without
// their PDFs (2026-10-14: "ACM Error: 404"); nothing in them names the Anthology id. The Anthology
// takes its old ids only in capitals (W06-1314), which a lowercased DOI has lost.
export function aclAnthologyId(ids: PaperRecord["ids"]) {
  const id = ids.acl ?? ids.doi?.match(/^10\.18653\/v1\/(.+)$/)?.[1]
  return id?.replace(/^([a-z]\d{2}-\d{4})$/, (old) => old.toUpperCase())
}

// Unpaywall's open copies of a DOI, repositories before publishers. Needs an email to ask.
export async function unpaywallRoutes(http: Http, doi: string, email: string | undefined, signal?: AbortSignal): Promise<Route[]> {
  if (!email) return []
  interface Location {
    url_for_pdf?: string | null
    host_type?: string
  }
  try {
    const answer = await http.json<{ oa_locations?: Location[] }>(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi).replace(/%2F/g, "/")}?email=${encodeURIComponent(email)}`,
      { signal, retries: 1 },
    )
    return (answer.oa_locations ?? [])
      .filter((l): l is Location & { url_for_pdf: string } => !!l.url_for_pdf)
      .sort((a, b) => (a.host_type === "repository" ? 0 : 1) - (b.host_type === "repository" ? 0 : 1))
      .map((l) => ({ kind: "unpaywall", name: `unpaywall/${l.host_type ?? "copy"}`, url: l.url_for_pdf }))
  } catch (error) {
    if (signal?.aborted) throw error
    return []
  }
}

// Where doi.org leads, without reading the page
export async function landingOf(http: Http, doi: string, signal?: AbortSignal) {
  try {
    const response = await http.get(`https://doi.org/${doi}`, { signal, retries: 1, headers: { accept: "text/html" } })
    await response.body?.cancel().catch(() => {})
    return response.url && !response.url.startsWith("https://doi.org/") ? response.url : undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

// The address a DOI is registered to, from doi.org's handle record: where the paper lives now,
// learnt without visiting the publisher
export async function registeredUrl(http: Http, doi: string, signal?: AbortSignal) {
  try {
    const record = await http.json<{ values?: { type?: string; data?: { value?: unknown } }[] }>(
      `https://doi.org/api/handles/${encodeURIComponent(doi)}?type=URL`,
      { signal, retries: 1 },
    )
    const value = record.values?.find((v) => v.type === "URL")?.data?.value
    return typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

// Refused as not being a PDF: an HTML page, a login wall, an empty answer
export class NotAPdf extends Error {
  // The web page that came instead, when one did: a repository's page for the paper may link its PDF
  readonly page?: string
  constructor(message: string, page?: string) {
    super(message)
    this.name = "NotAPdf"
    if (page) this.page = page
  }
}

// Downloads url to dest when what comes back starts with %PDF-. Written beside dest first, so a
// half-downloaded file never takes its name.
export async function downloadPdf(http: Http, url: string, dest: string, signal?: AbortSignal, headers?: Record<string, string>) {
  const response = await http.get(url, { signal, retries: 1, timeoutMs: 120_000, headers: { accept: "application/pdf,*/*;q=0.8", ...headers } })
  // An AWS WAF check (JMIR, 2026-10-15) answers 202 with an empty body and a script for browsers: a check,
  // not an empty file
  if (response.status === 202) {
    await response.body?.cancel().catch(() => {})
    const error = new HttpError(202, url, `${hostOf(response.url || url)} only lets browsers in.`)
    error.finalUrl = response.url || url
    error.challenged = true
    throw error
  }
  if (!response.body) throw new NotAPdf(`${hostOf(url)} sent nothing.`)
  const declared = Number(response.headers.get("content-length"))
  if (declared > PDF_MAX_BYTES) {
    await response.body.cancel().catch(() => {})
    throw new NotAPdf(`The PDF at ${hostOf(url)} is larger than 200 MB.`)
  }
  const part = `${dest}.part`
  let seen = 0
  let head = Buffer.alloc(0)
  const type = response.headers.get("content-type") ?? ""
  const host = hostOf(response.url || url)
  async function* checked(source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      seen += chunk.byteLength
      if (seen > PDF_MAX_BYTES) throw new NotAPdf(`The PDF at ${host} is larger than 200 MB.`)
      if (head.length < 5) {
        head = Buffer.concat([head, Buffer.from(chunk)]).subarray(0, 5)
        if (head.length >= 5 && !isPdfBytes(head)) {
          throw type.includes("html") ? new NotAPdf(`${host} served a web page, not a PDF.`, response.url || url) : new NotAPdf(`${host} didn't send a PDF.`)
        }
      }
      yield chunk
    }
  }
  try {
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), checked, createWriteStream(part))
    if (head.length < 5) throw new NotAPdf(`${host} sent an empty file.`)
    // Cancelled meanwhile (the user attached a PDF): it isn't wanted over theirs
    signal?.throwIfAborted()
    await rename(part, dest)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}

// The PDF a repository's page for a paper names (its citation_pdf_url, or a link to the PDF as an
// alternate form of the page), for an open-access link that leads to the page rather than the file
// (2026-10-15: qucosa's and DORAS's pages; edoc.unibas.ch's names its logo, which isn't a PDF and is
// turned away when downloaded). The page is read up to 2 MB.
export async function pdfNamedOnPage(http: Http, page: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await http.get(page, { signal, retries: 1, headers: { accept: "text/html" } })
    if (!response.body) return undefined
    let html = ""
    const decoder = new TextDecoder()
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      html += decoder.decode(chunk, { stream: true })
      if (html.length > 2 * 1024 * 1024) break
    }
    await response.body.cancel().catch(() => {})
    const found = pdfInHtml(html, response.url || page)
    return found && found !== page ? found : undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

export function pdfInHtml(html: string, page: string) {
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((v) => v !== undefined)
  const candidates: string[] = []
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/^citation_pdf_url$/i.test(attr(tag, "name") ?? attr(tag, "property") ?? "")) candidates.push(attr(tag, "content") ?? "")
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\balternate\b/i.test(attr(tag, "rel") ?? "") && /application\/pdf/i.test(attr(tag, "type") ?? "")) candidates.push(attr(tag, "href") ?? "")
  }
  for (const candidate of candidates) {
    const text = candidate.replace(/&amp;/g, "&").trim()
    if (!text) continue
    try {
      const url = new URL(text, page)
      if (/^https?:$/.test(url.protocol)) return url.toString()
    } catch {
      // Not an address
    }
  }
  return undefined
}

export const acquisitionFile = (root: string, id: string) => path.join(paperDir(root, id), "acquisition.json")

export const readAcquisition = (root: string, id: string) => readJson<Acquisition>(acquisitionFile(root, id)).catch(() => undefined)

export const writeAcquisition = (root: string, id: string, acquisition: Acquisition) => writeJsonAtomic(acquisitionFile(root, id), acquisition)

export const pdfFile = (root: string, id: string) => path.join(paperDir(root, id), "paper.pdf")

export const hasPdfFile = (root: string, id: string) =>
  stat(pdfFile(root, id)).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  )

// One line about an attempt that failed, as acquisition.json keeps it
export function describeFailure(error: unknown): Pick<Attempt, "status" | "error"> {
  if (error instanceof HttpError) return { status: error.status, error: error.message }
  if (error instanceof NotAPdf) return { error: error.message }
  return { error: messageOf(error) }
}
