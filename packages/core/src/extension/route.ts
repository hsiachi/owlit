import { PROXY_PRESETS, type ProxySettings } from "@owlit/protocol"
import { getDomain } from "tldts"
import { hostOf } from "../net/http.ts"
import { fill, publisherOf, PUBLISHERS, type Publisher } from "../library/publisher-table.ts"

// Where the extension fetches a paper the plain routes couldn't get: the publisher's article page,
// through the library's proxy when one is set (publisher-table.ts has the publishers).
//
// A DOI's prefix names who first published it, not where it lives now: journals change publishers
// (Current Directions in Psychological Science's 10.1111 DOIs are at SAGE, Annals of Behavioral
// Medicine's 10.1007 ones at OUP) and publishers take in others' (ACL's 10.3115 at the ACM). So the row
// follows the site the DOI is registered to when that's known.

// A publisher's browser row, with its sites
interface Row extends NonNullable<Publisher["browser"]> {
  name: string
  pdf?: string
  sites: string[]
}

const ROWS: Row[] = PUBLISHERS.flatMap((p) =>
  p.browser ? [{ ...p.browser, name: p.name, pdf: p.pdf, sites: [...new Set((p.hosts ?? []).map(siteOf))] }] : [],
)

// Where the extension fetches a paper, with the user's cookies: the publisher's article page (the
// address the DOI is registered to, for a publisher owlit has no row for, so the extension's first
// request is to the site it is paced and allowed by rather than doi.org), and the PDF's own address when
// the row has one. Through the library's proxy when one is set, except at a publisher whose papers are
// all open; then the queue paces by the proxy's host, since every publisher behind it is one sign-in.
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

// The proxy's entry, where a signed-out reader is asked to sign in. A preset's page wins: it is looked up
// rather than saved with the proxy, so settings saved before it still get it
export function proxySignIn(proxy: ProxySettings) {
  const preset: { signIn?: string } | undefined = proxy.preset ? PROXY_PRESETS[proxy.preset as keyof typeof PROXY_PRESETS] : undefined
  if (preset?.signIn) return preset.signIn
  return proxy.scheme === "host-rewrite" ? proxy.base : `${proxy.base.replace(/\/+$/, "")}${proxy.path ?? "/login"}`
}

// The row for a DOI: by the site it is registered to when that's known, else by its prefix
function rowFor(doi: string, site: string | undefined) {
  if (site) return ROWS.find((r) => r.sites.includes(site))
  const name = publisherOf(doi)?.name
  return ROWS.find((r) => r.name === name)
}

// A host's registrable domain, by the public suffix list (tsinghua.edu.cn, example.co.jp); the host
// itself where it has none (localhost, an address). apps/extension's lib/verdict.ts has the same: change
// them together.
export function siteOf(host: string) {
  const bare = host.toLowerCase().replace(/\.$/, "")
  return getDomain(bare) ?? bare
}

// A host as a host-rewriting proxy (EZproxy) names it: each "-" of the host's own written "--", then each
// "." written "-", in front of the proxy's host (www.thieme-connect.de → www-thieme--connect-de.<proxy>).
// keys.ts reads it back (realHost): change them together.
export const rewriteHost = (host: string, proxyHost: string) => `${host.replace(/-/g, "--").replace(/\./g, "-")}.${proxyHost}`

// The host a rewritten name hides: rewriteHost's inverse
export const realHost = (hidden: string) => hidden.replace(/--|-/g, (run) => (run === "--" ? "-" : "."))

export function throughProxy(target: string, proxy: ProxySettings) {
  const base = proxy.base.replace(/\/+$/, "")
  if (proxy.scheme === "host-rewrite") {
    const url = new URL(target)
    url.hostname = rewriteHost(url.hostname, hostOf(base))
    return url.toString()
  }
  // Not encoded: tlink and EZproxy take the target as it is
  return `${base}${proxy.path ?? "/login"}?url=${target}`
}
