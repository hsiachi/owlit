import type { GateKey, LaneKey, ProxySettings } from "@owlit/protocol"
import { publisherOf, PUBLISHERS, REDIRECTORS } from "../library/publisher-table.ts"
import { hostOf } from "../net/http.ts"
import { siteOf, type ExtensionRoute } from "./route.ts"

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
// (www-sciencedirect-com.ezproxy.uni.edu, a hyphen of the host's own written as two). undefined for the
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
  const hidden = host.slice(0, -proxyHost.length - 1)
  const real = hidden.replace(/--/g, "\0").replace(/-/g, ".").replace(/\0/g, "-")
  const target = parse(url.toString())
  if (!target) return {}
  target.hostname = real
  return { url: target }
}

// The gate a page at this address belongs to. proxy: the library's proxy, given when the paper's fetch
// goes through it, so its pages are read back to the publisher's and a school's sign-in met on the way
// is the proxy's. predicted: the paper's gate before this page (gateOf of its route), kept where the
// page can't say (a CDN, doi.org, an identity provider).
export function gateOf(url: string, proxy?: ProxySettings, predicted?: GateKey): GateKey {
  let at = parse(url)
  if (!at) return predicted ?? `site:${url}`
  if (proxy) {
    const real = throughProxy(at, proxy)
    if (real && !real.url) return proxyGate(proxy)
    if (real?.url) at = real.url
  }
  const host = at.hostname.toLowerCase()
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
// proxy their rewritten names; the proxy's host for its own gate, and for a login-url proxy's lane,
// whose pages it serves. Never an identity provider's: a page there is a sign-in going on, not done.
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
  if (proxyHost && proxy!.scheme === "host-rewrite") for (const host of hosts) watch.add(rewritten(host, proxyHost))
  if (proxyHost && proxy!.scheme === "login-url") watch.add(proxyHost)
  return [...watch]
}

// The gate of the library proxy's own sign-in
export const proxyGate = (proxy: ProxySettings): GateKey => `proxy:${hostOf(proxy.base).toLowerCase()}`

// A host as a host-rewrite proxy names it (throughProxy above reads it back)
const rewritten = (host: string, proxyHost: string) => `${host.replace(/-/g, "--").replace(/\./g, "-")}.${proxyHost}`

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
