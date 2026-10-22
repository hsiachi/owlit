import { describe, expect, it } from "vitest"
import { isThrough, siteOf, titleOf, verdict, type Page } from "./verdict.ts"

const page = (url: string, html: string, extra: Partial<Page> = {}): Page => ({ url, status: 200, html, ...extra })
const article = (title: string, body = "") => `<html><head><title>${title}</title><meta name="citation_title" content="${title}"></head><body>${body}</body></html>`
const tlink = { host: "tlink.lib.tsinghua.edu.cn", entry: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/1" }

describe("what a page that came instead of a PDF says", () => {
  it("knows a check in front of the page", () => {
    expect(verdict(page("https://dl.acm.org/doi/10.1145/1", "<title>Just a moment...</title>", { status: 403 }))).toBe("check")
    expect(verdict(page("https://www.science.org/doi/1", '<html><body><form id="challenge-form" action="/x"></form></body></html>', { status: 503 }))).toBe("check")
    expect(verdict(page("https://www.sciencedirect.com/science/article/pii/1", '<script src="https://abc.token.awswaf.com/challenge.js"></script>', { status: 202 }))).toBe("check")
    expect(verdict(page("https://journals.sagepub.com/doi/1", '<div class="g-recaptcha" data-sitekey="x"></div>', { status: 403 }))).toBe("check")
    // A captcha on an article page that answered is its comment form's
    expect(verdict(page("https://journals.sagepub.com/doi/1", article("A Paper", '<div class="g-recaptcha"></div>')))).toBe("no-copy")
    // Cloudflare's and AWS WAF's scripts ride on ordinary article pages too
    const acm = article("Jogger", '<script src="/cdn-cgi/challenge-platform/scripts/precursor/main.js"></script>')
    expect(verdict(page("https://dl.acm.org/doi/10.5555/2034396.2034432", acm))).toBe("no-copy")
    expect(isThrough({ url: "https://dl.acm.org/doi/10.5555/2034396.2034432", status: 0, html: acm })).toBe(true)
    expect(verdict(page("https://www.sciencedirect.com/science/article/pii/2", article("A Paper", '<script src="https://abc.token.awswaf.com/challenge.js"></script>')))).toBe("no-copy")
  })

  it("tells a firewall's block from a check", () => {
    // Cloudflare's block page carries the title its older checks had
    const cloudflare =
      '<title>Attention Required! | Cloudflare</title><div id="cf-error-details"><h1 data-translate="block_headline">Sorry, you have been blocked</h1><h2>You are unable to access bmj.com</h2></div>'
    expect(verdict(page("https://www.bmj.com/content/1", cloudflare, { status: 403 }))).toBe("blocked")
    expect(isThrough({ url: "https://www.bmj.com/content/1", status: 0, html: cloudflare })).toBe(false)
    const denied = '<title>Access denied | www.bmj.com used Cloudflare to restrict access</title><span>Error</span> <span class="cf-error-code">1020</span>'
    expect(verdict(page("https://www.bmj.com/content/1", denied, { status: 403 }))).toBe("blocked")
    const akamai = `<title>Access Denied</title><h1>Access Denied</h1>You don't have permission to access "http://www.example.com/doi/pdf/1" on this server.<p>Reference&#32;&#35;18&#46;abc</p>`
    expect(verdict(page("https://www.example.com/doi/pdf/1", akamai, { status: 403 }))).toBe("blocked")
    // Cloudflare's 5xx pages share the block page's markup, and a paper may write about being blocked
    expect(verdict(page("https://www.bmj.com/content/1", '<title>bmj.com | 522: Connection timed out</title><div id="cf-error-details">Error 522</div>', { status: 522 }))).not.toBe("blocked")
    expect(verdict(page("https://www.bmj.com/content/2", article("When You Have Been Blocked on Twitter")))).toBe("no-copy")
  })

  it("knows the library proxy's sign-in, the school's and a publisher's", () => {
    // tlink signed out answers its entry with a gateway of sign-in buttons, no password field
    expect(verdict(page(tlink.entry, "<title>清华大学图书馆</title><a href='/login'>校内登录</a>", { proxy: tlink }))).toBe("sign-in")
    expect(verdict(page("https://tlink.lib.tsinghua.edu.cn/sso/login", "<title>Login</title>", { proxy: tlink }))).toBe("sign-in")
    expect(verdict(page("https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/abc", "<title>清华大学用户电子身份服务系统</title>", { proxy: tlink }))).toBe("sign-in")
    expect(verdict(page("https://login.ezproxy.example.edu/menu", '<form><input type="password" name="pass"></form>', { proxy: { host: "ezproxy.example.edu" } }))).toBe("sign-in")
    expect(verdict(page("https://idp.example.edu/idp/profile/SAML2/Redirect/SSO", "<title>Web Login Service</title>"))).toBe("sign-in")
    expect(verdict(page("https://journals.sagepub.com/action/showLogin", '<title>Sign in</title><input type="password">'))).toBe("sign-in")
  })

  it("doesn't take an article's own words for a sign-in", () => {
    expect(verdict(page("https://dl.acm.org/doi/10.1145/2", article("Continuous Authentication of Smartphone Users")))).toBe("no-copy")
    expect(verdict(page("https://www.tandfonline.com/doi/full/1", article("Lessons from the Association of Authors")))).toBe("no-copy")
  })

  it("doesn't take a paywalled paper's page with a sign-in pop-up for a sign-in", () => {
    // Atypon (ACM, T&F, SAGE) tags the paper in Dublin Core, and its header carries a login form
    const popup = '<div class="login-popup"><form action="/action/doLogin"><input type="text" name="login"><input type="password" name="password"></form></div>'
    const atypon = (head: string, title = "Sleep and Memory: Psychological Science: Vol 31, No 5") => `<html><head><title>${title}</title>${head}</head><body>${popup}<a href="/action/access">Get Access</a></body></html>`
    expect(verdict(page("https://journals.sagepub.com/doi/10.1177/1", atypon('<meta name="dc.Title" content="Sleep and Memory">')))).toBe("no-access")
    expect(verdict(page("https://www.tandfonline.com/doi/full/1", atypon('<meta name="dc.Identifier" scheme="doi" content="10.1080/1">', "Login options: Sleep and Memory")))).toBe("no-access")
    expect(verdict(page("https://dl.acm.org/doi/10.1145/1", atypon('<meta property="og:type" content="article">', "Sleep and Memory | ACM SSO")))).toBe("no-access")
    expect(verdict(page("https://example.org/article/1", atypon('<meta name="citation_doi" content="10.1/1">')))).toBe("no-access")
    // A page with no paper's tags and a password field is a sign-in
    expect(verdict(page("https://journals.sagepub.com/action/showLogin", `<title>SAGE Journals</title>${popup}`))).toBe("sign-in")
  })

  it("knows the proxy saying the library hasn't got it", () => {
    expect(verdict(page("https://tlink.lib.tsinghua.edu.cn/ui/unauthorized", "<title>Unauthorized</title>", { proxy: tlink }))).toBe("not-offered")
    expect(verdict(page("https://tlink.lib.tsinghua.edu.cn/ui/notice", "<title>资源未订阅</title>", { proxy: tlink }))).toBe("not-offered")
    // The proxy's rewrite of a publisher's page is the publisher's page, whatever its path says
    expect(verdict(page("https://journals-sagepub-com.ezproxy.example.edu/doi/abs/1", article("A Paper", "<a href='/x'>Get Access</a>"), { proxy: { host: "ezproxy.example.edu" } }))).toBe("no-access")
  })

  it("asks again later when the proxy asks for fewer requests", () => {
    expect(verdict(page("https://tlink.lib.tsinghua.edu.cn/ui/minute-limit", "<title>Access Denied</title>", { proxy: tlink }))).toBe("offline")
  })

  it("knows a page that isn't there", () => {
    expect(verdict(page("https://dl.acm.org/doi/pdf/10.3115/1", "<title>ACM Error: 404</title>", { status: 200 }))).toBe("not-there")
    expect(verdict(page("https://psycnet.apa.org/doi/1", "<title>Whatever</title>", { status: 404 }))).toBe("not-there")
    expect(verdict(page("https://doi.org/10.1/x", "<title>DOI Not Found</title>"))).toBe("not-there")
  })

  it("knows an offer to buy or get access", () => {
    expect(verdict(page("https://www.tandfonline.com/doi/full/1", article("A Paper", '<a class="btn" href="/action/access">Get access</a>')))).toBe("no-access")
    expect(verdict(page("https://link.springer.com/article/1", article("A Paper", "<button>Buy article PDF</button>")))).toBe("no-access")
    expect(verdict(page("https://www.sciencedirect.com/science/article/pii/1", article("A Paper", "<a href='#'>Access through your institution</a>")))).toBe("no-access")
    expect(verdict(page("https://journals.sagepub.com/doi/1", "<title>Purchase this article</title>"))).toBe("no-access")
  })

  it("says no copy for anything else", () => {
    expect(verdict(page("https://journals.sagepub.com/doi/1", article("A Paper", "<p>Abstract</p>")))).toBe("no-copy")
    expect(verdict(page("not an address", ""))).toBe("no-copy")
  })

  it("tells when the user got through", () => {
    expect(isThrough(page("https://journals.sagepub.com/doi/1", article("A Paper")))).toBe(true)
    expect(isThrough(page("https://dl.acm.org/doi/1", "<title>Just a moment...</title>"))).toBe(false)
    expect(isThrough(page("https://tlink.lib.tsinghua.edu.cn/", "<title>tlink</title>", { proxy: { host: "tlink.lib.tsinghua.edu.cn" } }))).toBe(false)
  })

  it("reads a title and a site", () => {
    expect(titleOf("<title>\n  Sign &amp; in </title>")).toBe("Sign & in")
    expect(siteOf("journals.sagepub.com")).toBe("sagepub.com")
    expect(siteOf("id.tsinghua.edu.cn")).toBe("tsinghua.edu.cn")
  })
})
