import type { PaperIds } from "@owlit/protocol"

// Anything a person might paste to mean a paper, recognised as one identifier. Pure: no network.

export type Ref =
  | { kind: "doi"; value: string }
  | { kind: "arxiv"; value: string }
  | { kind: "s2"; value: string }
  | { kind: "openalex"; value: string }
  | { kind: "url"; value: string }

// 2408.00447 or 0704.0001, with an optional version
const ARXIV_NEW = /(?<![\d.])(\d{4}\.\d{4,5})(?:v\d+)?(?![\d])/
// hep-th/9901001, math.GT/0309136
const ARXIV_OLD = /(?<![\w-])([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?!\d)/
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i
const S2_ID = /^(?:s2[:-])?([0-9a-f]{40})$/i
const OPENALEX_ID = /^(?:openalex:)?(W\d{4,})$/i
// The DOI DataCite gives every arXiv paper
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i

// The identifier in what was pasted, or undefined when it is words rather than a reference
export function parseRef(input: string): Ref | undefined {
  const text = input.trim()
  if (!text) return undefined
  if (/^https?:\/\//i.test(text) || /^(www\.)?[\w-]+(\.[\w-]+)*\.[a-z]{2,}\//.test(text)) return fromUrl(text)

  const own = fromPaperId(text)
  if (own) return own

  const s2 = text.match(S2_ID)
  if (s2) return { kind: "s2", value: s2[1].toLowerCase() }
  const openalex = text.match(OPENALEX_ID)
  if (openalex) return { kind: "openalex", value: openalex[1].toUpperCase() }

  const bare = text.replace(/^arxiv:\s*/i, "")
  const doi = text.replace(/^doi:\s*/i, "").match(DOI)
  if (doi) return doiRef(doi[1])
  if (/\s/.test(bare)) return undefined
  const arxiv = bare.match(ARXIV_NEW) ?? bare.match(ARXIV_OLD)
  if (arxiv && arxiv[0].length >= bare.length - 1) return { kind: "arxiv", value: arxiv[1] }
  return undefined
}

// A library id read back: doi-10.1145-3626772.3657891, arxiv-2408.00447, arxiv-hep-th-9901001, s2-…
function fromPaperId(text: string): Ref | undefined {
  const match = text.match(/^(doi|arxiv|s2|openalex)-(.+)$/i)
  if (!match) return undefined
  const [, kind, rest] = match
  switch (kind.toLowerCase()) {
    case "doi": {
      // The first "-" after the registrant prefix was the "/"
      const doi = rest.match(/^(10\.\d{4,9})-(.+)$/)
      return doi ? { kind: "doi", value: `${doi[1]}/${doi[2]}`.toLowerCase() } : undefined
    }
    case "arxiv": {
      const old = rest.match(/^([a-zA-Z-]+(?:\.[A-Za-z]{2})?)-(\d{7})$/)
      if (old) return { kind: "arxiv", value: `${old[1]}/${old[2]}` }
      return ARXIV_NEW.test(rest) ? { kind: "arxiv", value: stripArxivVersion(rest) } : undefined
    }
    case "s2":
      return /^[0-9a-f]{40}$/i.test(rest) ? { kind: "s2", value: rest.toLowerCase() } : undefined
    default:
      return /^w\d{4,}$/i.test(rest) ? { kind: "openalex", value: rest.toUpperCase() } : undefined
  }
}

function fromUrl(text: string): Ref | undefined {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return undefined
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  const path = decodeURIComponent(url.pathname)

  if (host === "arxiv.org" || host.endsWith(".arxiv.org") || host === "alphaxiv.org") {
    const rest = path.replace(/^\/(abs|pdf|html|format|overview)\//, "").replace(/\.pdf$/i, "")
    const arxiv = rest.match(ARXIV_NEW) ?? rest.match(ARXIV_OLD)
    if (arxiv) return { kind: "arxiv", value: arxiv[1] }
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = path.slice(1).match(DOI)
    if (doi) return doiRef(doi[1])
  }
  if (host === "semanticscholar.org" || host === "api.semanticscholar.org") {
    const id = path.match(/([0-9a-f]{40})(?:\/|$)/i)
    if (id) return { kind: "s2", value: id[1].toLowerCase() }
  }
  if (host === "openalex.org" || host === "api.openalex.org") {
    const id = path.match(/(W\d{4,})/i)
    if (id) return { kind: "openalex", value: id[1].toUpperCase() }
  }
  // Publisher pages carry the DOI in the path: dl.acm.org/doi/10.1145/…, link.springer.com/article/10.1007/…
  const doi = path.match(DOI)
  if (doi) return doiRef(doi[1])
  return { kind: "url", value: url.toString() }
}

function doiRef(raw: string): Ref {
  const doi = cleanDoi(raw)
  const arxiv = doi.match(ARXIV_DOI)
  if (arxiv) return { kind: "arxiv", value: arxiv[1] }
  return { kind: "doi", value: doi }
}

// Lowercase, without trailing punctuation or what a publisher URL adds after it
export function cleanDoi(raw: string) {
  return raw
    .replace(/\/(full|abstract|epdf|pdf|summary|meta|references|figures)$/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[.,;:)\]}>'"]+$/, "")
    .toLowerCase()
}

export const stripArxivVersion = (id: string) => id.replace(/v\d+$/, "")

// The paper's id in the library: its folder name and its owlit://library/ link. DOI first, then
// arXiv, then Semantic Scholar, then OpenAlex.
export function paperIdOf(ids: PaperIds): string | undefined {
  if (ids.doi) return `doi-${safe(ids.doi)}`
  if (ids.arxiv) return `arxiv-${safe(stripArxivVersion(ids.arxiv))}`
  if (ids.s2) return `s2-${ids.s2.toLowerCase()}`
  if (ids.openalex) return `openalex-${ids.openalex.toLowerCase()}`
  return undefined
}

// A path segment: "/" becomes "-", anything a file system might object to becomes "_"
function safe(value: string) {
  return value.toLowerCase().replace(/\//g, "-").replace(/[^a-z0-9._-]/g, "_")
}

// The id to ask the services by, best first: what paper.metadata looks a paper up with
export function refOfIds(ids: PaperIds): Ref | undefined {
  if (ids.doi) return { kind: "doi", value: ids.doi }
  if (ids.arxiv) return { kind: "arxiv", value: ids.arxiv }
  if (ids.s2) return { kind: "s2", value: ids.s2 }
  if (ids.openalex) return { kind: "openalex", value: ids.openalex }
  return undefined
}
