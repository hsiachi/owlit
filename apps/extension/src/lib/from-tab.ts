import type { WorkItem } from "@owlit/protocol"
import { paperOfPage, pdfLinkIn, siteOf } from "./page.ts"

// A paper's addresses as a tab already past its site's check reaches them. A fetch inside a tab goes only
// to the tab's own origin (another origin would need that site's CORS), and the background's own fetch
// is what the site's firewall turned away, so an address owlit gave is moved to where the tab is: out of
// the library proxy's link when the tab already stands at the publisher, onto a host-rewriting proxy's
// name when the tab stands there, and onto the tab's own host when the two are hosts of one site (Wiley's
// onlinelibrary.wiley.com and its societies' rss.onlinelibrary.wiley.com serve the same paths).

// The proxy's host for a paper fetched through it: its lane is the proxy's
export const proxyHostOf = (item: Pick<WorkItem, "lane" | "proxied">) => (item.proxied && item.lane.startsWith("proxy:") ? item.lane.slice("proxy:".length) : undefined)

// packages/core/src/extension/route.ts rewriteHost and realHost, copied (the extension doesn't import
// core): change them together
const rewriteHost = (host: string, proxyHost: string) => `${host.replace(/-/g, "--").replace(/\./g, "-")}.${proxyHost}`
const realHost = (hidden: string) => hidden.replace(/--|-/g, (run) => (run === "--" ? "-" : "."))

// The host a page is really at: a host-rewriting proxy's name for a publisher's host read back
function hostBehind(host: string, proxyHost: string | undefined) {
  return proxyHost && host.endsWith(`.${proxyHost}`) ? realHost(host.slice(0, -proxyHost.length - 1)) : host
}

// Whether two hosts are one site's, a host-rewriting proxy's names read back first: under such a proxy
// every publisher's host shares the proxy's registrable domain
export function sameSite(a: string, b: string, proxyHost?: string) {
  return siteOf(hostBehind(a, proxyHost)) === siteOf(hostBehind(b, proxyHost))
}

const parse = (url: string, base?: string) => {
  try {
    return new URL(url, base)
  } catch {
    return undefined
  }
}

// The address a login-url proxy's link carries (tlink's /go?url=, EZproxy's /login?url=), as core's
// keys.ts throughProxy reads it: whole, not by searchParams, since the proxy takes the target unencoded
function unwrapped(url: URL, proxyHost: string | undefined): URL {
  if (!proxyHost || url.hostname !== proxyHost) return url
  const raw = /[?&]url=(.*)$/i.exec(url.search)?.[1]
  if (!raw) return url
  let target = raw
  if (/^https?%3A/i.test(raw)) {
    try {
      target = decodeURIComponent(raw)
    } catch {
      return url
    }
  }
  return parse(target) ?? url
}

// address as the tab at tabUrl reaches it, or undefined when it is another site's (a CDN's signed
// address, which the background fetches as it is)
export function fromTab(address: string, tabUrl: string, proxyHost?: string): string | undefined {
  const tab = parse(tabUrl)
  const at = parse(address, tabUrl)
  if (!tab || !at) return undefined
  const target = unwrapped(at, proxyHost)
  if (target.origin === tab.origin) return target.href
  // The tab at a host-rewriting proxy's name for the publisher: the address under that name
  if (proxyHost && tab.hostname.endsWith(`.${proxyHost}`) && target.hostname !== proxyHost && !target.hostname.endsWith(`.${proxyHost}`)) {
    const rewritten = new URL(target.href)
    rewritten.hostname = rewriteHost(target.hostname, proxyHost)
    if (rewritten.origin === tab.origin) return rewritten.href
  }
  if (!sameSite(target.hostname, tab.hostname, proxyHost)) return undefined
  return new URL(`${target.pathname}${target.search}${target.hash}`, tab.origin).href
}

// The item as it is fetched from inside a tab past the site's check. page: the tab's document when the
// tab shows this paper's own page (the extension's tab, loaded on it), whose address and PDF link then
// stand in for owlit's; a tab the user has open at the site shows some other page of it, and only owlit's
// addresses are moved there. owlit's PDF address comes first, moved to the tab: a page's own link may
// name the site's PDF viewer (Wiley's /doi/pdf/), which owlit's (/doi/pdfdirect/) goes past.
export function inTabItem(item: WorkItem, tabUrl: string, page?: { html: string }): WorkItem {
  const proxyHost = proxyHostOf(item)
  const url = page ? tabUrl : (fromTab(item.url, tabUrl, proxyHost) ?? item.url)
  const named = page ? (paperOfPage(page.html, tabUrl)?.pdfUrl ?? pdfLinkIn(page.html, tabUrl)) : undefined
  const pdfUrl = (item.pdfUrl && fromTab(item.pdfUrl, tabUrl, proxyHost)) ?? named ?? item.pdfUrl
  const host = parse(url)?.hostname ?? ""
  // Out of the proxy's link, the page is the publisher's own; under a host-rewriting proxy's name it is
  // still read as the proxy's
  const proxied = !!proxyHost && (host === proxyHost || host.endsWith(`.${proxyHost}`))
  return { ...item, url, ...(pdfUrl ? { pdfUrl } : {}), proxied }
}
