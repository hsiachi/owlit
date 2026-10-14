import type { ProxySettings } from "@owlit/protocol"
import { hostOf } from "../net/http.ts"

// Where a browser goes for a paper the plain routes couldn't get: the publisher's article page,
// directly and then through the library's proxy. From pitta's measured table; any other DOI goes
// through doi.org and the page's own citation_pdf_url.
//
// A DOI's prefix names who first published it, not where it lives now: journals change publishers
// (Current Directions in Psychological Science's 10.1111 DOIs are at SAGE, Annals of Behavioral
// Medicine's 10.1007 ones at OUP) and publishers take in others' (ACL's 10.3115 at the ACM). So the row
// follows the site the DOI is registered to when that's known, and the hidden window may visit that
// site: before, doi.org sending it to BMJ, APA or PubMed Central was stopped as a host it didn't know
// (2026-10-10: 9 of 25 papers without a PDF in one literature review).

interface Row {
  name: string
  prefix: string
  // The sites (registrable domains) its DOIs are registered to
  sites: string[]
  landing: string
  pdf?: string
  // A publisher that hands its PDFs only to the user's own browser: the address that browser saves the
  // PDF from. owlit's browser doesn't go there at all.
  ownBrowser?: string
}

// The ACM: Cloudflare in front of the Digital Library puts a new check in front of owlit's browser
// every time one is passed (2026-10-13), on campus and off, while the user's own browser is let
// straight through. Its PDFs have been open access since 2026-01-01, so a reader's browser gets every
// one; ?download=true has it saved rather than shown (2026-10-14: ten in a row through Dia, 2–12 s
// each, none checked).
const ROWS: Row[] = [
  {
    name: "acm",
    prefix: "10.1145/",
    sites: ["acm.org"],
    landing: "https://dl.acm.org/doi/{doi}",
    pdf: "https://dl.acm.org/doi/pdf/{doi}",
    ownBrowser: "https://dl.acm.org/doi/pdf/{doi}?download=true",
  },
  { name: "sage", prefix: "10.1177/", sites: ["sagepub.com"], landing: "https://journals.sagepub.com/doi/{doi}", pdf: "https://journals.sagepub.com/doi/pdf/{doi}" },
  { name: "wiley", prefix: "10.1002/", sites: ["wiley.com"], landing: "https://onlinelibrary.wiley.com/doi/{doi}", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "wiley", prefix: "10.1111/", sites: ["wiley.com"], landing: "https://onlinelibrary.wiley.com/doi/{doi}", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "tandf", prefix: "10.1080/", sites: ["tandfonline.com"], landing: "https://www.tandfonline.com/doi/full/{doi}", pdf: "https://www.tandfonline.com/doi/pdf/{doi}" },
  { name: "springer", prefix: "10.1007/", sites: ["springer.com"], landing: "https://link.springer.com/article/{doi}", pdf: "https://link.springer.com/content/pdf/{doi}.pdf" },
  { name: "elsevier", prefix: "10.1016/", sites: ["elsevier.com", "sciencedirect.com", "sciencedirectassets.com"], landing: "https://doi.org/{doi}" },
  { name: "ieee", prefix: "10.1109/", sites: ["ieee.org"], landing: "https://doi.org/{doi}" },
]

// Publishers' hosts the hidden window may visit; doi.org sends readers on to one of these
export const PUBLISHER_HOSTS = [
  "doi.org",
  "dl.acm.org",
  "journals.sagepub.com",
  "onlinelibrary.wiley.com",
  "www.tandfonline.com",
  "link.springer.com",
  "linkinghub.elsevier.com",
  "www.sciencedirect.com",
  "pdf.sciencedirectassets.com",
  "ieeexplore.ieee.org",
  "www.nature.com",
  "www.science.org",
  "pubs.acs.org",
  "academic.oup.com",
  "www.cambridge.org",
  "www.jstor.org",
  "www.emerald.com",
  "www.mdpi.com",
  "iopscience.iop.org",
  "www.pnas.org",
  "arxiv.org",
]

export interface BrowserRoute {
  name: string
  landing: string
  pdf?: string
  allowHosts: string[]
  // The publisher's sites, as far as they are known before visiting (Elsevier's DOIs are registered to
  // elsevier.com and read at sciencedirect.com): what owlit's visits to it are paced and held by
  sites: string[]
  // Only the user's own browser gets the PDF, from this address (Row.ownBrowser)
  ownBrowser?: string
}

// Direct first; through the proxy when one is set up. `registered` is the address the DOI is registered
// to (doi.org's handle record), when it could be looked up.
export function browserRoutes(doi: string, proxy: ProxySettings | undefined, registered?: string): BrowserRoute[] {
  const site = registered ? siteOf(hostOf(registered)) : undefined
  const row = rowFor(doi, site)
  const fill = (template: string) => template.replace("{doi}", doi)
  const landing = row ? fill(row.landing) : `https://doi.org/${doi}`
  const pdf = row?.pdf ? fill(row.pdf) : undefined
  const name = `browser:${row?.name ?? "doi"}`
  const hosts = [...PUBLISHER_HOSTS, hostOf(landing), ...(pdf ? [hostOf(pdf)] : []), ...(site ? [site] : [])]
  const sites = row ? row.sites : site ? [site] : []
  const routes: BrowserRoute[] = [{ name, landing, pdf, allowHosts: hosts, sites, ...(row?.ownBrowser ? { ownBrowser: fill(row.ownBrowser) } : {}) }]
  // owlit's browser doesn't go there at all, so not through the library's proxy either
  if (row?.ownBrowser) return routes
  if (proxy?.base) {
    // The PDF is fetched from wherever the proxied page settles, so only the landing goes through it
    routes.push({ name: `${name}:proxied`, landing: throughProxy(landing, proxy), pdf, allowHosts: [...hosts, hostOf(proxy.base), `.${hostOf(proxy.base)}`], sites })
  }
  return routes
}

// The row for a DOI: by the site it is registered to when that's known, else by its prefix
function rowFor(doi: string, site: string | undefined) {
  return site ? ROWS.find((r) => r.sites.includes(site)) : ROWS.filter((r) => doi.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
}

// Where the user's own browser gets the paper's PDF, for a publisher that lets only that browser in.
// host is where the paper's publisher was found to be (acquisition.json's needs), when it was.
export function ownBrowserUrl(doi: string, host?: string) {
  const row = rowFor(doi, host ? siteOf(host) : undefined)
  return row?.ownBrowser?.replace("{doi}", doi)
}

// The page's own link to its PDF, for a page without citation_pdf_url: one labelled just "PDF" (or
// "Download PDF"), to a .pdf on the page's own site. APA PsycNet's full-text pages link
// /fulltext/<id>.pdf this way and carry no citation tags (2026-10-11: an open-access APA article was
// left without a PDF, "The publisher's page doesn't link a PDF").
export function pdfLinkOn(page: string, links: { text: string; href: string }[]) {
  const site = siteOf(hostOf(page))
  for (const link of links) {
    if (!/^(download\s+)?(article\s+)?pdf$/i.test(link.text.replace(/\s+/g, " ").trim())) continue
    let url: URL
    try {
      url = new URL(link.href, page)
    } catch {
      continue
    }
    if (/^https?:$/.test(url.protocol) && siteOf(url.hostname) === site && /\.pdf$/i.test(url.pathname)) return url.toString()
  }
  return undefined
}

// A host's registrable domain, without the public suffix list: the last two labels, or three under a
// country's second level (ac.uk, edu.cn, com.au)
export function siteOf(host: string) {
  const labels = host.toLowerCase().split(".").filter(Boolean)
  const country = labels.length >= 3 && labels.at(-1)!.length === 2 && /^(ac|co|com|edu|gov|net|org)$/.test(labels.at(-2)!)
  return labels.slice(country ? -3 : -2).join(".")
}

export function throughProxy(target: string, proxy: ProxySettings) {
  const base = proxy.base.replace(/\/+$/, "")
  if (proxy.scheme === "host-rewrite") {
    const url = new URL(target)
    url.hostname = `${url.hostname.replace(/\./g, "-")}.${hostOf(base)}`
    return url.toString()
  }
  // Not encoded: tlink and EZproxy take the target as it is
  return `${base}${proxy.path ?? "/login"}?url=${target}`
}
