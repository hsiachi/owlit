import { siteOf } from "./browser-routes.ts"

// Where a tab owlit opened in the user's browser ended up, when the PDF it was sent for didn't come.
// Read from the tab's address and title only, and by what kind of site it is rather than which: the
// publisher owlit sent it to (or the library proxy's rewrite of it), the proxy's own pages, or anyone
// else, which is where schools sign their readers in (CAS, Shibboleth, OpenAthens, CARSI, Microsoft,
// Google). No school or proxy product is named. Words only break ties.
//
// What a real run showed (2026-10-14, Dia, tlink off campus): SAGE answering an institution without the
// journal with its abstract page; T&F with "Get Access"; tlink with /ui/unauthorized for a resource the
// library hasn't got; its proxy with /ui/minute-limit ("Access Denied") when asked too often; the
// school's sign-in on id.tsinghua.edu.cn; Cloudflare's "Just a moment..." in front of a download; the
// ACM's "ACM Error: 404" at the PDF address of an ACL paper it lists without the PDF.
export type Ended =
  // A check in front of the page (Cloudflare and the like)
  | "check"
  // Still at the PDF's address with no file: something on the page wants an answer (Safari's "allow
  // downloads?"), or the download is stuck
  | "on-pdf"
  // A "not found" page: nothing there to save, and nothing for the user to answer
  | "missing"
  // At the publisher, but sent on from the PDF to its abstract or its access page
  | "no-access"
  // A sign-in: the school's, the proxy's
  | "sign-in"
  // The proxy asks for fewer requests
  | "limit"
  // The proxy says the library hasn't got it
  | "refused"
  // An article page owlit opened for the user landed somewhere that is none of the above: there, as meant
  | "landed"
  | "unknown"

export interface Sent {
  // The address the user's browser was sent to, before any proxy
  address: string
  // The library proxy it went through, if it did
  proxy?: string
  // An article page for the user to save the PDF from, not the PDF itself. Its address may be doi.org,
  // so where it lands says nothing about the publisher.
  page?: boolean
}

// Cloudflare's and the like's interstitials, by their title
export const isCheckTitle = (title: string) => CHECK.test(title)
const CHECK = /just a moment|attention required|security check|checking your browser|verify you are human|are you a robot|请稍候|正在验证|安全检查/i
const LIMIT = /(minute|rate|request|access)-?limit|too-?many/i
// Whole words only (a host's labels, a path's segments, a title's words): "sso" is in "Lessons" and
// "Association", "auth" begins "Author" and "Authentic", and doi.org sends article pages with such
// titles to publishers owlit doesn't know (2026-10-15, BMJ's and the APA's stopped runs as sign-ins).
// camelCase is read as words too, for /LoginForm and /userLogin.
const SIGN_IN = /(?<![a-z])(log-?(in|on)s?|sign-?(in|on)|sso(login)?|saml|cas|idp|shibboleth|openathens|wayf|o?auth(n|server|enticate|entication)?)(?![a-z])|登录|认证|身份/i
const signIn = (text: string) => SIGN_IN.test(text) || SIGN_IN.test(text.replace(/([a-z])([A-Z])/g, "$1 $2"))
const PAYWALL = /get access|access options|purchase|buy article|\brent\b|subscribe|institutional access|购买|订阅/i
const MISSING = /\b(404|410)\b|not found|page (doesn't|does not) exist|找不到|不存在/i
const REFUSED = /unauthori[sz]ed|denied|forbidden|no access|not subscribed|无权|未授权|没有权限/i

export function whereItEnded(tab: { url: string; title: string }, sent: Sent): Ended {
  let at: URL, to: URL
  try {
    at = new URL(tab.url)
    to = new URL(sent.address)
  } catch {
    return "unknown"
  }
  if (!/^https?:$/.test(at.protocol)) return "unknown"
  const title = tab.title ?? ""
  // Host and path only: sign-in pages carry the target in their query (RelayState, service=, url=),
  // which would make them look like the publisher
  let path = at.pathname
  try {
    path = decodeURIComponent(at.pathname)
  } catch {
    // A path that isn't valid percent-encoding is read as it is
  }
  const where = `${at.hostname}${path}`
  if (isCheckTitle(title)) return "check"
  // By the title only: a not-found page keeps the address it was asked for
  if (MISSING.test(title)) return "missing"
  const publisher = siteOf(to.hostname)
  if (mentions(at, publisher)) {
    // Still where the PDF is (directly, or as the end of a proxy's rewritten path), unless the page
    // there is the publisher's offer to buy or sign in (T&F keeps the PDF's address under "Get Access")
    const atPdf = at.pathname === to.pathname || at.pathname.endsWith(to.pathname)
    return atPdf && !PAYWALL.test(title) ? "on-pdf" : "no-access"
  }
  if (LIMIT.test(at.pathname) || /too many requests|rate limit|频繁/i.test(title)) return "limit"
  // A proxy's rewrite of some publisher's page (/https/443/com/sciencedirect/…, or
  // www-sciencedirect-com.proxy.example.edu): an article page through the library, which may carry any
  // words in its path
  if (/^\/https?\/\d+\//.test(at.pathname) || /-(com|org|net|edu|gov)\./.test(at.hostname)) return sent.page ? "landed" : "no-access"
  if (signIn(where) || signIn(title)) return "sign-in"
  if (REFUSED.test(where) || REFUSED.test(title)) return "refused"
  if (sent.proxy) {
    const proxy = new URL(sent.proxy)
    // Still on the proxy's entry (Tsinghua's tlink answers /go?url= with a gateway of sign-in buttons
    // while signed out); elsewhere on the proxy, it has said no
    if (siteOf(at.hostname) === siteOf(proxy.hostname)) return at.pathname === proxy.pathname || at.pathname === "/" ? "sign-in" : "refused"
  }
  // Somewhere neither the publisher nor the proxy: for a PDF, where schools sign their readers in; for an
  // article page, the publisher doi.org sent it to
  return sent.page ? "landed" : "sign-in"
}

// The page is the publisher's: its own site, or a proxy's rewrite of it, by host (EZproxy's
// journals-sagepub-com.proxy.example.edu) or by path (/https/443/com/sagepub/journals/...)
function mentions(at: URL, site: string) {
  if (siteOf(at.hostname) === site) return true
  const dashed = site.replace(/\./g, "-")
  if (at.hostname.includes(dashed)) return true
  return at.pathname.toLowerCase().includes(`/${site.split(".").reverse().join("/")}/`)
}
