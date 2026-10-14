import type { Task } from "@owlit/protocol"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, onTestFinished } from "vitest"
import { Core } from "../core.ts"
import { NeedsUser, Refused, type BrowserHost, type BrowserRequest, type Host } from "../host.ts"
import { makePdf } from "./text/make-pdf.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { browserRoutes, ownBrowserUrl, pdfLinkOn, siteOf, throughProxy } from "./browser-routes.ts"

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n")

describe("browser routes", () => {
  it("goes to the publisher's page, then through the proxy", () => {
    const routes = browserRoutes("10.1177/0956797620904990", { base: "https://tlink.lib.tsinghua.edu.cn/", scheme: "login-url", path: "/go" })
    expect(routes.map((r) => [r.name, r.landing, r.pdf])).toEqual([
      ["browser:sage", "https://journals.sagepub.com/doi/10.1177/0956797620904990", "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990"],
      ["browser:sage:proxied", "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/0956797620904990", "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990"],
    ])
    expect(routes[1].allowHosts).toContain("tlink.lib.tsinghua.edu.cn")
    expect(routes[0].ownBrowser).toBeUndefined()
    expect(browserRoutes("10.9999/x", undefined)).toMatchObject([{ name: "browser:doi", landing: "https://doi.org/10.9999/x" }])
  })

  it("leaves the ACM to the user's own browser, at the PDF itself", () => {
    const routes = browserRoutes("10.1145/3613904.3642549", { base: "https://tlink.lib.tsinghua.edu.cn/", scheme: "login-url", path: "/go" })
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ name: "browser:acm", ownBrowser: "https://dl.acm.org/doi/pdf/10.1145/3613904.3642549?download=true" })
    expect(ownBrowserUrl("10.1145/3613904.3642549")).toBe("https://dl.acm.org/doi/pdf/10.1145/3613904.3642549?download=true")
    // ACL's DOIs at the ACM, by where the paper was found to be
    expect(ownBrowserUrl("10.3115/1654595.1654614", "dl.acm.org")).toBe("https://dl.acm.org/doi/pdf/10.3115/1654595.1654614?download=true")
    expect(ownBrowserUrl("10.1177/0956797620904990")).toBeUndefined()
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
    // doi.org sending the reader to BMJ or APA no longer stops at a host it doesn't know
    expect(browserRoutes("10.1136/qhc.12.4.304", undefined, "https://qualitysafety.bmj.com/lookup/doi/10.1136/qhc.12.4.304")[0].allowHosts).toContain("bmj.com")
    expect(browserRoutes("10.1037/0022-3514.54.4.569", undefined, "https://doi.apa.org/doi/10.1037/0022-3514.54.4.569")[0].allowHosts).toContain("apa.org")
    // Not known: the prefix decides, as before
    expect(browserRoutes("10.1111/x", undefined)[0].name).toBe("browser:wiley")
    expect(siteOf("www.ncbi.nlm.nih.gov")).toBe("nih.gov")
    expect(siteOf("www.ucl.ac.uk")).toBe("ucl.ac.uk")
  })

  it("takes the page's own PDF link when it has no citation_pdf_url", () => {
    // APA PsycNet's full-text page, as it was on 2026-10-11
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
    expect(acquisition).toMatchObject({ result: "ok", route: "browser:sage" })
    expect(acquisition.tried.filter((t: { error?: string }) => !t.error?.startsWith("Not tried")).map((t: { route: string }) => t.route)).toEqual([
      "publisher:sage",
      "browser:sage",
    ])
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
    expect((await call("library.fetchPdf", { id: sage.id })).noPdf).toMatchObject({ needs: "sign-in" })
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeUndefined()
    signedIn = true
    expect((await call("library.fetchPdf", { id: sage.id })).pdf).toBeDefined()
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeGreaterThan(1)
  })

  it("notes a page that wants a person instead of waiting, while nobody is looking", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.withUser) throw new NeedsUser("challenge")
      return new Uint8Array(PDF)
    })
    const { root, call, heard } = await setup(browser)
    await call("library.add", { paper: sage })
    const paper = await call("library.fetchPdf", { id: sage.id })
    expect(paper.pdf).toBeUndefined()
    expect(paper.noPdf).toMatchObject({ needs: "check" })
    expect(asked.every((r) => !r.withUser)).toBe(true)
    expect(heard.filter((t) => t.kind === "paper.pdf.browser").map((t) => t.state)).not.toContain("waiting_for_you")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition.needs).toMatchObject({ reason: "challenge", route: "browser:sage" })
  })

  it("shows the page to the user on Check now, waits for them, then goes on by itself", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.withUser) throw new NeedsUser("login")
      await request.needUser("login", "Sign in.", new Promise((r) => setTimeout(r, 500)))
      return new Uint8Array(PDF)
    })
    const { root, call, heard } = await setup(browser)
    await call("library.add", { paper: sage })
    expect((await call("library.fetchPdf", { id: sage.id })).noPdf).toMatchObject({ needs: "sign-in" })
    const paper = await call("library.checkPublisher", { id: sage.id })
    expect(paper.pdf).toBeDefined()
    expect(paper.noPdf).toBeUndefined()
    expect(asked.at(-1)?.withUser).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    const states = heard.filter((t) => t.kind === "paper.pdf.check").map((t) => t.state)
    expect(states).toContain("waiting_for_you")
    expect(states.at(-1)).toBe("done")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ result: "ok", route: "browser:sage" })
    expect(acquisition.needs).toBeUndefined()
  })

  it("after one Check now, gets the same publisher's other papers by itself and leaves the rest noted", async () => {
    // Their turns at the site are spaced out; here, not at all
    process.env.OWLIT_VISIT_GAP_MS = "0"
    onTestFinished(() => void delete process.env.OWLIT_VISIT_GAP_MS)
    // The session keeps what the user's check left: past it once, the publisher's pages open unattended
    let passed = false
    const { browser, asked } = fakeBrowser(async (request) => {
      const host = new URL(request.landing).hostname
      if (request.withUser) passed = true
      else if (!passed || host !== "journals.sagepub.com") throw new NeedsUser("challenge", host)
      return new Uint8Array(PDF)
    })
    const sibling = { id: "doi-10.1177-0956797619877311", title: "Same publisher", authors: [], ids: { doi: "10.1177/0956797619877311" } }
    const other = { id: "doi-10.1080-09658211.2011.605591", title: "Another publisher", authors: [], ids: { doi: "10.1080/09658211.2011.605591" } }
    const { root, call } = await setup(browser)
    for (const paper of [sage, sibling, other]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    const needs = (id: string) => JSON.parse(readFileSync(path.join(root, "library/papers", id, "acquisition.json"), "utf8")).needs
    expect(needs(sage.id)).toMatchObject({ reason: "challenge", host: "journals.sagepub.com" })
    expect((await call("library.checkPublisher", { id: sage.id })).pdf).toBeDefined()
    let papers: Record<string, { pdf?: unknown; noPdf?: unknown }> = {}
    for (let i = 0; i < 100; i++) {
      papers = Object.fromEntries((await call("library.list")).papers.map((p: { id: string }) => [p.id, p]))
      if (papers[sibling.id]?.pdf) break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(papers[sibling.id].pdf).toBeDefined()
    expect(papers[other.id]).toMatchObject({ noPdf: { needs: "check" } })
    expect(asked.filter((r) => r.landing.includes("tandfonline") || r.landing.includes("10.1080"))).toHaveLength(1)
  })

  it("keeps the note when the user cancels Check now", async () => {
    const { browser } = fakeBrowser(async (request) => {
      if (!request.withUser) throw new NeedsUser("challenge")
      await request.needUser("challenge", "Check.", new Promise(() => {}))
      return new Uint8Array(PDF)
    })
    const { call, workspace } = await setup(browser)
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    const checking = call("library.checkPublisher", { id: sage.id })
    let task
    for (let i = 0; i < 100 && !(task = workspace.tasks.list().find((t) => t.kind === "paper.pdf.check" && t.state === "waiting_for_you")); i++) await new Promise((r) => setTimeout(r, 20))
    await call("tasks.cancel", { id: task!.id })
    const paper = await checking
    expect(paper.pdf).toBeUndefined()
    expect(paper.noPdf).toMatchObject({ needs: "check" })
  })

  it("ends with no PDF, saying what it tried and that there is no proxy", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new Error("Gave up waiting for the sign-in after 5 minutes.")
    })
    const { root, call } = await setup(browser)
    await call("library.add", { paper: sage })
    const paper = await call("library.fetchPdf", { id: sage.id })
    expect(paper.noPdf.tried).toEqual(["publisher:sage", "browser:sage"])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sage.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ result: "no_pdf" })
    expect(acquisition.tried.at(-2)).toMatchObject({ route: "browser:sage", error: "Gave up waiting for the sign-in after 5 minutes." })
    expect(acquisition.tried.at(-1)).toMatchObject({ error: "Not tried: no library proxy is set up." })
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
    const { base, root, call, workspace } = await setup(browser)
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    await call("library.add", { paper: sibling })
    // Its own look after the add, and one more, as the daily retry would
    await until(async () => !workspace.tasks.list().some((t) => t.subject === sibling.id && t.kind.startsWith("paper.pdf") && !["done", "failed", "cancelled"].includes(t.state)))
    const task = workspace.tasks.enqueue("paper.pdf.browser", sibling.id, "background")
    await workspace.tasks.wait(task.id)
    expect(asked.map((r) => r.landing)).toEqual(["https://journals.sagepub.com/doi/10.1177/0956797620904990"])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", sibling.id, "acquisition.json"), "utf8"))
    expect(acquisition.needs).toMatchObject({ reason: "challenge", host: "sagepub.com" })
    const papers = (await call("library.list")).papers
    expect(papers.find((p: { id: string }) => p.id === sibling.id).noPdf).toMatchObject({ needs: "check" })
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    expect(JSON.parse(readFileSync(path.join(dataDir, "publishers.json"), "utf8")).sites["sagepub.com"]).toMatchObject({ heldFor: "challenge" })
  })

  it("stops asking when a check comes back after the user passed it, and says the site isn't letting owlit in", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (request.withUser) throw new Refused("journals.sagepub.com")
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const { call } = await setup(browser, { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } })
    for (const paper of [sage, sibling]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    const before = asked.length
    const paper = await call("library.checkPublisher", { id: sage.id })
    expect(paper.noPdf).toMatchObject({ needs: "blocked" })
    // Not the proxy route after it: on campus it leads to the same site
    expect(asked.slice(before).filter((r) => r.withUser)).toHaveLength(1)
    // The publisher's other papers say the same
    const papers = (await call("library.list")).papers
    expect(papers.find((p: { id: string }) => p.id === sibling.id).noPdf).toMatchObject({ needs: "blocked" })
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
    expect(asked.filter((r) => !r.withUser)).toHaveLength(1)
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
    const tried = JSON.parse(readFileSync(path.join(root, "library/papers", sibling.id, "acquisition.json"), "utf8")).tried
    expect(tried.find((t: { route: string }) => t.route === "publisher:sage").error).toBe("Not tried: sagepub.com only lets browsers in.")
    const dataDir = path.join(base, "userData/workspaces", readdirSync(path.join(base, "userData/workspaces"))[0])
    const log = readFileSync(path.join(dataDir, "publisher-log.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(log).toContainEqual(expect.objectContaining({ paper: sage.id, kind: "plain-refused", host: "journals.sagepub.com", status: 403 }))
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
    expect(JSON.parse(text)).toMatchObject({ result: "ok", route: "api:elsevier" })
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
    expect(acquisition.tried.find((t: { route: string }) => t.route === "api:elsevier").error).toMatch(/only the first page/)
    expect(existsSync(path.join(root, "library/papers", elsevier.id, "paper.pdf"))).toBe(false)
  })
})

describe("open in your browser", () => {
  it("takes the PDF the user saves from their browser, by the DOI on it", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const downloads = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-downloads-")))
    writeFileSync(path.join(downloads, "old.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "doi:10.1177/0956797620904990" }]]))
    const opened: string[] = []
    const { call } = await setup(browser, {}, {}, { host: { openExternal: async (url) => void opened.push(url), downloadsDir: () => downloads } })
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    const paper = await call("library.openInBrowser", { id: sage.id })
    expect(opened).toEqual(["https://doi.org/10.1177/0956797620904990"])
    expect(paper.noPdf.inBrowser.until).toBeGreaterThan(Date.now())
    // A file that was there before isn't taken; one that arrives (written under another name, then
    // renamed, as browsers do) is
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "3613904.3642549.pdf.crdownload"), makePdf([[{ x: 72, y: 72, size: 10, text: "https://doi.org/10.1177/0956797620904990" }]]))
    renameSync(path.join(downloads, "3613904.3642549.pdf.crdownload"), path.join(downloads, "3613904.3642549.pdf"))
    await until(async () => (await call("library.list")).papers.find((p: { id: string; pdf?: unknown }) => p.id === sage.id && p.pdf))
  })

  it("asks before taking a PDF that names no paper", async () => {
    const { browser } = fakeBrowser(async () => {
      throw new NeedsUser("challenge", "journals.sagepub.com")
    })
    const downloads = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-downloads-")))
    const { call } = await setup(browser, {}, {}, { host: { openExternal: async () => {}, downloadsDir: () => downloads } })
    await call("library.add", { paper: sage })
    await call("library.fetchPdf", { id: sage.id })
    await call("library.openInBrowser", { id: sage.id })
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(path.join(downloads, "fulltext.pdf"), makePdf([[{ x: 72, y: 72, size: 10, text: "Some paper or other" }]]))
    const offered = await until(async () => (await call("library.list")).papers.find((p: { id: string; noPdf?: { inBrowser?: { offered?: string } } }) => p.id === sage.id && p.noPdf?.inBrowser?.offered))
    expect(offered.noPdf.inBrowser.offered).toBe("fulltext.pdf")
    expect((await call("library.takeDownload", { id: sage.id, take: true })).pdf).toBeDefined()
  })
})

describe("the ACM through your own browser", () => {
  const acm = { id: "doi-10.1145-3613904.3642549", title: "Proactive Agents in Everyday Life", authors: [], ids: { doi: "10.1145/3613904.3642549" } }
  const second = { id: "doi-10.1145-3706598.3713300", title: "Second", authors: [], ids: { doi: "10.1145/3706598.3713300" } }
  const third = { id: "doi-10.1145-3706598.3713332", title: "Third", authors: [], ids: { doi: "10.1145/3706598.3713332" } }
  const pdfOf = (doi: string) => `https://dl.acm.org/doi/pdf/${doi}?download=true`

  function quick(gap: number, wait: number) {
    process.env.OWLIT_BROWSER_GAP_MS = String(gap)
    process.env.OWLIT_BROWSER_WAIT_MS = String(wait)
    onTestFinished(() => {
      delete process.env.OWLIT_BROWSER_GAP_MS
      delete process.env.OWLIT_BROWSER_WAIT_MS
    })
  }

  async function withDownloads() {
    const downloads = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-downloads-")))
    const opened: { url: string; background?: boolean; at: number }[] = []
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const ctx = await setup(browser, {}, {}, {
      host: {
        openExternal: async (url, options) => void opened.push({ url, background: options?.background, at: Date.now() }),
        browserName: async () => "Dia",
        downloadsDir: () => downloads,
      },
    })
    return { ...ctx, downloads, opened, asked }
  }

  const paperIn = async (call: (method: string) => Promise<any>, id: string) => (await call("library.list")).papers.find((p: { id: string }) => p.id === id)

  it("never opens an ACM page in owlit's browser, and says the user's browser gets it", async () => {
    const { root, call, asked } = await withDownloads()
    await call("library.add", { paper: acm })
    const paper = await call("library.fetchPdf", { id: acm.id })
    expect(paper.noPdf).toMatchObject({ needs: "browser" })
    expect(asked).toEqual([])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition.needs).toMatchObject({ reason: "browser", host: "dl.acm.org", url: pdfOf(acm.ids.doi) })
  })

  it("asks for the user's browser on an ACM paper noted before owlit knew", async () => {
    const { root, call } = await withDownloads()
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    const file = path.join(root, "library/papers", acm.id, "acquisition.json")
    const acquisition = JSON.parse(readFileSync(file, "utf8"))
    writeFileSync(file, JSON.stringify({ ...acquisition, needs: { reason: "refused", route: "browser:acm", at: 1, host: "dl.acm.org" } }))
    expect((await paperIn(call, acm.id)).noPdf).toMatchObject({ needs: "browser" })
  })

  it.runIf(process.platform === "darwin")("opens the PDF behind owlit's window and takes the file by where it was saved from", async () => {
    const { call, downloads, opened } = await withDownloads()
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    await call("library.getInBrowser", { ids: [acm.id] })
    await until(async () => opened.length > 0)
    expect(opened[0]).toMatchObject({ url: pdfOf(acm.ids.doi), background: true })
    expect((await until(async () => (await paperIn(call, acm.id)).noPdf?.fromBrowser)) as unknown).toEqual({ state: "opened", browser: "Dia" })
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
    expect(done.noPdf).toBeUndefined()
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
    expect((await paperIn(call, acm.id)).noPdf.fromBrowser).toMatchObject({ state: "missed" })
    expect((await paperIn(call, third.id)).noPdf.fromBrowser).toMatchObject({ state: "queued" })
    // Continue: the last one is opened, and with nothing after it the run ends rather than waiting
    await call("tasks.resume", { id: waiting.id })
    await until(async () => heard.some((t) => t.id === waiting.id && t.state === "done"))
    expect(opened.map((o) => o.url).at(-1)).toBe(pdfOf(third.ids.doi))
    expect((await paperIn(call, third.id)).noPdf.fromBrowser).toMatchObject({ state: "missed" })
    // Trying one again starts a new run for it
    await call("library.getInBrowser", { ids: [second.id] })
    await until(async () => opened.length === 4)
    expect(opened[3].url).toBe(pdfOf(second.ids.doi))
  })

  it("stops when asked, leaving the papers that hadn't had their turn as they were", async () => {
    quick(60_000, 60_000)
    const { call, opened, heard } = await withDownloads()
    for (const paper of [acm, second]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    await call("library.getInBrowser", { ids: [acm.id, second.id] })
    await until(async () => opened.length === 1)
    const run = heard.find((t) => t.kind === "papers.fromBrowser")!
    await call("tasks.cancel", { id: run.id })
    await until(async () => !(await paperIn(call, second.id)).noPdf.fromBrowser)
    expect((await paperIn(call, second.id)).noPdf.needs).toBe("browser")
    expect(opened).toHaveLength(1)
  })
})
