import type { Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { NeedsUser, type BrowserHost, type BrowserRequest } from "../host.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { browserRoutes, pdfLinkOn, siteOf, throughProxy } from "./browser-routes.ts"

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n")

describe("browser routes", () => {
  it("goes to the publisher's page, then through the proxy", () => {
    const routes = browserRoutes("10.1145/3613904.3642549", { base: "https://tlink.lib.tsinghua.edu.cn/", scheme: "login-url", path: "/go" })
    expect(routes.map((r) => [r.name, r.landing, r.pdf])).toEqual([
      ["browser:acm", "https://dl.acm.org/doi/10.1145/3613904.3642549", "https://dl.acm.org/doi/pdf/10.1145/3613904.3642549"],
      ["browser:acm:proxied", "https://tlink.lib.tsinghua.edu.cn/go?url=https://dl.acm.org/doi/10.1145/3613904.3642549", "https://dl.acm.org/doi/pdf/10.1145/3613904.3642549"],
    ])
    expect(routes[1].allowHosts).toContain("tlink.lib.tsinghua.edu.cn")
    expect(browserRoutes("10.9999/x", undefined)).toMatchObject([{ name: "browser:doi", landing: "https://doi.org/10.9999/x" }])
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

async function setup(browser: BrowserHost, library: object = {}, registered: Record<string, string> = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-browser-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  mkdirSync(path.join(base, "userData"))
  writeFileSync(path.join(base, "userData/settings.json"), JSON.stringify({ version: 1, recentWorkspaces: [], library }))
  // The plain routes get the publisher's sign-in page; doi.org's handle records say where a DOI is
  // registered when the test gives any
  const fetch = (async (url: string) => {
    const doi = decodeURIComponent(url.match(/doi\.org\/api\/handles\/([^?]+)/)?.[1] ?? "")
    if (registered[doi]) return Response.json({ responseCode: 1, values: [{ type: "URL", data: { value: registered[doi] } }] })
    return new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch, browser }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const heard: Task[] = []
  core.onNotify((n) => n.method === "tasks.changed" && heard.push((n.params as { task: Task }).task))
  return { root, call, heard, workspace: (core as unknown as { workspace: Workspace }).workspace }
}

const acm = { id: "doi-10.1145-3613904.3642549", title: "Paywalled", authors: [], ids: { doi: "10.1145/3613904.3642549" } }

describe("paper.pdf.browser", () => {
  it("gets the PDF in the browser once the plain routes fail", async () => {
    const { browser, asked } = fakeBrowser(async () => new Uint8Array(PDF))
    const { root, call } = await setup(browser)
    await call("library.add", { paper: acm })
    const paper = await call("library.fetchPdf", { id: acm.id })
    expect(paper.pdf).toBeDefined()
    expect(asked[0]).toMatchObject({ landing: "https://dl.acm.org/doi/10.1145/3613904.3642549", pdf: "https://dl.acm.org/doi/pdf/10.1145/3613904.3642549", pdfOnPageHost: false })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ result: "ok", route: "browser:acm" })
    expect(acquisition.tried.filter((t: { error?: string }) => !t.error?.startsWith("Not tried")).map((t: { route: string }) => t.route)).toEqual([
      "publisher:acm",
      "browser:acm",
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
    await call("library.add", { paper: acm })
    expect((await call("library.fetchPdf", { id: acm.id })).pdf).toBeDefined()
    expect(asked.map((r) => r.pdfOnPageHost)).toEqual([false, true])
    expect(asked.map((r) => r.proxyHost)).toEqual([undefined, "tlink.lib.tsinghua.edu.cn"])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition.route).toBe("browser:acm:proxied")
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
    await call("library.add", { paper: acm })
    expect((await call("library.fetchPdf", { id: acm.id })).noPdf).toMatchObject({ needs: "sign-in" })
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeUndefined()
    signedIn = true
    expect((await call("library.fetchPdf", { id: acm.id })).pdf).toBeDefined()
    await expect.poll(async () => (await call("settings.get")).library.proxySignedInAt).toBeGreaterThan(1)
  })

  it("notes a page that wants a person instead of waiting, while nobody is looking", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.withUser) throw new NeedsUser("challenge")
      return new Uint8Array(PDF)
    })
    const { root, call, heard } = await setup(browser)
    await call("library.add", { paper: acm })
    const paper = await call("library.fetchPdf", { id: acm.id })
    expect(paper.pdf).toBeUndefined()
    expect(paper.noPdf).toMatchObject({ needs: "check" })
    expect(asked.every((r) => !r.withUser)).toBe(true)
    expect(heard.filter((t) => t.kind === "paper.pdf.browser").map((t) => t.state)).not.toContain("waiting_for_you")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition.needs).toMatchObject({ reason: "challenge", route: "browser:acm" })
  })

  it("shows the page to the user on Check now, waits for them, then goes on by itself", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.withUser) throw new NeedsUser("login")
      await request.needUser("login", "Sign in.", new Promise((r) => setTimeout(r, 500)))
      return new Uint8Array(PDF)
    })
    const { root, call, heard } = await setup(browser)
    await call("library.add", { paper: acm })
    expect((await call("library.fetchPdf", { id: acm.id })).noPdf).toMatchObject({ needs: "sign-in" })
    const paper = await call("library.checkPublisher", { id: acm.id })
    expect(paper.pdf).toBeDefined()
    expect(paper.noPdf).toBeUndefined()
    expect(asked.at(-1)?.withUser).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    const states = heard.filter((t) => t.kind === "paper.pdf.check").map((t) => t.state)
    expect(states).toContain("waiting_for_you")
    expect(states.at(-1)).toBe("done")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ result: "ok", route: "browser:acm" })
    expect(acquisition.needs).toBeUndefined()
  })

  it("after one Check now, gets the same publisher's other papers by itself and leaves the rest noted", async () => {
    // The session keeps what the user's check left: past it once, the publisher's pages open unattended
    let passed = false
    const { browser, asked } = fakeBrowser(async (request) => {
      const host = new URL(request.landing).hostname
      if (request.withUser) passed = true
      else if (!passed || host !== "dl.acm.org") throw new NeedsUser("challenge", host)
      return new Uint8Array(PDF)
    })
    const sibling = { id: "doi-10.1145-1240624.1240656", title: "Same publisher", authors: [], ids: { doi: "10.1145/1240624.1240656" } }
    const other = { id: "doi-10.1080-09658211.2011.605591", title: "Another publisher", authors: [], ids: { doi: "10.1080/09658211.2011.605591" } }
    const { root, call } = await setup(browser)
    for (const paper of [acm, sibling, other]) {
      await call("library.add", { paper })
      await call("library.fetchPdf", { id: paper.id })
    }
    const needs = (id: string) => JSON.parse(readFileSync(path.join(root, "library/papers", id, "acquisition.json"), "utf8")).needs
    expect(needs(acm.id)).toMatchObject({ reason: "challenge", host: "dl.acm.org" })
    expect((await call("library.checkPublisher", { id: acm.id })).pdf).toBeDefined()
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
    await call("library.add", { paper: acm })
    await call("library.fetchPdf", { id: acm.id })
    const checking = call("library.checkPublisher", { id: acm.id })
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
    await call("library.add", { paper: acm })
    const paper = await call("library.fetchPdf", { id: acm.id })
    expect(paper.noPdf.tried).toEqual(["publisher:acm", "browser:acm"])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ result: "no_pdf" })
    expect(acquisition.tried.at(-2)).toMatchObject({ route: "browser:acm", error: "Gave up waiting for the sign-in after 5 minutes." })
    expect(acquisition.tried.at(-1)).toMatchObject({ error: "Not tried: no library proxy is set up." })
  })
})
