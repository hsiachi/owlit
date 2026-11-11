import { SSO_HOP_HOSTS, type GateKey, type LaneKey, type PdfTry, type ProxySettings } from "@owlit/protocol"
import { publisherOf, PUBLISHERS, REDIRECTORS } from "../library/publisher-table.ts"
import { hostOf } from "../net/http.ts"
import { realHost, rewriteHost, siteOf, type ExtensionRoute } from "./route.ts"

// The keys the extension's work is arranged by (packages/protocol/src/pdf-keys.ts), made here and
// nowhere else. A gate is who can stop a fetch: the publisher whose check, block or sign-in it met, or
// the library proxy's own sign-in. A lane is whose pace a fetch follows: through the proxy every paper
// shares the proxy's lane, whatever its gate; otherwise the lane is the gate.
//
// A paper's gate is predicted from its route before its first try and taken from the page its newest
// try ended on after; both go through gateOf, so a publisher met on any of its hosts, directly or
// through the proxy, is one gate.

// Hosts that serve or pass on other publishers' papers: a page there says nothing about whose gate the
// fetch met, so it keeps the paper's predicted one. Silverchair serves OUP's PDFs and many societies';
// sciencedirectassets serves Elsevier's.
const CDN_SITES = new Set(["silverchair.com", "sciencedirectassets.com"])

// Sign-in services a school's readers are sent to (an identity provider, a federation's "where are you
// from" page): signing in there is the proxy's sign-in, or the publisher's, never a gate of its own.
const IDP_SITES = new Set(["openathens.net", "microsoftonline.com", "okta.com", "incommon.org", "ukfederation.org.uk", "aaf.edu.au", "surfconext.nl", "eduid.cz"])
// A school's own sign-in host, by the names they are given (id.tsinghua.edu.cn, idp.uni.edu,
// wayf.surfnet.nl). Not login. or auth.: publishers name their own sign-in pages so.
const IDP_HOST = /^(id|idp|sso|cas|wayf|ds|shib|shibboleth)\d*\./

const SSO_HOPS: ReadonlySet<string> = new Set(SSO_HOP_HOSTS)

// A university's registrable domain holds its proxy, its sign-in and many sites that aren't the
// publisher's: a publisher hosted there (misq.umn.edu) is matched by its own host, not the domain
const institutional = (site: string) => /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(site)

// The domain a publisher's host is matched under: its registrable domain, so its other hosts
// (agupubs.onlinelibrary.wiley.com, cell.com's www and not) are the same publisher
const matchedUnder = (host: string) => (institutional(siteOf(host)) ? host : siteOf(host))

const PUBLISHER_OF = new Map(PUBLISHERS.flatMap((p) => (p.hosts ?? []).map((host) => [matchedUnder(host), p.name] as const)))

// The publisher of a host: it, or a domain above it, is one the table lists
function publisherAt(host: string): string | undefined {
  const labels = host.split(".")
  for (let i = 0; i < labels.length - 1; i++) {
    const name = PUBLISHER_OF.get(labels.slice(i).join("."))
    if (name) return name
  }
  return undefined
}

// Where a page through the library's proxy really is: the target a login-url proxy carries in ?url=
// (tlink's /go?url=, EZproxy's /login?url=), or the host a host-rewrite proxy hid in its first label
// (www-sciencedirect-com.ezproxy.uni.edu, route.ts rewriteHost). undefined for the
// proxy's own pages (its front page, its sign-in). A WebVPN that encrypts the host can't be read back:
// its pages all stay the proxy's.
function throughProxy(url: URL, proxy: ProxySettings): { url?: URL } | undefined {
  const proxyHost = hostOf(proxy.base).toLowerCase()
  const host = url.hostname.toLowerCase()
  if (proxy.scheme === "login-url") {
    if (host !== proxyHost) return undefined
    // Taken whole, not by searchParams: the proxy takes the target unencoded, its own query included
    const raw = /[?&]url=(.*)$/i.exec(url.search)?.[1]
    if (!raw) return {}
    const target = parse(/^https?%3A/i.test(raw) ? safeDecode(raw) : raw)
    return target ? { url: target } : {}
  }
  if (host === proxyHost) return {}
  if (!host.endsWith(`.${proxyHost}`)) return undefined
  const target = parse(url.toString())
  if (!target) return {}
  target.hostname = realHost(host.slice(0, -proxyHost.length - 1))
  return { url: target }
}

// The address a fetch through this proxy really reached: the same address for one that went past it
function readBack(at: URL, proxy: ProxySettings | undefined): URL {
  return (proxy && throughProxy(at, proxy)?.url) || at
}

// A page on the way through a publisher's sign-in (protocol's SSO_HOP_HOSTS). Its address holds a one-time
// request, so a wait made there opens the paper's own link instead.
export function isSsoHop(url: string | undefined, proxy?: ProxySettings): boolean {
  const at = url ? parse(url) : undefined
  return !!at && SSO_HOPS.has(readBack(at, proxy).hostname.toLowerCase())
}

// The paper's own PDF address (its route's pdfUrl). A wait made there opens the paper's page instead: a
// browser may hand that address to its PDF viewer, which shows the user no check to pass.
export function isPdfAddress(url: string | undefined, pdfUrl: string | undefined): boolean {
  const [at, pdf] = [url ? parse(url) : undefined, pdfUrl ? parse(pdfUrl) : undefined]
  return !!at && !!pdf && at.host === pdf.host && at.pathname === pdf.pathname
}

// The gate a page at this address belongs to. proxy: the library's proxy, given when the paper's fetch
// goes through it, so its pages are read back to the publisher's and a school's sign-in met on the way
// is the proxy's. predicted: the paper's gate before this page (gateOf of its route), kept where the
// page can't say (a CDN, doi.org, an identity provider, a hop of a publisher's sign-in). A hop goes before
// every other reading: its page says nothing of whose paper this is, and read as the proxy's sign-in it
// would hold the lane's other publishers, with a watch the reader never comes back to.
export function gateOf(url: string, proxy?: ProxySettings, predicted?: GateKey): GateKey {
  let at = parse(url)
  if (!at) return predicted ?? `site:${url}`
  if (proxy) {
    const real = throughProxy(at, proxy)
    if (real && !real.url) return proxyGate(proxy)
    if (real?.url) at = real.url
  }
  const host = at.hostname.toLowerCase()
  if (SSO_HOPS.has(host) && predicted && !predicted.startsWith("proxy:")) return predicted
  const site = siteOf(host)
  if (REDIRECTORS.has(site)) {
    if (predicted) return predicted
    // doi.org/<doi>: the publisher its prefix names, the best guess before the DOI is followed
    const name = site === "doi.org" ? publisherOf(safeDecode(at.pathname.slice(1)))?.name : undefined
    return name ? `pub:${name}` : `site:${site}`
  }
  if (CDN_SITES.has(site) && predicted) return predicted
  const name = publisherAt(host)
  if (name) return `pub:${name}`
  const idp = IDP_SITES.has(site) || IDP_HOST.test(host)
  // Through the proxy, a sign-in under the proxy's own domain (id.tsinghua.edu.cn beside tlink) or at an
  // identity provider is the proxy asking its reader to sign in, which holds every paper through it
  if (proxy && (idp || site === siteOf(hostOf(proxy.base).toLowerCase()))) return proxyGate(proxy)
  if (idp && predicted) return predicted
  return `site:${site}`
}

// The lane a paper's fetches are paced in: the proxy's, which all its papers share, or its own gate
export function laneOf(route: Pick<ExtensionRoute, "url" | "host" | "proxied">): LaneKey {
  return route.proxied ? `proxy:${route.host.toLowerCase()}` : gateOf(route.url)
}

// The hosts where a page that loaded shows the user got past a wait at this gate (the extension matches
// a tab's host to one of them or a host under it). A publisher's own hosts, and through a host-rewrite
// proxy their rewritten names; the proxy's host only for its own gate (a login-url proxy such as tlink
// sends the browser on to the publisher's real host). Never an identity provider's: a page there is a
// sign-in going on, not done.
export function watchOf(gate: GateKey, lane: LaneKey, proxy?: ProxySettings): string[] {
  const proxyHost = proxy && lane.startsWith("proxy:") ? hostOf(proxy.base).toLowerCase() : undefined
  if (gate.startsWith("proxy:")) return [gate.slice("proxy:".length)]
  let hosts: string[]
  if (gate.startsWith("pub:")) {
    const listed = PUBLISHERS.find((p) => `pub:${p.name}` === gate)?.hosts ?? []
    hosts = listed.filter((host) => !CDN_SITES.has(siteOf(host)))
  } else {
    const site = gate.slice("site:".length)
    hosts = [site, `www.${site}`]
  }
  const watch = new Set(hosts.map(matchedUnder))
  if (proxyHost && proxy!.scheme === "host-rewrite") for (const host of hosts) watch.add(rewriteHost(host, proxyHost))
  return [...watch]
}

// Hosts a publisher's PDFs come from that its own hosts don't name: OUP's article-pdf links send on to
// Silverchair's watermark hosts
const PDF_SITES: Record<string, string[]> = { oup: ["silverchair.com"] }

// The sites the extension asks the browser for so it may read a gate's pages and PDFs (WorkWait.allow),
// as registrable domains: at, where the user acts, and for a publisher its hosts' and its PDF hosts'.
// The proxy's own gate is its host alone.
export function allowOf(gate: GateKey, at: string): string[] {
  if (!gate.startsWith("pub:")) return [siteOf(at)]
  const name = gate.slice("pub:".length)
  const hosts = PUBLISHERS.find((p) => p.name === name)?.hosts ?? []
  return [...new Set([siteOf(at), ...hosts.map(siteOf), ...(PDF_SITES[name] ?? [])])]
}

// The gate's publisher always turns away the extension's own fetch (publisher-table's browser.tab)
export const tabOnly = (gate: GateKey) => gate.startsWith("pub:") && !!PUBLISHERS.find((p) => `pub:${p.name}` === gate)?.browser?.tab

// The gate of the library proxy's own sign-in
export const proxyGate = (proxy: ProxySettings): GateKey => `proxy:${hostOf(proxy.base).toLowerCase()}`

function parse(url: string): URL | undefined {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? parsed : undefined
  } catch {
    return undefined
  }
}

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

// The gate a paper's extension try met: the one it noted, or, for a try noted before tries kept their
// gate, the one of the host it ended on
export function gateOfTry(tried: PdfTry, proxy: ProxySettings | undefined, predicted?: GateKey): GateKey | undefined {
  if (tried.gate) return tried.gate
  return tried.host ? gateOf(`https://${tried.host}/`, proxy, predicted) : undefined
}

// A page's address as a try keeps it: without its query and fragment, which hold challenge tokens and
// proxy session ids, in a record that may sit in a synced folder
export function withoutQuery(url: string | undefined): string | undefined {
  const parsed = url ? parse(url) : undefined
  if (!parsed) return undefined
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
}
