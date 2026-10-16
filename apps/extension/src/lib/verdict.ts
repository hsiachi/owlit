import type { WorkEnding } from "@owlit/protocol"

// What a page that came instead of a PDF says, in owlit's one word for it: a check in front of the page,
// a sign-in (the library proxy's, a school's, a publisher's), the library's proxy saying it hasn't got the
// paper, a page that isn't there, an offer to buy or get access, or none of these (no copy). Read from
// where the fetch ended, its status, and its HTML as text, so it runs the same in the background, on a
// tab's document and in a test.
//
// What a real run showed (Dia, Tsinghua's tlink off campus): SAGE answering an institution without the
// journal with its abstract page; T&F with "Get Access"; tlink with /ui/unauthorized for a resource the
// library hasn't got, /ui/minute-limit when asked too often, and its gateway of sign-in buttons at
// /go?url= while signed out; the school's sign-in on id.tsinghua.edu.cn; Cloudflare's "Just a moment..."
// in front of a download; the ACM's "ACM Error: 404".

export interface Page {
  // Where the fetch ended, after redirects
  url: string
  // 0 when it isn't known (a tab's document)
  status: number
  html: string
  // Fetched through the library's proxy: its host, and the address the fetch started at
  proxy?: { host: string; entry?: string }
}

// Cloudflare's and the like's interstitials, by their title
const CHECK_TITLE = /just a moment|attention required|security check|checking your browser|verify you are human|are you a robot|请稍候|正在验证|安全检查/i
// By the page's own markup: Cloudflare's challenge, AWS WAF's, DataDome's and PerimeterX's
const CHECK_MARKUP = /id=["']?challenge-form|cf-browser-verification|cf_chl_opt|\/cdn-cgi\/challenge-platform|awswaf|AwsWafIntegration|captcha-delivery\.com|px-captcha/i
// A captcha counts as a check only on a page that refused the request: an article page may carry one
// for its comment form
const CAPTCHA_MARKUP = /class=["'][^"']*\b(g-recaptcha|h-captcha)\b|challenges\.cloudflare\.com\/turnstile|id=["']?captcha\b/i
const LIMIT = /(minute|rate|request|access)-?limit|too-?many/i
const LIMIT_TITLE = /too many requests|rate limit|频繁/i
// Whole words only (a host's labels, a path's segments, a title's words): "sso" is in "Lessons" and
// "Association", "auth" begins "Author" and "Authentic". camelCase is read as words too, for /LoginForm
// and /userLogin.
const SIGN_IN = /(?<![a-z])(log-?(in|on)s?|sign-?(in|on)|sso(login)?|saml|cas|idp|shibboleth|openathens|wayf|o?auth(n|server|enticate|entication)?)(?![a-z])|登录|认证|身份/i
const signIn = (text: string) => SIGN_IN.test(text) || SIGN_IN.test(text.replace(/([a-z])([A-Z])/g, "$1 $2"))
// A sign-in path on the proxy's own host
const PROXY_SIGN_IN = /log-?in|sign-?in|sso|\/cas\b/i
const PASSWORD = /<input\b[^>]*\btype\s*=\s*["']?password\b/i
const PAYWALL = /get access|access options|purchase|buy article|\brent\b|subscribe|institutional access|购买|订阅/i
// The words of a control on the page that offers access rather than the paper: APA PsycNet's "Get
// Access", Elsevier's "Get access", Springer's "Buy article PDF", ScienceDirect's "Purchase PDF",
// "Access through your institution"
const ACCESS_OFFER = /^(get (full )?access|buy|purchase|rent)\b|access through your institution|institutional (login|access)|access options|^subscribe\b|购买|订阅/i
const MISSING = /\b(404|410)\b|not found|page (doesn't|does not) exist|找不到|不存在/i
const REFUSED = /unauthori[sz]ed|denied|forbidden|no access|not subscribed|无权|未授权|没有权限/i

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
    return ENTITIES[name.toLowerCase()] ?? whole
  })
const words = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()

export const titleOf = (html: string) => words(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")

// A host's registrable domain, without the public suffix list: the last two labels, or three under a
// country's second level (ac.uk, edu.cn). core's extension/route.ts siteOf, copied: change them together.
export function siteOf(host: string) {
  const labels = host.toLowerCase().split(".").filter(Boolean)
  const country = labels.length >= 3 && labels.at(-1)!.length === 2 && /^(ac|co|com|edu|gov|net|org)$/.test(labels.at(-2)!)
  return labels.slice(country ? -3 : -2).join(".")
}

// A paper's own page carries Google Scholar's tags; a sign-in or a gateway page doesn't
const isArticle = (html: string) => /<meta\b[^>]*\bname\s*=\s*["']?citation_title\b/i.test(html)

// The words of the page's links and buttons, for an offer of access in place of the paper
function offersAccess(html: string) {
  for (const control of html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (ACCESS_OFFER.test(words(control[2]))) return true
  }
  return false
}

export function isCheck(page: Pick<Page, "status" | "html">) {
  const refused = page.status === 403 || page.status === 429 || page.status === 503
  return CHECK_TITLE.test(titleOf(page.html)) || CHECK_MARKUP.test(page.html) || (refused && CAPTCHA_MARKUP.test(page.html))
}

export function verdict(page: Page): WorkEnding {
  let at: URL
  try {
    at = new URL(page.url)
  } catch {
    return "no-copy"
  }
  const title = titleOf(page.html)
  if (isCheck(page)) return "check"
  if (page.status === 404 || page.status === 410) return "not-there"
  // The proxy asks for fewer requests: nothing was decided about the paper, so it is a try that reached
  // nothing, and owlit looks again later
  if ((page.proxy && LIMIT.test(at.pathname)) || LIMIT_TITLE.test(title) || page.status === 429) return "offline"
  // Host and path only: sign-in pages carry the target in their query (RelayState, service=, url=)
  let path = at.pathname
  try {
    path = decodeURIComponent(at.pathname)
  } catch {
    // A path that isn't valid percent-encoding is read as it is
  }
  // A proxy's rewrite of some publisher's page (/https/443/com/sciencedirect/…, or
  // www-sciencedirect-com.proxy.example.edu): an article page through the library, whatever its path says
  const rewritten = /^\/https?\/\d+\//.test(at.pathname) || /-(com|org|net|edu|gov)\./.test(at.hostname)
  if (page.proxy && !rewritten && siteOf(at.hostname) === siteOf(page.proxy.host)) {
    const entry = page.proxy.entry ? safeUrl(page.proxy.entry) : undefined
    const onEntry = !!entry && entry.hostname === at.hostname && entry.pathname === at.pathname
    if (at.hostname === page.proxy.host && (onEntry || PROXY_SIGN_IN.test(at.pathname) || at.pathname === "/")) return "sign-in"
    // The school's own sign-in, under the same domain (id.tsinghua.edu.cn beside tlink)
    if (!isArticle(page.html) && (PASSWORD.test(page.html) || signIn(`${at.hostname}${path}`) || signIn(title))) return "sign-in"
    if (REFUSED.test(path) || REFUSED.test(title)) return "not-offered"
    // Elsewhere on the proxy's own pages, it has said no
    if (!isArticle(page.html)) return "not-offered"
  }
  if (!isArticle(page.html)) {
    if (PASSWORD.test(page.html) || signIn(`${at.hostname}${path}`) || signIn(title)) return "sign-in"
  }
  if (MISSING.test(title)) return "not-there"
  if (PAYWALL.test(title) || offersAccess(page.html)) return "no-access"
  return "no-copy"
}

// Whether the user got through at this page: it is neither a check nor a sign-in
export const isThrough = (page: Page) => {
  const said = verdict(page)
  return said !== "check" && said !== "sign-in"
}

function safeUrl(text: string) {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}
