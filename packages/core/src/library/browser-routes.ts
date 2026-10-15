import type { ProxySettings } from "@owlit/protocol"
import { hostOf } from "../net/http.ts"
import { fill, OTHER_HOSTS, publisherOf, PUBLISHERS, REDIRECTORS, type Publisher } from "./publisher-table.ts"

// Where a browser goes for a paper the plain routes couldn't get: the publisher's article page,
// directly and then through the library's proxy (publisher-table.ts has the publishers).
//
// A DOI's prefix names who first published it, not where it lives now: journals change publishers
// (Current Directions in Psychological Science's 10.1111 DOIs are at SAGE, Annals of Behavioral
// Medicine's 10.1007 ones at OUP) and publishers take in others' (ACL's 10.3115 at the ACM). So the row
// follows the site the DOI is registered to when that's known, and the hidden window may visit that
// site: before, doi.org sending it to BMJ, APA or PubMed Central was stopped as a host it didn't know
// (2026-10-10: 9 of 25 papers without a PDF in one literature review).

// Publishers' hosts the hidden window may visit; doi.org sends readers on to one of these
export const PUBLISHER_HOSTS = [...PUBLISHERS.flatMap((p) => p.hosts ?? []), ...OTHER_HOSTS]

// A publisher's browser row, with its sites
interface Row extends NonNullable<Publisher["browser"]> {
  name: string
  pdf?: string
  sites: string[]
}

const ROWS: Row[] = PUBLISHERS.flatMap((p) =>
  p.browser ? [{ ...p.browser, name: p.name, pdf: p.pdf, sites: [...new Set((p.hosts ?? []).map(siteOf))] }] : [],
)

export interface BrowserRoute {
  name: string
  landing: string
  pdf?: string
  allowHosts: string[]
  // The publisher's sites, as far as they are known before visiting (Elsevier's DOIs are registered to
  // elsevier.com and read at sciencedirect.com): what owlit's visits to it are paced and held by
  sites: string[]
  // owlit's browser doesn't go there (Publisher.browser.browserOnly)
  browserOnly?: boolean
  // Through the library's proxy
  proxied: boolean
}

// Direct first; through the proxy when one is set up. `registered` is the address the DOI is registered
// to (doi.org's handle record), when it could be looked up.
export function browserRoutes(doi: string, proxy: ProxySettings | undefined, registered?: string): BrowserRoute[] {
  const site = registered ? siteOf(hostOf(registered)) : undefined
  const row = rowFor(doi, site)
  const landing = row?.landing ? fill(row.landing, doi) : `https://doi.org/${doi}`
  const pdf = row?.pdf ? fill(row.pdf, doi) : undefined
  const name = `browser:${row?.name ?? "doi"}`
  const hosts = [...PUBLISHER_HOSTS, hostOf(landing), ...(pdf ? [hostOf(pdf)] : []), ...(site ? [site] : [])]
  const sites = row ? row.sites : site ? [site] : []
  const routes: BrowserRoute[] = [{ name, landing, pdf, allowHosts: hosts, sites, proxied: false, ...(row?.browserOnly ? { browserOnly: true } : {}) }]
  // owlit's browser doesn't go there at all, so not through the library's proxy either
  if (row?.browserOnly) return routes
  if (proxy?.base) {
    // The PDF is fetched from wherever the proxied page settles, so only the landing goes through it
    routes.push({ name: `${name}:proxied`, landing: throughProxy(landing, proxy), pdf, allowHosts: [...hosts, hostOf(proxy.base), `.${hostOf(proxy.base)}`], sites, proxied: true })
  }
  return routes
}

// The row for a DOI: by the site it is registered to when that's known, else by its prefix
function rowFor(doi: string, site: string | undefined) {
  if (site) return ROWS.find((r) => r.sites.includes(site))
  const name = publisherOf(doi)?.name
  return ROWS.find((r) => r.name === name)
}

// Where the user's own browser gets the paper's PDF. host is where the paper's publisher was found to
// be (acquisition.json's needs), when it was.
export function yourBrowser(doi: string, host?: string, proxy?: ProxySettings): YourBrowser {
  // Only a publisher's own site says who the publisher is: not doi.org, which sends readers on, nor a
  // library proxy's sign-in page, where a note made before 2026-10-14 may say the page wanted a person
  const site = host && PUBLISHER_HOSTS.some((h) => siteOf(h) === siteOf(host)) && !REDIRECTORS.has(siteOf(host)) ? siteOf(host) : undefined
  const row = rowFor(doi, site)
  const download = row?.download && row.pdf ? `${fill(row.pdf, doi)}?download=true` : undefined
  const address = download ?? (row?.landing ? fill(row.landing, doi) : `https://doi.org/${doi}`)
  const proxied = !!proxy?.base && !row?.open
  return {
    url: proxied ? throughProxy(address, proxy) : address,
    address,
    ...(proxied ? { proxy: proxy.scheme === "host-rewrite" ? proxy.base : `${proxy.base.replace(/\/+$/, "")}${proxy.path ?? "/login"}` } : {}),
    // Through the proxy, its sign-in stands in front of every publisher: the proxy's site is the one
    site: siteOf(hostOf(proxied ? proxy.base : address)),
    opens: download ? "pdf" : "page",
  }
}

export interface YourBrowser {
  // What to open in the user's browser, through the library's proxy when there is one
  url: string
  // The same, before the proxy
  address: string
  // The proxy's entry it goes through, if it does
  proxy?: string
  // The site the user's browser goes to first: the publisher's, or the library proxy's
  site: string
  // The PDF itself, which their browser saves by itself, or the article page, where they save it
  opens: "pdf" | "page"
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
