import { makePdf, paragraph } from "../../library/text/make-pdf.ts"

// A scripted web for tests of getting PDFs: many hostnames, each address answering by a behaviour, and
// two kinds of visitor. "core" is owlit's own fetch, with no cookies: it never gets past a check or a
// sign-in. "browser" is the user's browser, where the extension fetches with the user's cookies: what the
// user passed or signed in to (clear, signIn) lets it through. Only web-standard APIs (Response, URL) and
// core's PDF maker, so core's tests and the extension's can both use it.

export type Client = "core" | "browser"

export interface Visit {
  url: URL
  client: Client
  web: FakeWeb
  signal?: AbortSignal
  // Who in the browser asks: a page in a tab, or the extension's background, which a firewall can tell
  // apart by the shape of its requests
  from?: "worker" | "tab"
}

export type Behaviour = (visit: Visit) => Response | Promise<Response>

export interface FetchOptions {
  // The extension may read this address (its host permissions). A followed redirect to one it may not
  // read fails as a network failure does, and asked again with redirect: "manual" it is an opaque
  // redirect, as in Chromium.
  canRead?: (url: string) => boolean
  // Every redirect this visitor's fetches met, newest last per address: what the browser's webRequest
  // shows the extension (FetchDeps.redirectedTo)
  redirects?: Map<string, string>
}

const MAX_REDIRECTS = 20

// On a page: where it sends its tab on by script once its load ended (a check that passed in the tab
// running it, a step of a sign-in), which no fetch follows
export const SENDS_TO = "x-fake-sends-to"

export class FakeWeb {
  // Every request, in order: who asked for what
  readonly log: { client: Client; url: string }[] = []
  private readonly routes: { match: string | ((url: URL) => boolean); behaviour: Behaviour }[] = []
  private readonly cleared = new Set<string>()
  private readonly signedIn = new Set<string>()
  private readonly blockedAt = new Set<string>()
  private readonly downAt = new Set<string>()
  private readonly papers = new Map<string, { title: string }>()
  private readonly dois = new Map<string, { url: string; oa?: string }>()
  private readonly hung = new Set<{ visit: Visit; answer: () => void }>()

  constructor() {
    this.on("doi.org/api/handles/", ({ url }) => {
      const doi = decodeURIComponent(url.pathname.slice("/api/handles/".length))
      const known = this.dois.get(doi.toLowerCase())
      return known ? json({ values: [{ type: "URL", data: { value: known.url } }] }) : json({ responseCode: 100 }, 404)
    })
    this.on("api.unpaywall.org/v2/", ({ url }) => {
      const known = this.dois.get(decodeURIComponent(url.pathname.slice("/v2/".length)).toLowerCase())
      if (!known) return json({ error: true }, 404)
      return json({ oa_locations: known.oa ? [{ url_for_pdf: known.oa, host_type: "repository" }] : [] })
    })
    this.on(
      (url) => url.hostname === "doi.org" && !url.pathname.startsWith("/api/"),
      ({ url }) => {
        const known = this.dois.get(decodeURIComponent(url.pathname.slice(1)).toLowerCase())
        return known ? redirectTo(known.url) : page("DOI Not Found", "<p>DOI not found</p>", 404)
      },
    )
  }

  // An address, or every address it starts (host + path + query, no scheme), answered by a behaviour; the
  // longest matching one answers, the newest of equals. A function matches as it says, before any string.
  on(match: string | ((url: URL) => boolean), behaviour: Behaviour): this {
    this.routes.push({ match, behaviour })
    return this
  }

  // A paper the web knows: doi.org sends its DOI to url, and Unpaywall names its open copy, if any.
  // Its PDF (pdfOf) names the DOI and title on its first page, as core's isPdfOf wants.
  paper(doi: string, title: string, at: { url: string; oa?: string }): this {
    this.papers.set(doi.toLowerCase(), { title })
    this.dois.set(doi.toLowerCase(), at)
    return this
  }

  pdfOf(doi: string): Uint8Array<ArrayBuffer> {
    const known = this.papers.get(doi.toLowerCase())
    if (!known) throw new Error(`The fake web knows no paper ${doi}`)
    return new Uint8Array(makePdf([[{ x: 72, y: 60, size: 12, text: `https://doi.org/${doi}` }, { x: 72, y: 90, size: 12, text: known.title }, ...paragraph(72, 300, ["Body text of the paper."])]]))
  }

  // The user passed the check at this host in their browser
  clear(host: string) {
    this.cleared.add(host)
  }

  isCleared(host: string, client: Client) {
    return client === "browser" && this.cleared.has(host)
  }

  // The user signed in at this host (a publisher's, a proxy's) in their browser
  signIn(host: string) {
    this.signedIn.add(host)
  }

  isSignedIn(host: string, client: Client) {
    return client === "browser" && this.signedIn.has(host)
  }

  // Any proxy or publisher host the browser is signed in at: a subscription the user has
  anySignIn(client: Client) {
    return client === "browser" && this.signedIn.size > 0
  }

  // The site's firewall turns this user's network away, until another network (unblock)
  block(host: string) {
    this.blockedAt.add(host)
  }

  unblock(host: string) {
    this.blockedAt.delete(host)
  }

  isBlocked(host: string) {
    return this.blockedAt.has(host)
  }

  // The user's browser can't reach this host (its name doesn't resolve on their network, as SAGE's in
  // China without a VPN), until up
  down(host: string) {
    this.downAt.add(host)
  }

  up(host: string) {
    this.downAt.delete(host)
  }

  // How many answers hang now
  hanging() {
    return this.hung.size
  }

  // The hanging answers come, as their behaviour says
  release() {
    for (const h of [...this.hung]) {
      this.hung.delete(h)
      h.answer()
    }
  }

  // Waits on a behaviour that hangs (hang below): called by it
  holdUntilReleased(visit: Visit, then: Behaviour): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const held = { visit, answer: () => void Promise.resolve(then(visit)).then(resolve, reject) }
      this.hung.add(held)
      visit.signal?.addEventListener(
        "abort",
        () => {
          if (!this.hung.delete(held)) return
          reject(new DOMException("The operation was aborted.", "AbortError"))
        },
        { once: true },
      )
    })
  }

  // One request, one answer, no redirect followed
  async answer(url: string, client: Client, signal?: AbortSignal, from?: Visit["from"]): Promise<Response> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
    const at = new URL(url)
    this.log.push({ client, url })
    if (client === "browser" && this.downAt.has(at.hostname)) throw new TypeError("Failed to fetch")
    const key = `${at.hostname}${at.pathname}${at.search}`
    // The newest route first, so a test can replace what a helper set up
    const routes = [...this.routes].reverse()
    const fn = routes.find((r) => typeof r.match === "function" && r.match(at))
    const best = fn ?? routes.filter((r) => typeof r.match === "string" && key.startsWith(r.match)).sort((a, b) => (b.match as string).length - (a.match as string).length)[0]
    if (!best) return page("Not Found", "<h1>Not Found</h1>", 404)
    return best.behaviour({ url: at, client, web: this, signal, ...(from ? { from } : {}) })
  }

  // A fetch as this visitor sees the web: redirects followed (or not, with redirect: "manual"), and
  // response.url where the chain ended
  fetchFor(client: Client, options: FetchOptions = {}): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const mode = init?.redirect ?? "follow"
      const signal = init?.signal ?? undefined
      if (options.canRead && !options.canRead(url)) throw new TypeError("Failed to fetch")
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await this.answer(url, client, signal)
        const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null
        if (!location) return withUrl(response, url)
        const next = new URL(location, url).href
        options.redirects?.delete(url)
        options.redirects?.set(url, next)
        if (mode === "manual") return opaqueRedirect(url)
        if (mode === "error") throw new TypeError("Failed to fetch")
        if (options.canRead && !options.canRead(next)) throw new TypeError("Failed to fetch")
        url = next
      }
      throw new TypeError("Failed to fetch")
    }) as typeof fetch
  }
}

const withUrl = (response: Response, url: string) => {
  Object.defineProperty(response, "url", { value: url })
  return response
}

function opaqueRedirect(url: string) {
  const response = new Response(null)
  Object.defineProperties(response, { type: { value: "opaqueredirect" }, status: { value: 0 }, url: { value: url } })
  return response
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export const page = (title: string, body: string, status = 200, head = "") => new Response(`<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } })

export const redirectTo = (to: string, status = 302) => new Response(null, { status, headers: { location: to } })

// ---- What an address can answer

// The paper's PDF
export const pdf =
  (doi: string): Behaviour =>
  ({ web }) =>
    new Response(web.pdfOf(doi), { headers: { "content-type": "application/pdf" } })

// The paper's own page, its tags naming its PDF (Google Scholar's citation_pdf_url) and a link to it
export const landing =
  (doi: string, title: string, pdfUrl?: string): Behaviour =>
  () =>
    page(
      title,
      `<h1>${title}</h1>${pdfUrl ? `<a href="${pdfUrl}">PDF</a>` : ""}`,
      200,
      `<meta name="citation_title" content="${title}"><meta name="citation_doi" content="${doi}">${pdfUrl ? `<meta name="citation_pdf_url" content="${pdfUrl}">` : ""}`,
    )

// A page that only its scripts make anything of (APA PsycNet's), which the extension never runs
export const shell = (): Behaviour => () => page("APA PsycNet", '<div id="root"></div><script src="/static/js/main.js"></script>')

// A page that sends the browser on by a meta refresh (Elsevier's linkinghub)
export const metaRefresh =
  (to: string): Behaviour =>
  () =>
    page("Redirecting", `<p>Redirecting…</p>`, 200, `<meta http-equiv="REFRESH" content="2; url='${to}'">`)

export const redirect =
  (to: string, status = 302): Behaviour =>
  () =>
    redirectTo(to, status)

export const notFound = (): Behaviour => () => page("Page not found", "<h1>404</h1><p>The page you requested was not found.</p>", 404)

export const tooMany = (): Behaviour => () => page("Too Many Requests", "<p>Too many requests. Try again later.</p>", 429)

// An answer that doesn't come until FakeWeb.release, then as `then` says; aborted by the fetch's signal
export const hang =
  (then: Behaviour): Behaviour =>
  (visit) =>
    visit.web.holdUntilReleased(visit, then)

// An answer that doesn't come, the fetch's own signal or not: a page that froze, for FakeWeb.release alone
export const stall =
  (then: Behaviour): Behaviour =>
  ({ signal: _signal, ...visit }) =>
    visit.web.holdUntilReleased(visit, then)

// Cloudflare's check in front of the address, until the user passes it in their browser (clear)
export const cloudflareCheck = (): Response =>
  page("Just a moment...", '<div id="challenge-form"></div><script>window._cf_chl_opt={cvId:"3"}</script><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>', 403)

export const checked =
  (then: Behaviour): Behaviour =>
  (visit) =>
    visit.web.isCleared(visit.url.hostname, visit.client) ? then(visit) : cloudflareCheck()

// Cloudflare's block page: the firewall turns this network away, with nothing to pass
export const cloudflareBlock = (host: string): Response =>
  page("Attention Required! | Cloudflare", `<div class="cf-error-details"><h1 data-translate="block_headline">Sorry, you have been blocked</h1><h2>You are unable to access ${host}</h2></div>`, 403)

export const firewalled =
  (then: Behaviour): Behaviour =>
  (visit) =>
    visit.web.isBlocked(visit.url.hostname) ? cloudflareBlock(visit.url.hostname) : then(visit)

// A publisher's own sign-in page
export const publisherLogin = (): Behaviour => () => page("Sign in", '<form action="/action/doLogin"><input name="login"><input type="password" name="password"><button>Sign in</button></form>')

// The paper for a subscriber: one signed in at this publisher or at a library proxy in front of it.
// Anyone else is sent to the publisher's sign-in at loginPath.
export const subscribed =
  (then: Behaviour, loginPath = "/action/showLogin"): Behaviour =>
  (visit) =>
    visit.web.anySignIn(visit.client) ? then(visit) : redirectTo(`https://${visit.url.hostname}${loginPath}?redirectUri=${encodeURIComponent(visit.url.pathname)}`)

// A step of an institution's sign-in, as a publisher's page sends the reader through it: a form that posts
// itself, which a fetch stops at and a tab walks. A tab that loads it comes out at back with the
// publisher's session (clear on host); walks: false, one whose step never goes on.
export const ssoStep =
  (host: string, back: string, { walks = true } = {}): Behaviour =>
  ({ web, from }) => {
    if (walks && from === "tab") web.clear(host)
    const answer = page("Redirecting", `<form method="post" action="${back}"><input type="hidden" name="SAMLResponse" value="x"></form><script>document.forms[0].submit()</script>`)
    if (walks) answer.headers.set(SENDS_TO, back)
    return answer
  }

// A school's sign-in (its identity provider), a password form
export const institutionSignIn = (): Behaviour => () => page("统一身份认证", '<form action="/do/off/ui/auth/login/check"><input name="i_user"><input type="password" name="i_pass"><button>登录</button></form>')

// ---- Library proxies

// Tsinghua's tlink: /go?url=<target> sends a signed-in reader on to the target and shows anyone else its
// gateway of sign-in buttons at the same address; /gologin goes to the school's sign-in. offCampus: a
// /gologin without a callback ends on a page that looks signed in, and /go still asks.
export function tlink(web: FakeWeb, host = "tlink.lib.tsinghua.edu.cn", idp = "id.tsinghua.edu.cn", { offCampus = false } = {}): FakeWeb {
  web.on(`${host}/go?`, ({ url, client, web }) => {
    // Not encoded: the target rides as it is after url= (route.ts throughProxy)
    const target = url.search.replace(/^\?url=/, "")
    if (web.isSignedIn(host, client)) return redirectTo(target)
    return page("清华大学图书馆 tlink", `<a href="https://${host}/gologin">校内登录</a><a href="https://${host}/gologin?type=carsi">CARSI</a>`)
  })
  web.on(`${host}/gologin`, ({ url }) => (offCampus && !url.searchParams.has("callback") ? page("清华大学图书馆", "<h1>电子资源</h1><p>欢迎</p>") : redirectTo(`https://${idp}/do/off/ui/auth/login/form/abc`)))
  web.on(`${idp}/`, institutionSignIn())
  return web
}

// An EZproxy that rewrites hosts: www.science.org is www-science-org.<host>. A signed-in reader gets the
// publisher's own answer at the rewritten address; anyone else is sent to its /login?url=.
export function ezproxy(web: FakeWeb, host = "ezproxy.example.edu"): FakeWeb {
  web.on(
    (url) => url.hostname.endsWith(`.${host}`),
    async ({ url, client, web, signal, from }) => {
      const targetHost = url.hostname.slice(0, -host.length - 1).replace(/-/g, ".")
      const target = `https://${targetHost}${url.pathname}${url.search}`
      if (!web.isSignedIn(host, client)) return redirectTo(`https://${host}/login?url=${target}`)
      const answer = await web.answer(target, client, signal, from)
      const location = answer.headers.get("location")
      if (!location) return answer
      const to = new URL(location, target)
      to.hostname = `${to.hostname.replace(/\./g, "-")}.${host}`
      return redirectTo(to.href, answer.status)
    },
  )
  web.on(`${host}/login`, () => page("EZproxy Login", '<form action="/login"><input name="user"><input type="password" name="pass"><button>Login</button></form>'))
  return web
}
