import type { WorkEnding } from "@owlit/protocol"
import { describesPaper, pdfLinkIn, siteOf } from "./page.ts"

export { siteOf }

// What a page that came instead of a PDF says, in owlit's one word for it: a check in front of the page,
// the site's firewall turning this browser away (blocked), a sign-in (the library proxy's, a school's, a
// publisher's), the library's proxy saying it hasn't got the paper, a page that isn't there, the paper's
// page offering to buy or get access to it, the paper's page naming a PDF that didn't come (no copy), or
// a page the extension can't be sure of (unreadable), which the user looks at by hand. Read from where
// the fetch ended, its status, its headers when there are any, and its HTML as text, so it runs the same
// in the background, on a tab's document and in a test. fixtures/real/ holds the recorded pages it is
// checked against.
//
// What a real run showed (Dia, Tsinghua's tlink off campus): SAGE answering an institution without the
// journal with its abstract page; T&F with "Get Access"; tlink with /ui/unauthorized for a resource the
// library hasn't got, /ui/minute-limit when asked too often, and its gateway of sign-in buttons at
// /go?url= while signed out; the school's sign-in on id.tsinghua.edu.cn; Cloudflare's "Just a moment..."
// in front of a download; the ACM's "ACM Error: 404". And pages that only scripts make anything of, which
// the extension never runs: APA PsycNet's shell of a page, Elsevier's linkinghub "Redirecting" (a meta
// refresh, which work.ts follows). On a campus network with access everywhere: Thieme's, Fastly's (JSTOR)
// and Akamai's (MDPI) script checks, AWS WAF's (IEEE) as a 202 with no body, and article pages whose
// headers and footers say "Subscribe", "Purchase" and "Institutional Login" to readers who have the paper.

export interface Page {
  // Where the fetch ended, after redirects
  url: string
  // 0 when it isn't known (a tab's document)
  status: number
  html: string
  // Fetched through the library's proxy: its host, and the address the fetch started at
  proxy?: { host: string; entry?: string }
  // The response's headers; none for a tab's document. AWS WAF's challenge says what it is only here.
  headers?: { get(name: string): string | null }
}

// Cloudflare's and the like's interstitials, by their title
const CHECK_TITLE = /just a moment|attention required|security check|checking your browser|verify you are human|are you a robot|client challenge|请稍候|正在验证|安全检查/i
// By the page's own markup: Cloudflare's challenge, DataDome's and PerimeterX's. Cloudflare also puts its
// bot scripts on ordinary pages, at /cdn-cgi/challenge-platform/scripts/… (ACM's articles) and
// /cdn-cgi/challenge-platform/h/b/scripts/jsd/… (the page it lets through once its check is passed), so
// only the interstitial's orchestrate script counts; and a paper's own page is never the interstitial,
// whatever scripts it carries. Fastly's client challenge serves its scripts from /_fs-ch-<id>/, which
// JSTOR's article pages carry too once it is passed. Akamai Bot Manager's interstitial posts to
// /_sec/verify and refreshes to ?bm-verify=.
const CHECK_MARKUP =
  /id=["']?challenge-form|cf-browser-verification|cf_chl_opt|\/cdn-cgi\/challenge-platform\/(h\/[a-z]\/)?orchestrate\/|captcha-delivery\.com|px-captcha|\/_fs-ch-[\w-]+\/|\/_sec\/verify\?provider=interstitial|\/akamai\/interstitial\.html|[?&]bm-verify=/i
// A site's own script check behind a stand-in's title: Thieme's "Please wait" runs /…/challenge-<hash>.js
const CHALLENGE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\bchallenge\b[^"'\s>]*\.js/i
// AWS WAF's script is on the pages of sites that use it whether or not they challenge; it is a check
// only on the 202 (or a refusal) WAF answers a challenge with
const WAF_MARKUP = /awswaf|AwsWafIntegration/i
// The firewall turning the browser away with nothing to pass, which only another network (or time) gets
// past: Cloudflare's block page ("Sorry, you have been blocked", its Access denied 10xx errors) and
// Akamai's Access Denied with its reference number. Read before the check: Cloudflare's block page has
// the title its older checks had, "Attention Required!". Its 5xx error pages share the block page's
// markup (cf-error-details), so only the block's words and codes count.
const BLOCK_MARKUP = /data-translate=["']?block_headline/i
const BLOCK_WORDS = /you have been blocked|used cloudflare to restrict access|\berror (1005|1006|1007|1008|1009|1012|1020)\b/i
const AKAMAI_BLOCK = /you don't have permission to access .* on this server\.? reference #\d/i
// A captcha counts as a check only on a page that refused the request: an article page may carry one
// for its comment form
const CAPTCHA_MARKUP = /class=["'][^"']*\b(g-recaptcha|h-captcha)\b|challenges\.cloudflare\.com\/turnstile|id=["']?captcha\b/i
const LIMIT = /(minute|rate|request|access)-?limit|too-?many/i
const LIMIT_TITLE = /too many requests|rate limit|频繁/i
// Whole words only (a host's labels, a path's segments, a title's words): "sso" is in "Lessons" and
// "Association", "auth" begins "Author" and "Authentic". camelCase is read as words too, for /LoginForm
// and /userLogin.
const SIGN_IN = /(?<![a-z])(log[- ]?(in|on)s?|sign[- ]?(in|on)|sso(login)?|saml|cas|idp|shibboleth|openathens|wayf|o?auth(n|server|enticate|entication)?)(?![a-z])|登录|认证|身份/i
const signIn = (text: string) => SIGN_IN.test(text) || SIGN_IN.test(text.replace(/([a-z])([A-Z])/g, "$1 $2"))
// A sign-in path on the proxy's own host
const PROXY_SIGN_IN = /log-?in|sign-?in|sso|\/cas\b/i
const PASSWORD = /<input\b[^>]*\btype\s*=\s*["']?password\b/i
const PAYWALL = /get access|access options|purchase|buy article|\brent\b|subscribe|institutional access|购买|订阅/i
// A control's whole words that offer access to this paper: Atypon's "Get Access", Springer's "Buy article
// PDF", ScienceDirect's "Purchase PDF" and "Access through your institution", SAGE's "View access
// options". Whole, since a site's header and footer offer the journal ("Subscribe", "Purchase", "Purchase
// Access to Other Journals") and a sign-in ("Institutional Login") on every page, the paper's included.
const ACCESS_OFFER =
  /^((get|check) (full |instant )?access( now)?|buy (this )?(article|chapter|paper)( pdf)?|buy pdf|purchase (this )?(article|chapter|paper|pdf|access)|purchase pdf|rent( this)?( article| chapter)?|access through your institution|(view )?access options|购买(本文|全文|文章|PDF)?|获取全文)$/i
const MISSING = /\b(404|410)\b|not found|page (doesn't|does not) exist|找不到|不存在/i
// A page that stands in while its scripts go on somewhere: never the paper's page, whatever its tags
const INTERSTITIAL_TITLE = /^(please wait|redirecting|loading)\b|^(请稍等|正在跳转|加载中)/i
const REFUSED = /unauthori[sz]ed|denied|forbidden|no access|not subscribed|无权|未授权|没有权限|未订阅/i

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
    return ENTITIES[name.toLowerCase()] ?? whole
  })
const words = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()

// The document's title, not an icon's: IEEE Xplore's pages put SVGs with empty <title>s before their own
export function titleOf(html: string) {
  for (const found of html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)) {
    const before = html.slice(0, found.index).toLowerCase()
    if (before.lastIndexOf("<svg") <= before.lastIndexOf("</svg")) return words(found[1])
  }
  return ""
}

// A paper's own page carries its tags: Google Scholar's (citation_title, citation_doi), Dublin Core's
// (dc.Title, dc.Identifier: Atypon's ACM, T&F and SAGE pages often have only these) or Open Graph's
// article type; a sign-in or a gateway page doesn't. A paywalled paper's page often has a login pop-up
// in its header, password field and all, so the sign-in signs below count only on a page without them.
const PAPER_TAG = /\b(name|property)\s*=\s*["']?(citation_title|citation_doi|dc\.title|dc\.identifier)["'\s/>]/i
const ARTICLE_TYPE = /\bproperty\s*=\s*["']?og:type["'\s]/i
// Without them, the markup page.ts reads a paper from (JSTOR's JSON-LD, IEEE Xplore's script) says so.
const isArticle = (html: string) => {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (PAPER_TAG.test(tag) || (ARTICLE_TYPE.test(tag) && /\bcontent\s*=\s*["']?article\b/i.test(tag))) return true
  }
  return describesPaper(html)
}

// The words of the page's links and buttons, for an offer of access to the paper
function offersAccess(html: string) {
  for (const control of html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const said = words(control[2])
      .replace(/\(opens? in (a )?new (window|tab)\)/gi, "")
      .trim()
    if (ACCESS_OFFER.test(said)) return true
  }
  return false
}

export function isBlocked(page: Pick<Page, "html">) {
  if (BLOCK_MARKUP.test(page.html)) return true
  // A paper's page may say these words in its own text
  if (isArticle(page.html)) return false
  const text = words(page.html)
  return BLOCK_WORDS.test(text) || AKAMAI_BLOCK.test(text)
}

export function isCheck(page: Pick<Page, "status" | "html" | "headers">) {
  const refused = page.status === 403 || page.status === 429 || page.status === 503
  const title = titleOf(page.html)
  return (
    /^challenge$/i.test(page.headers?.get("x-amzn-waf-action") ?? "") ||
    /^challenge$/i.test(page.headers?.get("cf-mitigated") ?? "") ||
    CHECK_TITLE.test(title) ||
    (INTERSTITIAL_TITLE.test(title) && CHALLENGE_SCRIPT.test(page.html)) ||
    (CHECK_MARKUP.test(page.html) && !isArticle(page.html)) ||
    (refused && CAPTCHA_MARKUP.test(page.html)) ||
    ((refused || page.status === 202 || page.status === 405) && WAF_MARKUP.test(page.html))
  )
}

// A check that only a person passes, which no tab passes by waiting: Cloudflare's interactive challenge
// (cType 'interactive', ScienceDirect's "Are you a robot?"), a captcha to solve, DataDome's and
// PerimeterX's. Cloudflare's managed challenge (cType 'managed') passes by itself in a tab that runs it,
// and its tab document loads Turnstile too, so Turnstile alone says nothing here.
const INTERACTIVE = /\bcType:\s*["']interactive["']|are you a robot\?|captcha-delivery\.com|px-captcha|class=["'][^"']*\b(g-recaptcha|h-captcha)\b/i

export function isInteractive(page: Pick<Page, "status" | "html" | "headers">) {
  return isCheck(page) && INTERACTIVE.test(page.html)
}

// The path as written, decoded: a path that isn't valid percent-encoding is read as it is
function pathOf(at: URL) {
  try {
    return decodeURIComponent(at.pathname)
  } catch {
    return at.pathname
  }
}

// Whether an address alone says sign in, by its host and path only: sign-in pages carry the target in
// their query (RelayState, service=, url=)
export function isSignInAddress(url: string) {
  const at = safeUrl(url)
  return !!at && signIn(`${at.hostname}${pathOf(at)}`)
}

export function verdict(page: Page): WorkEnding {
  const at = safeUrl(page.url)
  if (!at) return "unreadable"
  const title = titleOf(page.html)
  if (isBlocked(page)) return "blocked"
  if (isCheck(page)) return "check"
  if (page.status === 404 || page.status === 410) return "not-there"
  // The proxy asks for fewer requests: nothing was decided about the paper, so it is a try that reached
  // nothing, and owlit looks again later
  if ((page.proxy && LIMIT.test(at.pathname)) || LIMIT_TITLE.test(title) || page.status === 429) return "offline"
  const path = pathOf(at)
  const article = isArticle(page.html)
  // A proxy's rewrite of some publisher's page (/https/443/com/sciencedirect/…, or
  // www-sciencedirect-com.proxy.example.edu): an article page through the library, whatever its path says
  const rewritten = /^\/https?\/\d+\//.test(at.pathname) || /-(com|org|net|edu|gov)\./.test(at.hostname)
  if (page.proxy && !rewritten && siteOf(at.hostname) === siteOf(page.proxy.host)) {
    const entry = page.proxy.entry ? safeUrl(page.proxy.entry) : undefined
    const onEntry = !!entry && entry.hostname === at.hostname && entry.pathname === at.pathname
    if (at.hostname === page.proxy.host && (onEntry || PROXY_SIGN_IN.test(at.pathname) || at.pathname === "/")) return "sign-in"
    // The school's own sign-in, under the same domain (id.tsinghua.edu.cn beside tlink): there the title
    // alone is enough, since the proxy sends a signed-out reader nowhere else
    if (!article && (PASSWORD.test(page.html) || signIn(`${at.hostname}${path}`) || signIn(title))) return "sign-in"
    if (REFUSED.test(path) || REFUSED.test(title)) return "not-offered"
    // Another of the proxy's own pages, which says nothing the extension knows
    if (!article) return "unreadable"
  }
  // Elsewhere a title alone is no sign-in an ending can rest on (isThrough still reads it as one)
  if (!article && (PASSWORD.test(page.html) || signIn(`${at.hostname}${path}`))) return "sign-in"
  if (INTERSTITIAL_TITLE.test(title)) return "unreadable"
  if (MISSING.test(title)) return "not-there"
  // Only the paper's own page can say what the site offers for the paper; any other page offering
  // access says so in its title or says nothing sure
  if (!article) return PAYWALL.test(title) ? "no-access" : "unreadable"
  // A link to the paper's PDF outweighs an offer: the offers on a page a reader has access to are its
  // site's, or hidden until a reader without it comes (SAGE's "Purchase access", Science's "Access
  // through your institution")
  const pdfLink = pdfLinkIn(page.html, page.url)
  if (!pdfLink && offersAccess(page.html)) return "no-access"
  // The paper's own page, and no PDF came of it: whether it names one (a viewer, a link that needs the
  // page's scripts) or none, the user can get it there by hand, and nothing on it says the site has none
  return "unreadable"
}

// A wait longer than this is a page meant to be read, not a hop
const REFRESH_MAX_S = 10

// Where a page that sends the browser on by a meta refresh goes. Not from the paper's own page: one may
// refresh to a sign-out once its session is old.
export function refreshOf(page: Pick<Page, "url" | "html">): string | undefined {
  // Nor from a check: Akamai's refreshes to ?bm-verify=, which asks the check again
  if (isArticle(page.html) || isCheck({ status: 0, html: page.html })) return undefined
  for (const [tag] of page.html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bhttp-equiv\s*=\s*["']?refresh\b/i.test(tag)) continue
    const quoted = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const said = /^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*url\s*=\s*(.+)$/i.exec(decode(quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? ""))
    if (!said || Number(said[1] ?? 0) > REFRESH_MAX_S) continue
    // The address may be quoted inside the content (linkinghub's url='/retrieve/…')
    const to = said[2].trim().replace(/^(["'])(.*)\1$/, "$2").trim()
    const at = to ? safeUrl(to, page.url) : undefined
    if (at && /^https?:$/.test(at.protocol) && at.href !== page.url) return at.href
  }
  return undefined
}

// Whether the user got through at this page: it is neither a check, a block, a sign-in nor a stand-in
// still on its way. Generous with sign-ins, unlike the ending verdict reports: a page that isn't the
// paper's and whose title says sign in (a publisher's "Log in" page with its form built by scripts) is
// one the user hasn't got past.
export function isThrough(page: Page) {
  const said = verdict(page)
  if (said === "check" || said === "blocked" || said === "sign-in") return false
  const title = titleOf(page.html)
  if (INTERSTITIAL_TITLE.test(title)) return false
  return isArticle(page.html) || !signIn(title)
}

function safeUrl(text: string, base?: string) {
  try {
    return new URL(text, base)
  } catch {
    return undefined
  }
}
