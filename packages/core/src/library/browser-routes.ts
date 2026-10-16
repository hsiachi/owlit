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
// site; otherwise doi.org sending it to BMJ, APA or PubMed Central would stop it at a host it didn't know.

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

// Where owlit's browser extension fetches a paper the plain routes couldn't get, with the user's cookies:
// the publisher's article page (the address the DOI is registered to, for a publisher owlit has no row
// for, so the extension's first request is to the site it is paced and allowed by rather than doi.org),
// and the PDF's own address when the row has one. Through the library's proxy when one is set, except
// at a publisher whose papers are all open; then the queue paces by the proxy's host, since every
// publisher behind it is one sign-in.
export interface ExtensionRoute {
  url: string
  pdfUrl?: string
  host: string
  proxied: boolean
  // The proxy's own sign-in page, opened for the user when the extension finds the proxy signed out
  signIn?: string
}

export function extensionRoute(doi: string, proxy: ProxySettings | undefined, registered?: string): ExtensionRoute {
  const site = registered ? siteOf(hostOf(registered)) : undefined
  const row = rowFor(doi, site)
  const landing = row?.landing ? fill(row.landing, doi) : (registered ?? `https://doi.org/${doi}`)
  // A template that needs the landing page ({landing}) can't be filled before visiting it
  const pdf = row?.pdf && !row.pdf.includes("{landing}") ? fill(row.pdf, doi) : undefined
  if (!proxy?.base || row?.open) return { url: landing, ...(pdf ? { pdfUrl: pdf } : {}), host: siteOf(hostOf(landing)), proxied: false }
  return {
    url: throughProxy(landing, proxy),
    ...(pdf ? { pdfUrl: throughProxy(pdf, proxy) } : {}),
    host: hostOf(proxy.base),
    proxied: true,
    signIn: proxySignIn(proxy),
  }
}

// The proxy's entry, where a signed-out reader is asked to sign in
const proxySignIn = (proxy: ProxySettings) => (proxy.scheme === "host-rewrite" ? proxy.base : `${proxy.base.replace(/\/+$/, "")}${proxy.path ?? "/login"}`)

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
  // library proxy's sign-in page, where an older note in acquisition.json may say the page wanted a person
  const site = host && PUBLISHER_HOSTS.some((h) => siteOf(h) === siteOf(host)) && !REDIRECTORS.has(siteOf(host)) ? siteOf(host) : undefined
  const row = rowFor(doi, site)
  const download = row?.download && row.pdf ? `${fill(row.pdf, doi)}?download=true` : undefined
  const address = download ?? (row?.landing ? fill(row.landing, doi) : `https://doi.org/${doi}`)
  const proxied = !!proxy?.base && !row?.open
  return {
    url: proxied ? throughProxy(address, proxy) : address,
    address,
    ...(proxied ? { proxy: proxySignIn(proxy) } : {}),
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
// /fulltext/<id>.pdf this way and carry no citation tags, so without this an open-access APA article is
// left without a PDF.
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

// What the library sign-in window shows, each time it is looked at
export interface SignInPage {
  url: string
  // A password field or a captcha on screen
  asking: boolean
}

// Whether the library sign-in is over, from the pages the sign-in window went through: a sign-in step
// (the university's own login site, or a password field on the proxy's host) and then the proxy's host
// again, off its login paths and asking nothing, twice in a row. People don't know to close the window
// once signed in, so it closes itself. Tsinghua's tlink signs in on id.tsinghua.edu.cn, by
// password or by scanning a code, so leaving the host counts without a password field. A window that
// opens on an already signed-in proxy shows no step, and stays for the person to close.
export function signInWatch(entry: string) {
  const proxyHost = hostOf(entry)
  let stepped = false
  let clear = 0
  return (page: SignInPage): boolean => {
    let at: URL
    try {
      at = new URL(page.url)
    } catch {
      return false
    }
    // about:blank before the first page
    if (!at.hostname) return false
    const onProxy = at.hostname === proxyHost || at.hostname.endsWith(`.${proxyHost}`)
    if (!onProxy || page.asking) {
      stepped = true
      clear = 0
      return false
    }
    clear = stepped && !/log-?in|sign-?in|sso|\/cas\b|auth/i.test(at.pathname) ? clear + 1 : 0
    return clear >= 2
  }
}

// The PDF's address worked out from the article page a browser landed on, for publishers whose pages
// carry no citation_pdf_url: IEEE Xplore's /document/<arnumber> (its PDF is the stamp page's
// getPDF.jsp), and OSF's preprints (PsyArXiv, SocArXiv), whose file is /<id>/download. Only on the
// publisher's own host: a library proxy's rewrite of it is left to the page's own links. ScienceDirect's
// /pdfft isn't here: opened without the article page's own parameters it answers "There was a problem
// providing the content you requested".
export function pdfFromLanded(page: string): string | undefined {
  let url: URL
  try {
    url = new URL(page)
  } catch {
    return undefined
  }
  const ieee = url.hostname === "ieeexplore.ieee.org" && /^\/document\/(\d+)/.exec(url.pathname)
  if (ieee) return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${ieee[1]}`
  const osf = /^(www\.)?(osf\.io|psyarxiv\.com|socarxiv\.org)$/.test(url.hostname) && /^\/(preprints\/[a-z]+\/)?([a-z0-9]{5,6})(\/|$)/.exec(url.pathname)
  if (osf) return `https://osf.io/${osf[2]}/download`
  return undefined
}
