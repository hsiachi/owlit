import { checked, firewalled, landing, metaRefresh, page, pdf, publisherLogin, shell, subscribed, type Behaviour, type FakeWeb } from "../../core/src/extension/test/fake-web.ts"

// Publishers as the scenarios meet them on the fake web, at the addresses owlit's publisher table
// (packages/core/src/library/publisher-table.ts) sends the extension to

// What only the user's browser gets: the campus network or the user's cookies let it in, owlit's own
// fetch is turned away
export const inBrowser =
  (then: Behaviour): Behaviour =>
  (visit) =>
    visit.client === "browser" ? then(visit) : page("Access denied", "<p>Access denied</p>", 403)

export interface Gate {
  // Cloudflare's check in front of the article and its PDF, until passed
  check?: boolean
  // The firewall's block, until another network
  blocked?: boolean
  // Only for a reader signed in somewhere (a proxy, the publisher)
  subscription?: boolean
}

const gated = (behaviour: Behaviour, gate: Gate) => {
  let b = inBrowser(behaviour)
  if (gate.subscription) b = subscribed(behaviour)
  if (gate.check) b = checked(b)
  if (gate.blocked) b = firewalled(b)
  return b
}

// An Atypon publisher (SAGE, Science, T&F): the article at /doi/<doi>, its PDF at /doi/pdf/<doi>
export function atypon(web: FakeWeb, host: string, doi: string, title: string, gate: Gate = {}) {
  web.paper(doi, title, { url: `https://${host}/doi/${doi}` })
  web.on(`${host}/doi/pdf/${doi}`, gated(pdf(doi), gate))
  web.on(`${host}/doi/${doi}`, gated(landing(doi, title, `https://${host}/doi/pdf/${doi}`), gate))
  web.on(`${host}/action/showLogin`, publisherLogin())
}

// Elsevier: the DOI registered to linkinghub, whose page sends on by a meta refresh to ScienceDirect's
// article, whose tags name its PDF
export function elsevier(web: FakeWeb, doi: string, title: string, gate: Gate = {}) {
  const pii = doi.replace(/\W/g, "").toUpperCase()
  web.paper(doi, title, { url: `https://linkinghub.elsevier.com/retrieve/pii/${pii}` })
  web.on(`linkinghub.elsevier.com/retrieve/pii/${pii}`, metaRefresh(`https://www.sciencedirect.com/science/article/pii/${pii}`))
  web.on(`www.sciencedirect.com/science/article/pii/${pii}/pdfft`, gated(pdf(doi), gate))
  web.on(`www.sciencedirect.com/science/article/pii/${pii}`, gated(landing(doi, title, `https://www.sciencedirect.com/science/article/pii/${pii}/pdfft`), gate))
}

// APA PsycNet: doi.org sends to a page only its scripts make anything of
export function psycnet(web: FakeWeb, doi: string, title: string) {
  const at = `https://psycnet.apa.org/doiLanding?doi=${encodeURIComponent(doi)}`
  web.paper(doi, title, { url: at })
  web.on(`psycnet.apa.org/doiLanding?doi=${encodeURIComponent(doi)}`, shell())
}

// An open access paper: Unpaywall names a repository's copy
export function openAccess(web: FakeWeb, doi: string, title: string) {
  const copy = `https://repository.example.org/bitstream/${encodeURIComponent(doi)}.pdf`
  web.paper(doi, title, { url: `https://journals.sagepub.com/doi/${doi}`, oa: copy })
  web.on(`repository.example.org/bitstream/${encodeURIComponent(doi)}.pdf`, pdf(doi))
}
