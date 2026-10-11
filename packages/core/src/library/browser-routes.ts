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
}

const ROWS: Row[] = [
  { name: "acm", prefix: "10.1145/", sites: ["acm.org"], landing: "https://dl.acm.org/doi/{doi}", pdf: "https://dl.acm.org/doi/pdf/{doi}" },
  { name: "sage", prefix: "10.1177/", sites: ["sagepub.com"], landing: "https://journals.sagepub.com/doi/{doi}", pdf: "https://journals.sagepub.com/doi/pdf/{doi}" },
  { name: "wiley", prefix: "10.1002/", sites: ["wiley.com"], landing: "https://onlinelibrary.wiley.com/doi/{doi}", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "wiley", prefix: "10.1111/", sites: ["wiley.com"], landing: "https://onlinelibrary.wiley.com/doi/{doi}", pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}" },
  { name: "tandf", prefix: "10.1080/", sites: ["tandfonline.com"], landing: "https://www.tandfonline.com/doi/full/{doi}", pdf: "https://www.tandfonline.com/doi/pdf/{doi}" },
  { name: "springer", prefix: "10.1007/", sites: ["springer.com"], landing: "https://link.springer.com/article/{doi}", pdf: "https://link.springer.com/content/pdf/{doi}.pdf" },
  { name: "elsevier", prefix: "10.1016/", sites: ["elsevier.com", "sciencedirect.com"], landing: "https://doi.org/{doi}" },
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
}

// Direct first; through the proxy when one is set up. `registered` is the address the DOI is registered
// to (doi.org's handle record), when it could be looked up.
export function browserRoutes(doi: string, proxy: ProxySettings | undefined, registered?: string): BrowserRoute[] {
  const site = registered ? siteOf(hostOf(registered)) : undefined
  const row = site
    ? ROWS.find((r) => r.sites.includes(site))
    : ROWS.filter((r) => doi.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  const fill = (template: string) => template.replace("{doi}", doi)
  const landing = row ? fill(row.landing) : `https://doi.org/${doi}`
  const pdf = row?.pdf ? fill(row.pdf) : undefined
  const name = `browser:${row?.name ?? "doi"}`
  const hosts = [...PUBLISHER_HOSTS, hostOf(landing), ...(pdf ? [hostOf(pdf)] : []), ...(site ? [site] : [])]
  const routes: BrowserRoute[] = [{ name, landing, pdf, allowHosts: hosts }]
  if (proxy?.base) {
    // The PDF is fetched from wherever the proxied page settles, so only the landing goes through it
    routes.push({ name: `${name}:proxied`, landing: throughProxy(landing, proxy), pdf, allowHosts: [...hosts, hostOf(proxy.base), `.${hostOf(proxy.base)}`] })
  }
  return routes
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
