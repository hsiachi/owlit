import type { Task } from "@owlit/protocol"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, onTestFinished } from "vitest"
import { Core } from "../core.ts"
import { NeedsUser, NoPdfOnPage, type BrowserControl, type BrowserHost, type BrowserRequest, type Host } from "../host.ts"
import { makePdf } from "./text/make-pdf.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { browserRoutes, extensionRoute, pdfFromLanded, pdfLinkOn, signInWatch, siteOf, throughProxy, yourBrowser } from "./browser-routes.ts"
import { ACCESS_OFFER, pageVerdict } from "./where-it-ended.ts"

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n")

describe("library sign-in window", () => {
  const pages = (entry: string, seen: [string, boolean?][]) => {
    const watch = signInWatch(entry)
    return seen.map(([url, asking]) => watch({ url, asking: !!asking }))
  }

  it("is over once the university's login sent you back to the proxy", () => {
    expect(
      pages("https://tlink.lib.tsinghua.edu.cn", [
        ["about:blank"],
        ["https://tlink.lib.tsinghua.edu.cn/"],
        ["https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/abc", true],
        ["https://id.tsinghua.edu.cn/do/off/ui/auth/login/check"],
        ["https://tlink.lib.tsinghua.edu.cn/"],
        ["https://tlink.lib.tsinghua.edu.cn/"],
      ]),
    ).toEqual([false, false, false, false, false, true])
  })

  it("is over after a password on the proxy's own login page", () => {
    expect(
      pages("https://ezproxy.example.edu", [
        ["https://ezproxy.example.edu/login", true],
        ["https://ezproxy.example.edu/login"],
        ["https://ezproxy.example.edu/menu"],
        ["https://ezproxy.example.edu/menu"],
      ]),
    ).toEqual([false, false, false, true])
  })

  it("waits while a page asks again or the proxy is still on a login path", () => {
    expect(
      pages("https://ezproxy.example.edu", [
        ["https://idp.example.edu/sso", true],
        ["https://ezproxy.example.edu/menu"],
        ["https://ezproxy.example.edu/menu", true],
        ["https://ezproxy.example.edu/menu"],
        ["https://ezproxy.example.edu/menu"],
      ]),
    ).toEqual([false, false, false, false, true])
  })

  it("leaves an already signed-in proxy for you to close", () => {
    expect(pages("https://tlink.lib.tsinghua.edu.cn", [["https://tlink.lib.tsinghua.edu.cn/"], ["https://tlink.lib.tsinghua.edu.cn/"], ["https://tlink.lib.tsinghua.edu.cn/"]])).toEqual([false, false, false])
  })
})

describe("browser routes", () => {
  it("goes to the publisher's page, then through the proxy", () => {
    const routes = browserRoutes("10.1177/0956797620904990", { base: "https://tlink.lib.tsinghua.edu.cn/", scheme: "login-url", path: "/go" })
    expect(routes.map((r) => [r.name, r.landing, r.pdf])).toEqual([
      ["browser:sage", "https://journals.sagepub.com/doi/10.1177/0956797620904990", "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990"],
      ["browser:sage:proxied", "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/0956797620904990", "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990"],
    ])
    expect(routes[1].allowHosts).toContain("tlink.lib.tsinghua.edu.cn")
    expect(routes[0].browserOnly).toBeUndefined()
    expect(browserRoutes("10.9999/x", undefined)).toMatchObject([{ name: "browser:doi", landing: "https://doi.org/10.9999/x" }])
  })

  it("leaves the ACM to the user's own browser alone", () => {
    const routes = browserRoutes("10.1145/3613904.3642549", { base: "https://tlink.lib.tsinghua.edu.cn/", scheme: "login-url", path: "/go" })
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ name: "browser:acm", browserOnly: true })
  })

  it("sends the extension to the publisher's page and PDF, through the proxy where it is set", () => {
    const tlink = { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url" as const, path: "/go" }
    expect(extensionRoute("10.1177/0956797620904990", undefined)).toEqual({
      url: "https://journals.sagepub.com/doi/10.1177/0956797620904990",
      pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990",
      host: "sagepub.com",
      proxied: false,
    })
    expect(extensionRoute("10.1177/0956797620904990", tlink)).toEqual({
      url: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/0956797620904990",
      pdfUrl: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990",
      host: "tlink.lib.tsinghua.edu.cn",
      proxied: true,
      signIn: "https://tlink.lib.tsinghua.edu.cn/go",
    })
    // Open to all: never through the proxy
    expect(extensionRoute("10.1145/3613904.3642549", tlink)).toMatchObject({ url: "https://dl.acm.org/doi/10.1145/3613904.3642549", host: "acm.org", proxied: false })
    // A publisher owlit has no row for: where the DOI is registered, not doi.org
    expect(extensionRoute("10.1136/bmj.n71", undefined, "https://www.bmj.com/lookup/doi/10.1136/bmj.n71")).toEqual({ url: "https://www.bmj.com/lookup/doi/10.1136/bmj.n71", host: "bmj.com", proxied: false })
  })

  it("sends the user's browser to the PDF where it saves itself, else to the article page, through the proxy", () => {
    const tlink = { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url" as const, path: "/go" }
    expect(yourBrowser("10.1145/3613904.3642549")).toMatchObject({ url: "https://dl.acm.org/doi/pdf/10.1145/3613904.3642549?download=true", site: "acm.org", opens: "pdf" })
    // ACL's DOIs at the ACM, by where the paper was found to be
    expect(yourBrowser("10.3115/1654595.1654614", "dl.acm.org").url).toBe("https://dl.acm.org/doi/pdf/10.3115/1654595.1654614?download=true")
    // The ACM is open to all: never through the proxy
    expect(yourBrowser("10.1145/3613904.3642549", undefined, tlink).url).toBe("https://dl.acm.org/doi/pdf/10.1145/3613904.3642549?download=true")
    expect(yourBrowser("10.1177/0956797620904990", undefined, tlink)).toEqual({
      url: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990?download=true",
      address: "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990?download=true",
      proxy: "https://tlink.lib.tsinghua.edu.cn/go",
      site: "tsinghua.edu.cn",
      opens: "pdf",
    })
    expect(yourBrowser("10.1002/ijop.13191").url).toBe("https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ijop.13191?download=true")
    expect(yourBrowser("10.1002/ijop.13191", "doi.org").opens).toBe("pdf")
    expect(yourBrowser("10.1177/0956797620904990", "tlink.lib.tsinghua.edu.cn").opens).toBe("pdf")
    expect(yourBrowser("10.1016/j.cell.2020.01.001")).toMatchObject({ url: "https://doi.org/10.1016/j.cell.2020.01.001", site: "doi.org", opens: "page" })
    expect(yourBrowser("10.1007/s10586-023-04231-3")).toMatchObject({ url: "https://link.springer.com/article/10.1007/s10586-023-04231-3", opens: "page" })
  })

  it("follows the site a DOI is registered to, and lets the page go there", () => {
    // A journal that moved to SAGE keeps its 10.1111 (Wiley) DOIs
    expect(browserRoutes("10.1111/j.0963-7214.2005.00355.x", undefined, "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x")).toMatchObject([
      { name: "browser:sage", landing: "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x", pdf: "https://journals.sagepub.com/doi/pdf/10.1111/j.0963-7214.2005.00355.x" },
    ])
    // ACL's old DOIs live in the ACM's library
    expect(browserRoutes("10.3115/1654595.1654614", undefined, "http://portal.acm.org/citation.cfm?doid=1654595.1654614")[0]).toMatchObject({ name: "browser:acm", landing: "https://dl.acm.org/doi/10.3115/1654595.1654614" })
    // One that moved to OUP, which has no row: through doi.org, and OUP may be visited
    const oup = browserRoutes("10.1007/s12160-016-9830-8", undefined, "https://academic.oup.com/abm/article/52/6/446/4733473")[0]
    expect(oup).toMatchObject({ name: "browser:doi", landing: "https://doi.org/10.1007/s12160-016-9830-8" })
    expect(oup.allowHosts).toContain("oup.com")
    // doi.org sending the reader to BMJ or APA doesn't stop at a host it doesn't know
    expect(browserRoutes("10.1136/qhc.12.4.304", undefined, "https://qualitysafety.bmj.com/lookup/doi/10.1136/qhc.12.4.304")[0].allowHosts).toContain("bmj.com")
    expect(browserRoutes("10.1037/0022-3514.54.4.569", undefined, "https://doi.apa.org/doi/10.1037/0022-3514.54.4.569")[0].allowHosts).toContain("apa.org")
    // Not known: the prefix decides, as before
    expect(browserRoutes("10.1111/x", undefined)[0].name).toBe("browser:wiley")
    expect(siteOf("www.ncbi.nlm.nih.gov")).toBe("nih.gov")
    expect(siteOf("www.ucl.ac.uk")).toBe("ucl.ac.uk")
  })

  it("takes the page's own PDF link when it has no citation_pdf_url", () => {
    // APA PsycNet's full-text page, as captured from the site
    const page = "https://psycnet.apa.org/fulltext/2025-04548-001.html"
    expect(
      pdfLinkOn(page, [
        { text: "Supplemental Materials", href: "https://supp.apa.org/psycarticles/supplemental/xap0000515/supp.pdf" },
        { text: "\n  PDF\n", href: "https://psycnet.apa.org/fulltext/2025-04548-001.pdf" },
      ]),
    ).toBe("https://psycnet.apa.org/fulltext/2025-04548-001.pdf")
    expect(pdfLinkOn("https://example.org/article/1", [{ text: "Download PDF", href: "/article/1.pdf" }])).toBe("https://example.org/article/1.pdf")
    // Only a link labelled PDF, to a .pdf on the page's own site
    expect(pdfLinkOn(page, [{ text: "PDF", href: "https://elsewhere.com/a.pdf" }])).toBeUndefined()
    expect(pdfLinkOn(page, [{ text: "Author guidelines (PDF)", href: "https://psycnet.apa.org/guide.pdf" }])).toBeUndefined()
    expect(pdfLinkOn(page, [{ text: "PDF", href: "https://psycnet.apa.org/buy?item=1" }])).toBeUndefined()
    expect(pdfLinkOn(page, [{ text: "PDF", href: "javascript:void(0)" }])).toBeUndefined()
  })

  it("rewrites a host for an EZproxy that works by host names", () => {
    expect(throughProxy("https://dl.acm.org/doi/10.1145/1", { base: "https://proxy.lib.example.edu", scheme: "host-rewrite" })).toBe(
      "https://dl-acm-org.proxy.lib.example.edu/doi/10.1145/1",
    )
    expect(throughProxy("https://x.org/a", { base: "https://ezp.example.edu", scheme: "login-url" })).toBe("https://ezp.example.edu/login?url=https://x.org/a")
  })
})

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

// A browser that answers by route: a PDF, an error, or a challenge first
function fakeBrowser(answer: (request: BrowserRequest) => Promise<Uint8Array>) {
  const asked: BrowserRequest[] = []
  const browser: BrowserHost = {
    fetchPdf: (request) => {
      asked.push(request)
      return answer(request)
    },
    showLogin: async () => {},
  }
  return { browser, asked }
}

async function setup(
  browser: BrowserHost,
  library: object = {},
  registered: Record<string, string> = {},
  more: { serve?: (url: string, init?: RequestInit) => Response | undefined; host?: Partial<Host> } = {},
) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-browser-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  mkdirSync(path.join(base, "userData"))
  writeFileSync(path.join(base, "userData/settings.json"), JSON.stringify({ version: 1, recentWorkspaces: [], library }))
  // The plain routes get the publisher's sign-in page; doi.org's handle records say where a DOI is
  // registered when the test gives any
  const fetch = (async (url: string, init?: RequestInit) => {
    const doi = decodeURIComponent(url.match(/doi\.org\/api\/handles\/([^?]+)/)?.[1] ?? "")
    if (registered[doi]) return Response.json({ responseCode: 1, values: [{ type: "URL", data: { value: registered[doi] } }] })
    return more.serve?.(url, init) ?? new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch, browser, ...more.host }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const heard: Task[] = []
  core.onNotify((n) => n.method === "tasks.changed" && heard.push((n.params as { task: Task }).task))
  return { base, root, call, heard, workspace: (core as unknown as { workspace: Workspace }).workspace }
}

const sage = { id: "doi-10.1177-0956797620904990", title: "Paywalled", authors: [], ids: { doi: "10.1177/0956797620904990" } }

describe("paper.pdf.browser", () => {
  it("gets the PDF in the browser once the plain routes fail", async () => {
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const { root, call } = await setup(browser)
    await call("library.add", { paper: sage })
    const paper = await call("library.fetchPdf", { id: sage.id })
    expect(paper.pdf).toBeDefined()
    expect(asked[0]).toMatchObject({ landing: "https://journals.sagepub.com/doi/10.1177/0956797620904990", pdf: "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990", pdfOnPageHost: false })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "have-it", route: "browser:sage" })
    expect(acquisition.tried.map((t: { route: string; ended: string }) => `${t.route} ${t.ended}`)).toEqual(["publisher:sage no-copy", "browser:sage pdf"])
  })

  it("goes where the DOI is registered rather than where its prefix says", async () => {
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const moved = { id: "doi-10.1111-j.0963-7214.2005.00355.x", title: "Affective Forecasting", authors: [], ids: { doi: "10.1111/j.0963-7214.2005.00355.x" } }
    const { call } = await setup(browser, {}, { [moved.ids.doi]: "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x" })
    await call("library.add", { paper: moved })
    expect((await call("library.fetchPdf", { id: moved.id })).pdf).toBeDefined()
    expect(asked[0]).toMatchObject({ landing: "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x" })
    expect(asked[0].allowHosts).toContain("sagepub.com")
  })

  it("tries the proxy when the publisher's page gives nothing directly", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.landing.includes("tlink")) throw new Error("The page had no PDF for this reader.")
      return new Uint8Array(PDF)
    })
    const { root, call } = await setup(browser, { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } })
    await call("library.add", { paper: sage })
    expect((await call("library.fetchPdf", { id: sage.id })).pdf).toBeDefined()
    expect(asked.map((r) => r.pdfOnPageHost)).toEqual([false, true])
    expect(asked.map((r) => r.proxyHost)).toEqual([undefined, "tlink.lib.tsinghua.edu.cn"])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition.route).toBe("browser:sage:proxied")
  })

  it("marks the proxy signed out when a run finds its sign-in page, and signed in when a PDF comes through it", async () => {
    let signedIn = false
    const { browser } = fakeBrowser(async (request) => {
      if (!request.proxyHost) throw new Error("The page had no PDF for this reader.")
      if (!signedIn) throw new NeedsUser("login", request.proxyHost)
      return new Uint8Array(PDF)
    })
    const proxy = { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" }
    const { call } = await setup(browser, { proxy, proxySignedInAt: 1 })
    await call("library.add", { paper: sage })
    // The proxy's sign-in stands for the publisher behind it
    expect((await call("library.fetchPdf", { id: sage.id })).pdfState).toMatchObject({ state: "no-pdf", reason: { ended: "sign-in", host: "journals.sagepub.com", route: "browser:sage:proxied" } })
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeUndefined()
    signedIn = true
    expect((await call("library.fetchPdf", { id: sage.id })).pdf).toBeDefined()
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeGreaterThan(1)
  })

  it("leaves a page that wants a person to the user's own browser instead of waiting", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge")
    })
    const { root, call, heard } = await setup(browser)
    await call("library.add", { paper: sage })
    const paper = await call("library.fetchPdf", { id: sage.id })
    expect(paper.pdf).toBeUndefined()
    expect(paper.pdfState).toMatchObject({ state: "no-pdf", reason: { by: "owlit", ended: "check", route: "browser:sage" } })
    expect(heard.filter((t) => t.kind === "paper.pdf.browser").map((t) => t.state)).not.toContain("waiting_for_you")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition.tried.at(-1)).toMatchObject({ by: "owlit", ended: "check", route: "browser:sage" })
  })

  it("once a run the user waited on gets through, gets the same publisher's other papers by itself", async () => {
    // Their turns at the site are spaced out; here, not at all
    process.env.OWLIT_VISIT_GAP_MS = "0"
    onTestFinished(() => void delete process.env.OWLIT_VISIT_GAP_MS)
    // The site's check lets owlit's browser through again after a while
    let passed = false
    const { browser, asked } = fakeBrowser(async (request) => {
      const host = new URL(request.landing).hostname
      if (!passed || host !== "journals.sagepub.com") throw new NeedsUser("challenge", host)
      return new Uint8Array(PDF)
    })
    const sibling = { id: "doi-10.1177-0956797619877311", title: "Same publisher", authors: [], ids: { doi: "10.1177/0956797619877311" } }
    const other = { id: "doi-10.1080-09658211.2011.605591", title: "Another publisher", authors: [], ids: { doi: "10.1080/09658211.2011.605591" } }
    const { root, call } = await setup(browser)
    for (const paper of [sage, sibling, other]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    const newest = (id: string) => JSON.parse(readFileSync(path.join(root, "library/papers", id, "acquisition.json"), "utf8")).tried.at(-1)
    expect(newest(sage.id)).toMatchObject({ ended: "check", host: "journals.sagepub.com" })
    passed = true
    // Try again on the paper: a visit now, whatever the hold
    expect((await call("library.fetchPdf", { id: sage.id })).pdf).toBeDefined()
    let papers: Record<string, { pdf?: unknown; pdfState?: unknown }> = {}
    for (let i = 0; i < 100; i++) {
      papers = Object.fromEntries((await call("library.list")).papers.map((p: { id: string }) => [p.id, p]))
      if (papers[sibling.id]?.pdf) break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(papers[sibling.id].pdf).toBeDefined()
    expect(papers[other.id]).toMatchObject({ pdfState: { reason: { ended: "check" } } })
    expect(asked.filter((r) => r.landing.includes("tandfonline") || r.landing.includes("10.1080"))).toHaveLength(1)
  })

  it("ends with no PDF, saying what it tried", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new Error("Gave up waiting for the sign-in after 5 minutes.")
    })
    const { root, call } = await setup(browser)
    await call("library.add", { paper: sage })
    const paper = await call("library.fetchPdf", { id: sage.id })
    expect(paper.pdfState.tried.map((t: { route: string }) => t.route)).toEqual(["publisher:sage", "browser:sage"])
    expect(paper.pdfState).toMatchObject({ state: "no-pdf", reason: { ended: "no-copy", route: "browser:sage" } })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "no-pdf" })
  })
})

// Polls until check() holds; owlit's own work, not the clock, decides how long that takes
async function until<T>(check: () => Promise<T | undefined | false>): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const value = await check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error("It never happened.")
}

const sibling = { id: "doi-10.1177-0956797619877311", title: "Same publisher", authors: [], ids: { doi: "10.1177/0956797619877311" } }

describe("visiting publishers' sites", () => {
  it("leaves a site alone once it asked for a person, rather than visiting its other papers", async () => {
    const { browser, asked } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const { base, call, workspace } = await setup(browser)
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    await call("library.add", { paper: sibling })
    // Its own look after the add, and one more, as the daily retry would
    await until(async () => !workspace.tasks.list().some((t) => t.subject === sibling.id && t.kind.startsWith("paper.pdf") && !["done", "failed", "cancelled"].includes(t.state)))
    const task = workspace.tasks.enqueue("paper.pdf.browser", sibling.id, "background")
    await workspace.tasks.wait(task.id)
    expect(asked.map((r) => r.landing)).toEqual(["https://journals.sagepub.com/doi/10.1177/0956797620904990"])
    const papers = (await call("library.list")).papers
    expect(papers.find((p: { id: string }) => p.id === sibling.id).pdfState).toMatchObject({ reason: { ended: "check", host: "sagepub.com" } })
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    expect(JSON.parse(readFileSync(path.join(dataDir, "publishers.json"), "utf8")).sites["sagepub.com"]).toMatchObject({ heldFor: "challenge" })
  })

  it("keeps the proxy route from leading back to a site that just asked for a person", async () => {
    const { browser, asked } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const { call } = await setup(browser, { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } })
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    expect(asked.map((r) => [r.landing, r.avoidSites])).toEqual([
      ["https://journals.sagepub.com/doi/10.1177/0956797620904990", []],
      ["https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/0956797620904990", ["sagepub.com"]],
    ])
  })

  it("spaces out unattended visits to one site", async () => {
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const { call, workspace } = await setup(browser)
    for (const paper of [sage, sibling]) await call("library.add", { paper })
    for (const paper of [sage, sibling]) workspace.tasks.enqueue("paper.pdf.browser", paper.id, "background")
    const waiting = await until(async () => workspace.tasks.list().find((t) => t.kind === "paper.pdf.browser" && t.state === "queued" && (t.notBefore ?? 0) > Date.now() + 60_000))
    expect([sage.id, sibling.id]).toContain(waiting.subject)
    expect(asked).toHaveLength(1)
  })

  it("leaves a site that answers plain downloads with a check to the browser", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const { base, root, call } = await setup(browser, {}, {}, {
      serve: (url) => (url.includes("journals.sagepub.com") ? new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }) : undefined),
    })
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    await call("library.add", { paper: sibling })
    await call("library.fetchPdf", { id: sibling.id }).catch(() => undefined)
    // Not tried, so not a try
    const tried = JSON.parse(readFileSync(path.join(root, "library/papers", sibling.id, "acquisition.json"), "utf8")).tried
    expect(tried.find((t: { route: string }) => t.route === "publisher:sage")).toBeUndefined()
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    const log = readFileSync(path.join(dataDir, "publisher-log.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(log).toContainEqual(expect.objectContaining({ paper: sage.id, kind: "plain-refused", host: "journals.sagepub.com", status: 403 }))
  })

  it("holds the site a doi.org link lands on, not doi.org", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    // Unpaywall's copy is a doi.org link, which doi.org sends on to journals.sagepub.com, where Cloudflare
    // answers with a check
    const challenge = (url: string) => {
      const response = new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } })
      return Object.defineProperty(response, "url", { value: url })
    }
    const { base, root, call } = await setup(browser, { contactEmail: "me@example.org" }, {}, {
      serve: (url) => {
        const unpaywall = url.match(/^https:\/\/api\.unpaywall\.org\/v2\/([^?]+)/)
        if (unpaywall) return Response.json({ oa_locations: [{ url_for_pdf: `https://doi.org/${unpaywall[1]}`, host_type: "publisher" }] })
        if (url.startsWith("https://doi.org/10.")) return challenge(`https://journals.sagepub.com/doi/${url.slice("https://doi.org/".length)}`)
        return url.includes("journals.sagepub.com") ? challenge(url) : undefined
      },
    })
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    await call("library.add", { paper: sibling })
    await call("library.fetchPdf", { id: sibling.id }).catch(() => undefined)
    const tried = JSON.parse(readFileSync(path.join(root, "library/papers", sibling.id, "acquisition.json"), "utf8")).tried
    const route = (name: string) => tried.find((t: { route: string }) => t.route === name)
    expect(route("unpaywall/publisher")).toMatchObject({ by: "owlit", ended: "no-copy" })
    expect(route("publisher:sage")).toBeUndefined()
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    const sites = JSON.parse(readFileSync(path.join(dataDir, "publishers.json"), "utf8")).sites
    expect(sites["sagepub.com"].plainRefusedUntil).toBeGreaterThan(Date.now())
    expect(sites["doi.org"]).toBeUndefined()
    const log = readFileSync(path.join(dataDir, "publisher-log.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(log).toContainEqual(expect.objectContaining({ paper: sage.id, route: "unpaywall/publisher", kind: "plain-refused", host: "journals.sagepub.com" }))
    expect(log.filter((entry) => entry.host === "doi.org")).toEqual([])
  })
})

describe("publishers' APIs", () => {
  const elsevier = { id: "doi-10.1016-j.chb.2019.07.016", title: "On Elsevier", authors: [], ids: { doi: "10.1016/j.chb.2019.07.016" } }
  const page = (text: string) => [{ x: 72, y: 72, size: 12, text }]

  it("gets an Elsevier paper from its API with the key, before the site", async () => {
    const { browser, asked } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "www.sciencedirect.com")
    })
    const keys: (string | null)[] = []
    const { root, call } = await setup(browser, { elsevierApiKey: "secret-key" }, {}, {
      serve: (url, init) => {
        if (!url.startsWith("https://api.elsevier.com/content/article/doi/10.1016/j.chb.2019.07.016")) return undefined
        keys.push(new Headers(init?.headers).get("x-els-apikey"))
        return new Response(makePdf([page("One"), page("Two"), page("Three")]), { headers: { "content-type": "application/pdf" } })
      },
    })
    await call("library.add", { paper: elsevier })
    expect((await call("library.fetchPdf", { id: elsevier.id })).pdf).toBeDefined()
    expect(keys).toEqual(["secret-key"])
    expect(asked).toHaveLength(0)
    const text = readFileSync(path.join(root, "library/papers", elsevier.id, "acquisition.json"), "utf8")
    expect(JSON.parse(text)).toMatchObject({ state: "have-it", route: "api:elsevier" })
    expect(text).not.toContain("secret-key")
  })

  it("turns away the first page alone, which is what Elsevier sends a network without the subscription", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "www.sciencedirect.com")
    })
    const { root, call } = await setup(browser, { elsevierApiKey: "secret-key" }, {}, {
      serve: (url) => (url.startsWith("https://api.elsevier.com/") ? new Response(makePdf([page("Only the first page")]), { headers: { "content-type": "application/pdf" } }) : undefined),
    })
    await call("library.add", { paper: elsevier })
    expect((await call("library.fetchPdf", { id: elsevier.id })).pdf).toBeUndefined()
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", elsevier.id, "acquisition.json"), "utf8"))
    expect(acquisition.tried.find((t: { route: string }) => t.route === "api:elsevier")).toMatchObject({ ended: "no-copy" })
    expect(readdirSync(path.join(root, "library/papers", elsevier.id)).filter((name) => name.includes(".download"))).toEqual([])
    expect(existsSync(path.join(root, "library/papers", elsevier.id, "paper.pdf"))).toBe(false)
  })
})

describe("your own browser", () => {
  const acm = { id: "doi-10.1145-3613904.3642549", title: "Proactive Agents in Everyday Life", authors: [], ids: { doi: "10.1145/3613904.3642549" } }
  const second = { id: "doi-10.1145-3706598.3713300", title: "Second", authors: [], ids: { doi: "10.1145/3706598.3713300" } }
  const third = { id: "doi-10.1145-3706598.3713332", title: "Third", authors: [], ids: { doi: "10.1145/3706598.3713332" } }
  const cell = { id: "doi-10.1016-j.cell.2020.01.001", title: "A Cell paper", authors: [], ids: { doi: "10.1016/j.cell.2020.01.001" } }
  const pdfOf = (doi: string) => `https://dl.acm.org/doi/pdf/${doi}?download=true`

  function quick(gap: number, wait: number) {
    process.env.OWLIT_BROWSER_GAP_MS = String(gap)
    process.env.OWLIT_BROWSER_WAIT_MS = String(wait)
    onTestFinished(() => {
      delete process.env.OWLIT_BROWSER_GAP_MS
      delete process.env.OWLIT_BROWSER_WAIT_MS
    })
  }

  // owlit's own browser gets nowhere: every publisher's page wants a person
  // A browser owlit can drive: each tab shows what `lands` says for its address (undefined: it closed
  // itself, as a download's tab does)
  function fakeControl(lands: (url: string) => { url: string; title: string } | undefined) {
    const tabs = new Map<string, { url: string; window: string }>()
    const windows: string[] = []
    const closed: string[] = []
    const focused: string[] = []
    const control: BrowserControl = {
      openWindow: async () => {
        windows.push(`w${windows.length + 1}`)
        return windows.at(-1)!
      },
      openTab: async (window, url) => {
        const id = `t${tabs.size + 1}`
        tabs.set(id, { url, window })
        return id
      },
      tab: async (_window, tab) => {
        const t = tabs.get(tab)
        return t && !closed.includes(tab) ? lands(t.url) : undefined
      },
      closeTab: async (_window, tab) => void closed.push(tab),
      focusTab: async (_window, tab) => void focused.push(tab),
    }
    return { control, tabs, windows, closed, focused }
  }

  async function withDownloads(options: { control?: BrowserControl; library?: object } = {}) {
    const downloads = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-downloads-")))
    const opened: { url: string; background?: boolean; at: number }[] = []
    const { browser, asked } = fakeBrowser(async (request) => {
      throw new NeedsUser("challenge", new URL(request.landing).hostname)
    })
    const ctx = await setup(browser, options.library ?? {}, {}, {
      host: {
        openExternal: async (url, opts) => void opened.push({ url, background: opts?.background, at: Date.now() }),
        browserName: async () => "Dia",
        downloadsDir: () => downloads,
        ...(options.control ? { browserControl: async () => options.control } : {}),
      },
    })
    return { ...ctx, downloads, opened, asked }
  }

  const paperIn = async (call: (method: string) => Promise<any>, id: string) => (await call("library.list")).papers.find((p: { id: string }) => p.id === id)

  it("never opens an ACM page in owlit's browser, and says the user's browser gets it", async () => {
    const { call, asked } = await withDownloads()
    await call("library.add", { paper: acm })
    const paper = await call("library.fetchPdf", { id: acm.id })
    expect(paper.pdfState).toMatchObject({ state: "no-pdf", reason: { by: "owlit", ended: "check", host: "dl.acm.org", route: "browser:acm" } })
    expect(asked).toEqual([])
  })

  it("asks for the user's browser on a paper noted for Check now before", async () => {
    const { root, call } = await withDownloads()
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    const file = path.join(root, "library/papers", acm.id, "acquisition.json")
    writeFileSync(file, JSON.stringify({ version: 1, result: "no_pdf", tried: [], at: 1, dropHere: "", needs: { reason: "refused", route: "browser:acm", at: 1, host: "dl.acm.org" } }))
    expect((await paperIn(call, acm.id)).pdfState).toMatchObject({ state: "no-pdf", reason: { ended: "check", host: "dl.acm.org" } })
  })

  it.runIf(process.platform === "darwin")("opens the PDF behind owlit's window and takes the file by where it was saved from", async () => {
    const { call, downloads, opened } = await withDownloads()
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    await call("library.getInBrowser", { ids: [acm.id] })
    await until(async () => opened.length > 0)
    expect(opened[0]).toMatchObject({ url: pdfOf(acm.ids.doi), background: true })
    expect((await until(async () => (await paperIn(call, acm.id)).pdfState?.run)) as unknown).toEqual({ state: "opened", browser: "Dia" })
    // A PDF that names no paper on its pages, saved from the address owlit opened: the paper's, without asking
    await new Promise((r) => setTimeout(r, 300))
    const part = path.join(downloads, "3613904.3642549.pdf.crdownload")
    writeFileSync(part, makePdf([[{ x: 72, y: 72, size: 10, text: "Some paper or other" }]]))
    execFileSync("xattr", ["-w", "com.apple.metadata:kMDItemWhereFroms", `${pdfOf(acm.ids.doi)}&__cf_chl_tk=x`, part])
    renameSync(part, path.join(downloads, "3613904.3642549.pdf"))
    const done = await until(async () => {
      const paper = await paperIn(call, acm.id)
      return paper.pdf ? paper : undefined
    })
    expect(done.pdfState).toBeUndefined()
  })

  it("gets several one at a time, and stops for the user after two in a row don't come", async () => {
    quick(80, 150)
    const { call, opened, heard } = await withDownloads()
    for (const paper of [acm, second, third]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id, third.id] })
    const waiting = await until(async () => heard.find((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you"))
    expect(waiting.waiting).toMatchObject({ reason: "browser" })
    expect(waiting.waiting!.detail).toContain("Dia")
    expect(opened.map((o) => o.url)).toEqual([pdfOf(acm.ids.doi), pdfOf(second.ids.doi)])
    expect(opened[1].at - opened[0].at).toBeGreaterThanOrEqual(80)
    expect((await paperIn(call, acm.id)).pdfState).toMatchObject({ reason: { by: "you", ended: "nothing-came" } })
    expect((await paperIn(call, acm.id)).pdfState.run).toBeUndefined()
    expect((await paperIn(call, third.id)).pdfState.run).toMatchObject({ state: "queued" })
    // Continue: the last one is opened, and with nothing after it the run ends rather than waiting
    await call("tasks.resume", { id: waiting.id })
    await until(async () => heard.some((t) => t.id === waiting.id && t.state === "done"))
    expect(opened.map((o) => o.url).at(-1)).toBe(pdfOf(third.ids.doi))
    expect((await paperIn(call, third.id)).pdfState).toMatchObject({ reason: { by: "you", ended: "nothing-came" } })
    // Trying one again starts a new run for it
    await call("library.getInBrowser", { ids: [second.id] })
    await until(async () => opened.length === 4)
    expect(opened[3].url).toBe(pdfOf(second.ids.doi))
  })

  it("stops when asked, leaving the papers that hadn't had their turn as they were", async () => {
    quick(60_000, 60_000)
    const { call, opened, heard, workspace } = await withDownloads()
    for (const paper of [acm, second]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id] })
    await until(async () => opened.length === 1)
    const run = heard.find((t) => t.kind === "papers.fromBrowser")!
    await call("tasks.cancel", { id: run.id })
    await until(async () => !(await paperIn(call, second.id)).pdfState.run)
    expect((await paperIn(call, second.id)).pdfState.reason).toMatchObject({ ended: "check" })
    expect(opened).toHaveLength(1)
    // Nothing kept for the next start to go on with
    await until(async () => !existsSync(path.join(workspace.dataDir, "browser-run.json")))
  })

  it("takes a PDF the user saves by the DOI on its pages", async () => {
    quick(0, 5_000)
    const { call, downloads } = await withDownloads()
    writeFileSync(path.join(downloads, "old.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1145/3613904.3642549" }]]))
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    await call("library.getInBrowser", { ids: [acm.id] })
    // A file that was there before isn't taken; one that arrives (written under another name, then
    // renamed, as browsers do) is
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "paper.pdf.crdownload"), makePdf([[{ x: 72, y: 72, size: 10, text: "https://doi.org/10.1145/3613904.3642549" }]]))
    renameSync(path.join(downloads, "paper.pdf.crdownload"), path.join(downloads, "paper.pdf"))
    await until(async () => (await paperIn(call, acm.id)).pdf)
  })

  it("opens the PDFs that save themselves first, then the article pages, which wait for the user", async () => {
    quick(30, 150)
    const { call, opened, heard, downloads } = await withDownloads()
    for (const paper of [cell, acm]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    expect((await paperIn(call, cell.id)).pdfState).toMatchObject({ reason: { ended: "check" } })
    await call("library.getInBrowser", { ids: [cell.id, acm.id] })
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    expect(opened.map((o) => o.url)).toEqual([pdfOf(acm.ids.doi), "https://doi.org/10.1016/j.cell.2020.01.001"])
    // The run doesn't wait on the page; the user saves its PDF there, and it is taken
    expect((await paperIn(call, cell.id)).pdfState.run).toMatchObject({ state: "page" })
    writeFileSync(path.join(downloads, "cell.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1016/j.cell.2020.01.001" }]]))
    const got = await until(async () => {
      const paper = await paperIn(call, cell.id)
      return paper.pdf ? paper : undefined
    })
    expect(got.pdfState).toBeUndefined()
  })

  it("asks before taking a PDF that names no paper", async () => {
    quick(0, 150)
    const { call, heard, downloads } = await withDownloads()
    await call("library.add", { paper: cell })
    await call("library.fetchPdf", { id: cell.id })
    await call("library.getInBrowser", { ids: [cell.id] })
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "fulltext.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "Some paper or other" }]]))
    const offered = await until(async () => {
      const paper = await paperIn(call, cell.id)
      return paper.pdfState?.run?.offered ? paper : undefined
    })
    expect(offered.pdfState.run.offered).toBe("fulltext.pdf")
    expect((await call("library.takeDownload", { id: cell.id, take: true })).pdf).toBeDefined()
  })

  it("goes on past a paper that doesn't come once the site has given one", async () => {
    // Downloads takes a file once it has been still for 1.5 s: each wait outlasts that
    quick(0, 2_500)
    const { root, call, opened, heard, downloads } = await withDownloads()
    for (const paper of [acm, second, third]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id, third.id] })
    // The first comes; the next two don't (no access), and the run doesn't stop for them
    await until(async () => opened.length === 1)
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "first.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1145/3613904.3642549" }]]))
    // Two misses of 2.5 s each: longer than until() looks
    await expect.poll(() => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"), { timeout: 20_000 }).toBe(true)
    expect(heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you")).toBe(false)
    expect(opened).toHaveLength(3)
    expect((await paperIn(call, acm.id)).pdf).toBeDefined()
    // Noted on the paper, so a restart doesn't put it back with the papers Get them opens
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", third.id, "acquisition.json"), "utf8"))
    expect(acquisition.tried.at(-1)).toMatchObject({ by: "you", ended: "nothing-came" })
  }, 30_000)

  it("keeps a paper whose PDF didn't come out of Get them after a restart", async () => {
    const { root, call } = await withDownloads()
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    const file = path.join(root, "library/papers", acm.id, "acquisition.json")
    writeFileSync(file, JSON.stringify({ version: 1, result: "no_pdf", tried: [], at: 1, dropHere: "", needs: { reason: "browser", route: "browser:acm", at: 1, host: "dl.acm.org" }, yourBrowser: { outcome: "missed", at: 2 } }))
    const paper = await paperIn(call, acm.id)
    expect(paper.pdfState).toMatchObject({ state: "no-pdf", reason: { by: "you", ended: "nothing-came" } })
    expect(paper.pdfState.run).toBeUndefined()
  })

  it("waits for a check on an article page to pass by itself before stopping for it", async () => {
    quick(0, 150)
    process.env.OWLIT_BROWSER_LOOK_MS = "50"
    process.env.OWLIT_BROWSER_CHECK_MS = "5000"
    onTestFinished(() => {
      delete process.env.OWLIT_BROWSER_LOOK_MS
      delete process.env.OWLIT_BROWSER_CHECK_MS
    })
    let looks = 0
    const fake = fakeControl((url) =>
      ++looks < 2 ? { url: `${url}?__cf_chl_rt_tk=x`, title: "Just a moment..." } : { url: "https://www.cell.com/cell/fulltext/S0092-8674(20)30001-1", title: "A Cell paper: Cell" },
    )
    const { call, heard } = await withDownloads({ control: fake.control })
    await call("library.add", { paper: cell })
    await call("library.fetchPdf", { id: cell.id })
    await call("library.getInBrowser", { ids: [cell.id] })
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    expect(heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you")).toBe(false)
    expect((await paperIn(call, cell.id)).pdfState.run).toMatchObject({ state: "page" })
  })

  it("stops for a check on an article page that doesn't pass", async () => {
    quick(0, 150)
    process.env.OWLIT_BROWSER_LOOK_MS = "50"
    process.env.OWLIT_BROWSER_CHECK_MS = "300"
    onTestFinished(() => {
      delete process.env.OWLIT_BROWSER_LOOK_MS
      delete process.env.OWLIT_BROWSER_CHECK_MS
    })
    const fake = fakeControl((url) => ({ url: `${url}?__cf_chl_rt_tk=x`, title: "Just a moment..." }))
    const { call, heard } = await withDownloads({ control: fake.control })
    await call("library.add", { paper: cell })
    await call("library.fetchPdf", { id: cell.id })
    await call("library.getInBrowser", { ids: [cell.id] })
    await until(async () => heard.find((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you"))
    expect((await paperIn(call, cell.id)).pdfState.run).toMatchObject({ state: "waiting", why: "check" })
  })

  it("opens a run's papers in a window of its own, and closes a tab a check left once its PDF came", async () => {
    quick(0, 5_000)
    const fake = fakeControl((url) => ({ url: `${url}&__cf_chl_tk=x`, title: "Just a moment..." }))
    const { call, downloads, opened, heard } = await withDownloads({ control: fake.control })
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    await call("library.getInBrowser", { ids: [acm.id] })
    await until(async () => fake.tabs.size === 1)
    expect(fake.windows).toEqual(["w1"])
    expect([...fake.tabs.values()][0]).toEqual({ url: pdfOf(acm.ids.doi), window: "w1" })
    // Not opened as a link as well
    expect(opened).toEqual([])
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "acm.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1145/3613904.3642549" }]]))
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    expect((await paperIn(call, acm.id)).pdf).toBeDefined()
    expect(fake.closed).toEqual(["t1"])
    const done = heard.filter((t) => t.kind === "papers.fromBrowser").at(-1)!
    expect(JSON.parse(done.progress!.note!)).toMatchObject({ browser: "Dia", got: [acm.id], noAccess: [], pages: [], missed: [] })
  })

  it("goes on past a publisher's no, noting it on the paper", async () => {
    quick(0, 150)
    // Each paper ends on its abstract page
    const fake = fakeControl((url) => ({ url: url.replace("/doi/pdf/", "/doi/abs/"), title: "An abstract - Someone, 2024" }))
    const { call, heard } = await withDownloads({ control: fake.control })
    for (const paper of [acm, second, third]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id, third.id] })
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    expect(heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you")).toBe(false)
    const paper = await paperIn(call, third.id)
    expect(paper.pdfState.reason).toMatchObject({ by: "you", ended: "no-access", host: "dl.acm.org", title: "An abstract - Someone, 2024" })
    expect(paper.pdfState.run).toBeUndefined()
    // The note stays through owlit's own look
    await call("library.fetchPdf", { id: third.id })
    expect((await paperIn(call, third.id)).pdfState.reason).toMatchObject({ by: "you", ended: "no-access" })
  })

  it("stops for a sign-in, says so, and tries the paper again once the user is through", async () => {
    quick(0, 150)
    let signedIn = false
    const fake = fakeControl((url) =>
      signedIn ? { url: url.replace("/doi/pdf/", "/doi/abs/"), title: "An abstract" } : { url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/x/1", title: "清华大学用户电子身份服务系统" },
    )
    const { call, heard } = await withDownloads({ control: fake.control })
    for (const paper of [acm, second]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id] })
    const waiting = await until(async () => heard.find((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you"))
    expect(waiting.waiting!.detail).toBe("Sign in to your library in Dia, then continue.")
    expect((await paperIn(call, acm.id)).pdfState.run).toMatchObject({ state: "waiting", why: "sign-in", page: { host: "id.tsinghua.edu.cn" } })
    // Show browser goes to that tab
    await call("library.showBrowser", {})
    expect(fake.focused).toEqual(["t1"])
    signedIn = true
    await call("tasks.resume", { id: waiting.id })
    await until(async () => heard.some((t) => t.id === waiting.id && t.state === "done"))
    // The paper it stopped on went first again, then the next
    expect([...fake.tabs.values()].map((t) => t.url)).toEqual([pdfOf(acm.ids.doi), pdfOf(acm.ids.doi), pdfOf(second.ids.doi)])
    expect((await paperIn(call, acm.id)).pdfState.reason).toMatchObject({ by: "you", ended: "no-access" })
  })

  it("takes a PDF saved after the user's browser was sent, once owlit starts again", async () => {
    const { base, root, call, downloads } = await withDownloads()
    for (const paper of [cell, acm]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    // Both sent a minute ago, then owlit quit; the Cell paper's PDF was saved meanwhile, and a file from
    // before they were sent is nobody's
    const sentAt = Date.now() - 60_000
    for (const id of [cell.id, acm.id]) {
      const file = path.join(root, "library/papers", id, "acquisition.json")
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), sentToBrowser: { at: sentAt, page: id === cell.id } }))
    }
    const old = path.join(downloads, "old.pdf")
    writeFileSync(old, makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1145/3613904.3642549" }]]))
    utimesSync(old, new Date(sentAt - 60_000), new Date(sentAt - 60_000))
    writeFileSync(path.join(downloads, "cell.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1016/j.cell.2020.01.001" }]]))
    await Promise.all(cores.splice(0).map((c) => c.dispose()))

    const fetch = (async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof globalThis.fetch
    const { browser } = fakeBrowser(async (request) => {
      throw new NeedsUser("challenge", new URL(request.landing).hostname)
    })
    const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch, browser, downloadsDir: () => downloads }, retryBaseMs: 1 })
    cores.push(core)
    const again = async (method: string, params?: unknown): Promise<any> => {
      const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
      if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
      return response.result
    }
    await again("workspace.open", { path: root })
    await until(async () => (await paperIn(again, cell.id)).pdf)
    // Recorded as got from the user's browser, not as a PDF the user dropped
    expect(JSON.parse(readFileSync(path.join(root, "library/papers", cell.id, "acquisition.json"), "utf8"))).toMatchObject({ state: "have-it", route: "your-browser", tried: expect.arrayContaining([expect.objectContaining({ by: "you", ended: "pdf" })]) })
    // The ACM paper is still within its time: not taken from the old file, and looked for again
    const acmPaper = await paperIn(again, acm.id)
    expect(acmPaper.pdf).toBeUndefined()
    expect(acmPaper.pdfState.run?.offered).toBeUndefined()
  })

  it("goes on with a run owlit closed in the middle of, keeping what it had done", async () => {
    quick(50, 10_000)
    const first = fakeControl(() => undefined)
    const { base, root, call, downloads, heard, workspace } = await withDownloads({ control: first.control })
    for (const paper of [acm, second, third]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id, third.id] })
    await until(async () => first.tabs.size === 1)
    // The first one's PDF lands; the second is opened, and owlit closes while it is awaited
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "acm.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: `doi:${acm.ids.doi}` }]]))
    await until(async () => first.tabs.size === 2)
    const run = heard.find((t) => t.kind === "papers.fromBrowser")!
    await Promise.all(cores.splice(0).map((c) => c.dispose()))
    const runFile = path.join(workspace.dataDir, "browser-run.json")
    expect(JSON.parse(readFileSync(runFile, "utf8"))).toMatchObject({ task: run.id, left: [second.id, third.id], done: 1, tally: { got: [acm.id] } })

    process.env.OWLIT_BROWSER_WAIT_MS = "100"
    const next = fakeControl(() => undefined)
    const fetch = (async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof globalThis.fetch
    const { browser } = fakeBrowser(async (request) => {
      throw new NeedsUser("challenge", new URL(request.landing).hostname)
    })
    const core = new Core({
      userDataDir: path.join(base, "userData"),
      host: { fetch, browser, downloadsDir: () => downloads, openExternal: async () => {}, browserName: async () => "Dia", browserControl: async () => next.control },
      retryBaseMs: 1,
    })
    cores.push(core)
    const again: Task[] = []
    core.onNotify((n) => n.method === "tasks.changed" && again.push((n.params as { task: Task }).task))
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
    expect("error" in response).toBe(false)
    const ended = await until(async () => again.find((t) => t.id === run.id && t.state === "done"))
    // The paper it had open goes first again, then the one that hadn't had its turn
    expect([...next.tabs.values()].map((t) => t.url)).toEqual([pdfOf(second.ids.doi), pdfOf(third.ids.doi)])
    expect(JSON.parse(ended.progress!.note!)).toMatchObject({ got: [acm.id], missed: [second.id, third.id] })
    expect(ended.progress).toMatchObject({ done: 3, total: 3 })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "have-it", route: "your-browser", tried: expect.arrayContaining([expect.objectContaining({ by: "you", ended: "pdf" })]) })
    // Ended: nothing kept for another start
    expect(existsSync(runFile)).toBe(false)
  })

  it("waits out the library proxy's limit and tries the paper again", async () => {
    quick(0, 150)
    process.env.OWLIT_BROWSER_LIMIT_MS = "200"
    onTestFinished(() => void delete process.env.OWLIT_BROWSER_LIMIT_MS)
    let asked = 0
    const fake = fakeControl((url) => {
      asked++
      return asked === 1
        ? { url: `https://libproxy.example.com/ui/minute-limit?url=${url}`, title: "Access Denied" }
        : { url: "https://journals.sagepub.com/doi/abs/10.1177/0146167212445599", title: "Self-Compassion Increases Self-Improvement Motivation" }
    })
    const { call, heard } = await withDownloads({ control: fake.control, library: { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } } })
    const sage2 = { id: "doi-10.1177-0146167212445599", title: "Self-Compassion", authors: [], ids: { doi: "10.1177/0146167212445599" } }
    await call("library.add", { paper: sage2 })
    await call("library.fetchPdf", { id: sage2.id })
    await call("library.getInBrowser", { ids: [sage2.id] })
    await until(async () => heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "done"))
    const urls = [...fake.tabs.values()].map((t) => t.url)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toBe("https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/10.1177/0146167212445599?download=true")
    expect(heard.some((t) => t.kind === "papers.fromBrowser" && t.state === "waiting_for_you")).toBe(false)
  })
})

describe("what owlit's browser found", () => {
  const apa = { id: "doi-10.1037-a0017908", title: "Who knows what about a person?", authors: [], ids: { doi: "10.1037/a0017908" } }
  const tlink = { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } }
  const offer = (url: string) => new NoPdfOnPage("The publisher's page doesn't link a PDF.", { url, title: "Who knows what about a person?", status: 200, offersAccess: true })

  it("says no access when the library's proxy reaches an offer to buy, and doesn't send the user's browser", async () => {
    const { browser } = fakeBrowser(async (request) => {
      throw offer(request.landing.includes("tlink") ? "https://psycnet.apa.org/doiLanding?doi=10.1037%2Fa0017908" : "https://psycnet.apa.org/doiLanding?doi=10.1037%2Fa0017908")
    })
    const { root, call } = await setup(browser, tlink)
    await call("library.add", { paper: apa })
    const paper = await call("library.fetchPdf", { id: apa.id })
    expect(paper.pdfState.reason).toMatchObject({ by: "owlit", ended: "no-access", host: "psycnet.apa.org", title: "Who knows what about a person?", route: "browser:doi:proxied" })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", apa.id, "acquisition.json"), "utf8"))
    expect(acquisition.state).toBe("no-pdf")
  })

  it("sends a page with no PDF on it, or an offer seen only directly, to the user's browser", async () => {
    const { browser } = fakeBrowser(async () => {
      throw offer("https://psycnet.apa.org/doiLanding?doi=10.1037%2Fa0017908")
    })
    const { call } = await setup(browser)
    await call("library.add", { paper: apa })
    const paper = await call("library.fetchPdf", { id: apa.id })
    expect(paper.pdfState.reason).toMatchObject({ by: "owlit", ended: "check", host: "psycnet.apa.org" })
  })

  it("notes a page that wasn't there, and leaves the user's browser out of it", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NoPdfOnPage("The publisher's page doesn't link a PDF.", { url: "https://doi.org/10.1037/a0017908", title: "DOI Not Found", status: 404, offersAccess: false })
    })
    const { call } = await setup(browser)
    await call("library.add", { paper: apa })
    const paper = await call("library.fetchPdf", { id: apa.id })
    expect(paper.pdfState.reason).toMatchObject({ by: "owlit", ended: "not-there", title: "DOI Not Found" })
  })

  it("stops visiting a site whose last visits were checks, until a week has passed", async () => {
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const { base, root, call, workspace } = await setup(browser)
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    const visits = (at: number) => [1, 2, 3].map((i) => ({ at: at + i, ended: "check" }))
    writeFileSync(path.join(dataDir, "publishers.json"), JSON.stringify({ version: 1, sites: { "sagepub.com": { visits: visits(Date.now() - 60_000) } } }))
    await call("library.add", { paper: sage })
    await until(async () => !workspace.tasks.list().some((t) => t.subject === sage.id && t.kind.startsWith("paper.pdf") && !["done", "failed", "cancelled"].includes(t.state)))
    expect(asked).toHaveLength(0)
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition.tried.at(-1)).toMatchObject({ by: "owlit", ended: "check", host: "sagepub.com", route: "browser:sage" })
  })

  it("keeps how each visit ended, and a PDF ends the run of checks", async () => {
    let check = true
    const { browser } = fakeBrowser(async () => {
      if (check) throw new NeedsUser("challenge", "journals.sagepub.com")
      return new Uint8Array(PDF)
    })
    const { base, call } = await setup(browser)
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    check = false
    // Tried again by the user, past the site's hold
    expect((await call("library.fetchPdf", { id: sage.id })).pdf).toBeDefined()
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    const site = JSON.parse(readFileSync(path.join(dataDir, "publishers.json"), "utf8")).sites["sagepub.com"]
    expect(site.visits.map((v: { ended: string }) => v.ended)).toEqual(["check", "pdf"])
  })
})

describe("reading the page owlit's browser landed on", () => {
  it("works out IEEE's and OSF's PDF from the page's address", () => {
    expect(pdfFromLanded("https://ieeexplore.ieee.org/document/11234567/")).toBe("https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=11234567")
    expect(pdfFromLanded("https://osf.io/preprints/psyarxiv/hcn5a_v2")).toBeUndefined()
    expect(pdfFromLanded("https://osf.io/preprints/psyarxiv/hcn5a")).toBe("https://osf.io/hcn5a/download")
    expect(pdfFromLanded("https://osf.io/hcn5a/")).toBe("https://osf.io/hcn5a/download")
    // A proxy's rewrite is left to the page's own links
    expect(pdfFromLanded("https://ieeexplore-ieee-org.proxy.example.edu/document/1")).toBeUndefined()
    expect(pdfFromLanded("https://www.sciencedirect.com/science/article/pii/S0003687021001538")).toBeUndefined()
  })

  it("tells a page that isn't there and an offer to buy from a page with no PDF on it", () => {
    expect(pageVerdict({ url: "https://doi.org/10.1/x", title: "DOI Not Found", offersAccess: false })).toBe("missing")
    expect(pageVerdict({ url: "https://a.org/x", title: "Article", status: 404, offersAccess: false })).toBe("missing")
    expect(pageVerdict({ url: "https://psycnet.apa.org/doiLanding", title: "Who knows what about a person?", offersAccess: true })).toBe("no-access")
    expect(pageVerdict({ url: "https://osf.io/x", title: "OSF", offersAccess: false })).toBe("no-link")
    for (const words of ["Get Access", "Buy article PDF", "Purchase PDF", "Access through your institution", "Get full access"]) expect(ACCESS_OFFER.test(words)).toBe(true)
    for (const words of ["Get PDF", "Download PDF", "Purchased items", "Rental history"]) expect(ACCESS_OFFER.test(words), words).toBe(false)
  })

  it("sends ACM's own 10.5555 DOIs to its Digital Library, not doi.org", () => {
    expect(browserRoutes("10.5555/2034396.2034432", undefined)).toMatchObject([{ name: "browser:acm", browserOnly: true }])
    expect(yourBrowser("10.5555/2034396.2034432")).toMatchObject({ url: "https://dl.acm.org/doi/pdf/10.5555/2034396.2034432?download=true", opens: "pdf" })
  })
})
