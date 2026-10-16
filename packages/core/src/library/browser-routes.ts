import type { ProxySettings } from "@owlit/protocol"
import { hostOf } from "../net/http.ts"
import { fill, OTHER_HOSTS, publisherOf, PUBLISHERS, REDIRECTORS, type Publisher } from "./publisher-table.ts"

// Where a browser goes for a paper the plain routes couldn't get: the publisher's article page,
// through the library's proxy when one is set (publisher-table.ts has the publishers).
//
// A DOI's prefix names who first published it, not where it lives now: journals change publishers
// (Current Directions in Psychological Science's 10.1111 DOIs are at SAGE, Annals of Behavioral
// Medicine's 10.1007 ones at OUP) and publishers take in others' (ACL's 10.3115 at the ACM). So the row
// follows the site the DOI is registered to when that's known.

// Publishers' hosts; doi.org sends readers on to one of these
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
export const proxySignIn = (proxy: ProxySettings) => (proxy.scheme === "host-rewrite" ? proxy.base : `${proxy.base.replace(/\/+$/, "")}${proxy.path ?? "/login"}`)

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
