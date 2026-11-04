import { checked, cloudflareCheck, firewalled, landing, metaRefresh, page, PARSER_HELD, pdf, publisherLogin, redirectTo, shell, ssoStep, subscribed, type Behaviour, type FakeWeb } from "../../core/src/extension/test/fake-web.ts"

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

// A publisher that takes an off-campus reader through an institution's sign-in: the paper's page and PDF
// send anyone without its session to hop (auth.elsevier.com, login.openathens.net, its own ssostart or
// Shibboleth.sso), which a tab walks and comes out of on the paper's page with the session. walks: false,
// a hop that never goes on.
export function behindSso(web: FakeWeb, host: string, doi: string, title: string, hop: string, { walks = true } = {}) {
  const at = `https://${host}/doi/${doi}`
  const session = (then: Behaviour): Behaviour => (visit) => (visit.web.isCleared(host, visit.client) ? then(visit) : redirectTo(`https://${hop}`))
  web.paper(doi, title, { url: at })
  web.on(`${host}/doi/pdf/${doi}`, session(pdf(doi)))
  web.on(`${host}/doi/${doi}`, session(landing(doi, title, `https://${host}/doi/pdf/${doi}`)))
  web.on(hop, ssoStep(host, at, { walks }))
}

// A publisher whose firewall refuses the extension's own requests by their shape: the PDF's address
// answers 403 with the article on it, and only a page of the site gets the PDF
export function refusesWorker(web: FakeWeb, host: string, doi: string, title: string, { parserHeld = false } = {}) {
  const at = `https://${host}/doi/${doi}`
  const article = (status: number) => () => {
    const answer = page(title, `<h1>${title}</h1><a href="/doi/pdf/${doi}">PDF</a>`, status, `<meta name="citation_title" content="${title}"><meta name="citation_doi" content="${doi}">`)
    if (parserHeld) answer.headers.set(PARSER_HELD, "1")
    return answer
  }
  web.paper(doi, title, { url: at })
  web.on(`${host}/doi/pdf/${doi}`, (visit) => (visit.from === "tab" ? pdf(doi)(visit) : article(403)()))
  web.on(`${host}/doi/${doi}`, inBrowser(article(200)))
}

// A publisher whose check turns the extension's own fetches away and passes in any tab that runs it
export function checksWorker(web: FakeWeb, host: string, doi: string, title: string) {
  const inTab = (then: Behaviour): Behaviour => (visit) => (visit.from === "tab" ? then(visit) : cloudflareCheck())
  web.paper(doi, title, { url: `https://${host}/doi/${doi}` })
  web.on(`${host}/doi/pdf/${doi}`, inTab(pdf(doi)))
  web.on(`${host}/doi/${doi}`, inTab(landing(doi, title, `https://${host}/doi/pdf/${doi}`)))
}
