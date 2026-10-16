import { readFile } from "node:fs/promises"
import { readPdf } from "./text/extract.ts"

// What owlit knows about each publisher, in one place: the DOIs that are its, its sites, where a PDF can
// be had without a browser, where the extension goes, and its own API when it has one. The plain routes
// (pdf.ts), the extension's routes (extension/route.ts), the API limits (library.ts), the key check in
// Settings (settings-rpc.ts) and the extension's site permissions (apps/extension) all read it.

// The keys of publishers' own APIs, which hand subscribed papers to the university's network without a
// browser or a check: Elsevier's article API and Wiley's text-and-data-mining API
export interface PublisherKeys {
  elsevierApiKey?: string
  wileyTdmToken?: string
}

export interface PublisherApi {
  // The setting that holds its key; no key, no API route
  key: keyof PublisherKeys
  host: string
  // The header the key goes in
  header: string
  // The PDF of a DOI
  url: (doi: string) => string
  // How hard owlit may ask (net/http limit)
  limit: { perSecond: number; concurrent: number }
  // Refuses a PDF the API gave that isn't the paper, by throwing; the file is deleted first
  verify?: (file: string, pdfiumWasm: string | undefined) => Promise<void>
  // A subscription paper the key is checked against in Settings
  checkDoi: string
}

export interface Publisher {
  // As routes name it: publisher:<name>, browser:<name>, api:<name>
  name: string
  // The DOI prefixes that are its ("10.1145/"); the longest one that matches a DOI decides
  prefixes: string[]
  // Its hosts. Their sites (elsevier.com, sciencedirect.com) are what the extension asks the browser to
  // read, and the site a DOI is registered to finds its publisher.
  hosts?: string[]
  // A direct PDF link for a DOI without a browser session: {doi} is the DOI, {suffix} the part after the
  // "/"; {landing} the page doi.org leads to (costs one request). Without {landing}, the browsers' PDF too.
  pdf?: string
  // Where the extension goes for a paper the plain routes couldn't get (extension/route.ts)
  browser?: {
    // The article page; doi.org's link when its own address isn't known from the DOI
    landing?: string
    // Every paper there is open to all, so the extension goes straight there, not through the
    // library's proxy
    open?: boolean
  }
  api?: PublisherApi
}

// Springer's, and BMC's, whose papers Springer's site serves
const SPRINGER_PDF = "https://link.springer.com/content/pdf/{doi}.pdf"

// The ACM: Cloudflare in front of the Digital Library puts a check in front of anything but the user's
// own browser, which is let straight through. Its PDFs are open access.
//
// The browser rows are from pitta's measured table; any other DOI goes through doi.org and the page's
// own citation_pdf_url.
export const PUBLISHERS: Publisher[] = [
  {
    name: "acm",
    // 10.5555/: ACM's own DOIs for papers it lists from elsewhere (10.5555/2034396.2034432): doi.org
    // doesn't know them (404), the Digital Library does
    prefixes: ["10.1145/", "10.5555/"],
    hosts: ["dl.acm.org"],
    pdf: "https://dl.acm.org/doi/pdf/{doi}",
    browser: { landing: "https://dl.acm.org/doi/{doi}", open: true },
  },
  {
    name: "sage",
    prefixes: ["10.1177/"],
    hosts: ["journals.sagepub.com"],
    pdf: "https://journals.sagepub.com/doi/pdf/{doi}",
    browser: { landing: "https://journals.sagepub.com/doi/{doi}" },
  },
  {
    name: "wiley",
    prefixes: ["10.1002/", "10.1111/", "10.1046/", "10.1113/", "10.1034/"],
    hosts: ["onlinelibrary.wiley.com"],
    pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/{doi}",
    browser: { landing: "https://onlinelibrary.wiley.com/doi/{doi}" },
    api: {
      key: "wileyTdmToken",
      host: "api.wiley.com",
      header: "wiley-tdm-client-token",
      url: (doi) => `https://api.wiley.com/onlinelibrary/tdm/v1/articles/${encodeURIComponent(doi)}`,
      // Wiley's API takes 60 requests in ten minutes
      limit: { perSecond: 0.1, concurrent: 1 },
      // Journal of Management Studies, a subscription journal
      checkDoi: "10.1111/joms.13065",
    },
  },
  {
    name: "tandf",
    prefixes: ["10.1080/"],
    hosts: ["www.tandfonline.com"],
    pdf: "https://www.tandfonline.com/doi/pdf/{doi}",
    browser: { landing: "https://www.tandfonline.com/doi/full/{doi}" },
  },
  {
    name: "science",
    prefixes: ["10.1126/"],
    hosts: ["www.science.org"],
    pdf: "https://www.science.org/doi/pdf/{doi}",
    browser: { landing: "https://www.science.org/doi/{doi}" },
  },
  {
    name: "pnas",
    prefixes: ["10.1073/"],
    hosts: ["www.pnas.org"],
    pdf: "https://www.pnas.org/doi/pdf/{doi}",
    browser: { landing: "https://www.pnas.org/doi/{doi}" },
  },
  {
    name: "springer",
    prefixes: ["10.1007/"],
    hosts: ["link.springer.com"],
    pdf: SPRINGER_PDF,
    browser: { landing: "https://link.springer.com/article/{doi}" },
  },
  {
    name: "elsevier",
    prefixes: ["10.1016/", "10.1006/", "10.1053/", "10.1054/", "10.1067/", "10.1078/", "10.1383/", "10.1529/"],
    // Its DOIs are registered to elsevier.com and read at sciencedirect.com
    hosts: ["linkinghub.elsevier.com", "www.sciencedirect.com", "pdf.sciencedirectassets.com"],
    browser: {},
    api: {
      key: "elsevierApiKey",
      host: "api.elsevier.com",
      header: "x-els-apikey",
      url: (doi) => `https://api.elsevier.com/content/article/doi/${doi}?httpAccept=application/pdf`,
      limit: { perSecond: 2, concurrent: 2 },
      verify: wholeArticle,
      // Computers in Human Behavior, a subscription journal
      checkDoi: "10.1016/j.chb.2019.07.016",
    },
  },
  { name: "ieee", prefixes: ["10.1109/"], hosts: ["ieeexplore.ieee.org"], browser: {} },
  { name: "bmc", prefixes: ["10.1186/"], pdf: SPRINGER_PDF },
  { name: "nature", prefixes: ["10.1038/"], hosts: ["www.nature.com"], pdf: "https://www.nature.com/articles/{suffix}.pdf" },
  { name: "acs", prefixes: ["10.1021/"], hosts: ["pubs.acs.org"], pdf: "https://pubs.acs.org/doi/pdf/{doi}" },
  { name: "iop", prefixes: ["10.1088/"], hosts: ["iopscience.iop.org"], pdf: "https://iopscience.iop.org/article/{doi}/pdf" },
  { name: "mdpi", prefixes: ["10.3390/"], hosts: ["www.mdpi.com"], pdf: "{landing}/pdf" },
  { name: "frontiers", prefixes: ["10.3389/"], pdf: "https://www.frontiersin.org/articles/{doi}/pdf" },
  { name: "plos", prefixes: ["10.1371/journal.pone."], pdf: "https://journals.plos.org/plosone/article/file?id={doi}&type=printable" },
  { name: "jmir", prefixes: ["10.2196/"], pdf: "{landing}/PDF" },
  { name: "biorxiv", prefixes: ["10.1101/"], pdf: "{landing}.full.pdf" },
]

// Hosts the extension may read that belong to no publisher above: doi.org, which sends readers on, and
// publishers a DOI's prefix doesn't name
export const OTHER_HOSTS = ["doi.org", "academic.oup.com", "www.cambridge.org", "www.jstor.org", "www.emerald.com", "arxiv.org"]

// Sites that only send a link on to the publisher's own site: what happens after the redirect is the
// publisher's doing, so they never stand for the publisher
export const REDIRECTORS = new Set(["doi.org", "handle.net"])

// The publisher of a DOI, by its longest matching prefix
export function publisherOf(doi: string) {
  let best: Publisher | undefined
  let length = 0
  for (const publisher of PUBLISHERS) {
    for (const prefix of publisher.prefixes) {
      if (doi.startsWith(prefix) && prefix.length > length) [best, length] = [publisher, prefix.length]
    }
  }
  return best
}

// A template filled in for a DOI ({landing} is left for the caller)
export function fill(template: string, doi: string) {
  return template.replace("{doi}", doi).replace("{suffix}", doi.slice(doi.indexOf("/") + 1))
}

// Elsevier's API answers a paper this network has no subscription to with its first page alone, as a
// PDF: that isn't the paper. (An article of one page is turned away too; the browser route still has it.)
async function wholeArticle(file: string, wasmPath: string | undefined) {
  const { pageCount } = await readPdf(await readFile(file), { wasmPath, maxPages: 0 })
  if (pageCount <= 1) {
    throw new Error("Elsevier's API gave only the first page: it sees no subscription from this network.")
  }
}
