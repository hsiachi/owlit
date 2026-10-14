import type { PaperRecord } from "@owlit/protocol"
import { createWriteStream } from "node:fs"
import { rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { HttpError, hostOf, type Http } from "../net/http.ts"
import { paperDir } from "./paths.ts"

// Where a paper's PDF can come from, tried in order until one gives a real PDF. Not finding one is a
// fact about this machine and moment (acquisition.json says what was tried), not an error.

// The largest PDF owlit keeps
const MAX_BYTES = 200 * 1024 * 1024

export type RouteKind = "arxiv" | "upstream" | "api" | "publisher" | "unpaywall" | "browser"

export interface Route {
  kind: RouteKind
  // A name to show: "arxiv", "openalex", "publisher:springer", "unpaywall/repository", "api:elsevier"
  name: string
  url: string
  // Sent with the request and never written down (a publisher's API key)
  headers?: Record<string, string>
}

// The keys of publishers' own APIs, which hand subscribed papers to the university's network without a
// browser or a check: Elsevier's article API and Wiley's text-and-data-mining API
export interface PublisherKeys {
  elsevierApiKey?: string
  wileyTdmToken?: string
}

const ELSEVIER_PREFIXES = ["10.1016/", "10.1006/", "10.1053/", "10.1054/", "10.1067/", "10.1078/", "10.1383/", "10.1529/"]
const WILEY_PREFIXES = ["10.1002/", "10.1111/", "10.1046/", "10.1113/", "10.1034/"]
export const ELSEVIER_API_HOST = "api.elsevier.com"
export const WILEY_API_HOST = "api.wiley.com"

// The publisher's API route for a DOI, when owlit has its key
export function apiRoute(doi: string, keys: PublisherKeys): Route | undefined {
  if (keys.elsevierApiKey && ELSEVIER_PREFIXES.some((p) => doi.startsWith(p))) {
    return {
      kind: "api",
      name: "api:elsevier",
      url: `https://${ELSEVIER_API_HOST}/content/article/doi/${doi}?httpAccept=application/pdf`,
      headers: { "x-els-apikey": keys.elsevierApiKey },
    }
  }
  if (keys.wileyTdmToken && WILEY_PREFIXES.some((p) => doi.startsWith(p))) {
    return {
      kind: "api",
      name: "api:wiley",
      url: `https://${WILEY_API_HOST}/onlinelibrary/tdm/v1/articles/${encodeURIComponent(doi)}`,
      headers: { "wiley-tdm-client-token": keys.wileyTdmToken },
    }
  }
  return undefined
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
  // it), with the page it ended on. Kept across owlit's own looks, until a PDF comes or the user's
  // browser is sent again.
  yourBrowser?: { outcome: "no-access" | "refused"; at: number; host?: string; title?: string }
}

// Direct PDF links publishers give for a DOI without a browser session. {doi} is the DOI, {suffix}
// the part after the "/"; {landing} the page doi.org leads to (costs one request).
const PUBLISHERS: { name: string; prefix: string; pdf: string }[] = [
  { name: "frontiers", prefix: "10.3389/", pdf: "https://www.frontiersin.org/articles/{doi}/pdf" },
  { name: "plos", prefix: "10.1371/journal.pone.", pdf: "https://journals.plos.org/plosone/article/file?id={doi}&type=printable" },
  { name: "bmc", prefix: "10.1186/", pdf: "https://link.springer.com/content/pdf/{doi}.pdf" },
  { name: "springer", prefix: "10.1007/", pdf: "https://link.springer.com/content/pdf/{doi}.pdf" },
  { name: "nature", prefix: "10.1038/", pdf: "https://www.nature.com/articles/{suffix}.pdf" },
  { name: "pnas", prefix: "10.1073/", pdf: "https://www.pnas.org/doi/pdf/{doi}" },
  { name: "science", prefix: "10.1126/", pdf: "https://www.science.org/doi/pdf/{doi}" },
  { name: "acs", prefix: "10.1021/", pdf: "https://pubs.acs.org/doi/pdf/{doi}" },
  { name: "iop", prefix: "10.1088/", pdf: "https://iopscience.iop.org/article/{doi}/pdf" },
  { name: "acm", prefix: "10.1145/", pdf: "https://dl.acm.org/doi/pdf/{doi}" },
  { name: "sage", prefix: "10.1177/", pdf: "https://journals.sagepub.com/doi/pdf/{doi}" },
  { name: "wiley", prefix: "10.1002/", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "wiley", prefix: "10.1111/", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "tandf", prefix: "10.1080/", pdf: "https://www.tandfonline.com/doi/pdf/{doi}" },
  { name: "mdpi", prefix: "10.3390/", pdf: "{landing}/pdf" },
  { name: "jmir", prefix: "10.2196/", pdf: "{landing}/PDF" },
  { name: "biorxiv", prefix: "10.1101/", pdf: "{landing}.full.pdf" },
]

export function publisherOf(doi: string) {
  return PUBLISHERS.filter((p) => doi.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
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
  for (const url of record.pdfUrls ?? []) {
    const route: Route = { kind: url.includes("arxiv.org/") ? "arxiv" : "upstream", name: url.includes("arxiv.org/") ? "arxiv" : "open-access", url }
    if (fresh(route)) yield route
  }
  if (!doi) return
  // The publisher's own API before its site: licensed for this, and never behind a check
  const api = lookups.keys ? apiRoute(doi, lookups.keys) : undefined
  if (api && fresh(api)) yield api
  const publisher = publisherOf(doi)
  if (publisher) {
    const suffix = doi.slice(doi.indexOf("/") + 1)
    let url: string | undefined = publisher.pdf.replace("{doi}", doi).replace("{suffix}", suffix)
    if (url.includes("{landing}")) {
      const landing = await lookups.landing(doi)
      url = landing ? url.replace("{landing}", landing.replace(/\/$/, "")) : undefined
    }
    if (url) {
      const route: Route = { kind: "publisher", name: `publisher:${publisher.name}`, url }
      if (fresh(route)) yield route
    }
  }
  for (const route of await lookups.unpaywall(doi)) if (fresh(route)) yield route
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
  constructor(message: string) {
    super(message)
    this.name = "NotAPdf"
  }
}

// Downloads url to dest when what comes back starts with %PDF-. Written beside dest first, so a
// half-downloaded file never takes its name.
export async function downloadPdf(http: Http, url: string, dest: string, signal?: AbortSignal, headers?: Record<string, string>) {
  const response = await http.get(url, { signal, retries: 1, timeoutMs: 120_000, headers: { accept: "application/pdf,*/*;q=0.8", ...headers } })
  if (!response.body) throw new NotAPdf(`${hostOf(url)} sent nothing.`)
  const declared = Number(response.headers.get("content-length"))
  if (declared > MAX_BYTES) {
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
      if (seen > MAX_BYTES) throw new NotAPdf(`The PDF at ${host} is larger than 200 MB.`)
      if (head.length < 5) {
        head = Buffer.concat([head, Buffer.from(chunk)]).subarray(0, 5)
        if (head.length >= 5 && head.toString("latin1") !== "%PDF-") {
          throw new NotAPdf(type.includes("html") ? `${host} served a web page, not a PDF.` : `${host} didn't send a PDF.`)
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
  return { error: error instanceof Error ? error.message : String(error) }
}
