import type { Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { BrowserHost, BrowserRequest } from "../host.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { browserRoutes, throughProxy } from "./browser-routes.ts"

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

async function setup(browser: BrowserHost, library: object = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-browser-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  mkdirSync(path.join(base, "userData"))
  writeFileSync(path.join(base, "userData/settings.json"), JSON.stringify({ version: 1, recentWorkspaces: [], library }))
  // The plain routes get the publisher's sign-in page
  const fetch = (async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof globalThis.fetch
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

  it("tries the proxy when the publisher's page gives nothing directly", async () => {
    const { browser, asked } = fakeBrowser(async (request) => {
      if (!request.landing.includes("tlink")) throw new Error("The page had no PDF for this reader.")
      return new Uint8Array(PDF)
    })
    const { root, call } = await setup(browser, { proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" } })
    await call("library.add", { paper: acm })
    expect((await call("library.fetchPdf", { id: acm.id })).pdf).toBeDefined()
    expect(asked.map((r) => r.pdfOnPageHost)).toEqual([false, true])
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", acm.id, "acquisition.json"), "utf8"))
    expect(acquisition.route).toBe("browser:acm:proxied")
  })

  it("waits for the user while a challenge is up, then goes on by itself", async () => {
    const { browser } = fakeBrowser(async (request) => {
      await request.needUser("challenge", "The publisher wants to check this is a person.", new Promise((r) => setTimeout(r, 500)))
      return new Uint8Array(PDF)
    })
    const { call, heard } = await setup(browser)
    await call("library.add", { paper: acm })
    expect((await call("library.fetchPdf", { id: acm.id })).pdf).toBeDefined()
    await new Promise((r) => setTimeout(r, 300))
    const states = heard.filter((t) => t.kind === "paper.pdf.browser").map((t) => t.state)
    expect(states).toContain("waiting_for_you")
    expect(states.at(-1)).toBe("done")
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
