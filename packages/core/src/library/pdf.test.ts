import type { PaperRecord } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { serveWorkspaceFile } from "../files/serve.ts"
import { Http } from "../net/http.ts"
import { isThisPaper } from "./downloads.ts"
import { lookDue } from "./acquisition.ts"
import { downloadPdf, pdfInHtml, routesFor } from "./pdf.ts"
import { makePdf } from "./text/make-pdf.ts"

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n")

const record = (ids: PaperRecord["ids"], pdfUrls: string[] = []): PaperRecord => ({ version: 1, id: "x", ids, title: "T", authors: [], fields: {}, pdfUrls })

const collect = async (routes: AsyncIterable<{ name: string; url: string }>) => {
  const all: string[] = []
  for await (const r of routes) all.push(`${r.name} ${r.url}`)
  return all
}

describe("routesFor", () => {
  it("tries arXiv, then the open-access links, then the publisher, then Unpaywall, without repeats", async () => {
    const routes = routesFor(record({ arxiv: "2403.17859", doi: "10.1007/s11192-023-04640-1" }, ["https://arxiv.org/pdf/2403.17859", "https://repo.example.org/a.pdf"]), {
      landing: async () => undefined,
      unpaywall: async () => [{ kind: "unpaywall", name: "unpaywall/repository", url: "https://repo.example.org/a.pdf" }, { kind: "unpaywall", name: "unpaywall/publisher", url: "https://u.example.org/b.pdf" }],
    })
    expect(await collect(routes)).toEqual([
      "arxiv https://arxiv.org/pdf/2403.17859",
      "open-access https://repo.example.org/a.pdf",
      "publisher:springer https://link.springer.com/content/pdf/10.1007/s11192-023-04640-1.pdf",
      "unpaywall/publisher https://u.example.org/b.pdf",
    ])
  })

  it("asks where doi.org leads only for publishers whose PDF hangs off that page", async () => {
    let asked = 0
    const lookups = {
      landing: async () => {
        asked++
        return "https://www.mdpi.com/2076-3417/13/1/1/"
      },
      unpaywall: async () => [],
    }
    expect(await collect(routesFor(record({ doi: "10.3390/app13010001" }), lookups))).toEqual(["publisher:mdpi https://www.mdpi.com/2076-3417/13/1/1/pdf"])
    expect(await collect(routesFor(record({ doi: "10.1145/3626772.3657891" }), lookups))).toEqual(["publisher:acm https://dl.acm.org/doi/pdf/10.1145/3626772.3657891"])
    expect(asked).toBe(1)
  })

  it("goes to the ACL Anthology before the ACM's listing of an ACL paper", async () => {
    const lookups = { landing: async () => undefined, unpaywall: async () => [] }
    // An older ACL DOI, registered by the ACM: the Anthology id comes from Semantic Scholar
    expect(await collect(routesFor(record({ doi: "10.3115/1654595.1654614", acl: "W06-1314" }, ["https://dl.acm.org/doi/pdf/10.5555/1654595.1654614"]), lookups))).toEqual([
      "acl-anthology https://aclanthology.org/W06-1314.pdf",
      "open-access https://dl.acm.org/doi/pdf/10.5555/1654595.1654614",
    ])
    // ACL's own DOIs end in the id; an old-style one is given back its capitals
    expect(await collect(routesFor(record({ doi: "10.18653/v1/2023.acl-long.1" }), lookups))).toEqual(["acl-anthology https://aclanthology.org/2023.acl-long.1.pdf"])
    expect(await collect(routesFor(record({ doi: "10.18653/v1/p17-1001" }), lookups))).toEqual(["acl-anthology https://aclanthology.org/P17-1001.pdf"])
  })
})

function serving(routes: Record<string, Response | (() => Response)>) {
  const fetch = (async (url: string) => {
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    return typeof match[1] === "function" ? match[1]() : match[1].clone()
  }) as unknown as typeof globalThis.fetch
  return fetch
}

describe("downloadPdf", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-pdf-"))
  it("keeps a PDF and refuses a web page", async () => {
    const http = new Http({ userAgent: "t", retryBaseMs: 1, fetch: serving({ "/ok.pdf": () => new Response(PDF), "/page": () => new Response("<!doctype html><title>Sign in</title>", { headers: { "content-type": "text/html" } }) }) })
    await downloadPdf(http, "https://pub.example.org/ok.pdf", path.join(dir, "a.pdf"))
    expect(readFileSync(path.join(dir, "a.pdf")).subarray(0, 5).toString()).toBe("%PDF-")
    await expect(downloadPdf(http, "https://pub.example.org/page", path.join(dir, "b.pdf"))).rejects.toThrow("pub.example.org served a web page, not a PDF.")
    expect(existsSync(path.join(dir, "b.pdf"))).toBe(false)
    expect(existsSync(path.join(dir, "b.pdf.part"))).toBe(false)
  })

  it("refuses a file larger than 200 MB before reading it", async () => {
    const http = new Http({ userAgent: "t", fetch: serving({ "/huge.pdf": () => new Response(PDF, { headers: { "content-length": String(300 * 1024 * 1024) } }) }) })
    await expect(downloadPdf(http, "https://pub.example.org/huge.pdf", path.join(dir, "c.pdf"))).rejects.toThrow("larger than 200 MB")
  })
})

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup(fetch: typeof globalThis.fetch, library = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-pdf-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const userData = path.join(base, "userData")
  mkdirSync(userData)
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, recentWorkspaces: [], library }))
  const core = new Core({ userDataDir: userData, host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  return { base, root, call, core }
}

describe("paper.pdf", () => {
  it("gets an arXiv paper's PDF and records the route", async () => {
    const { root, call } = await setup(serving({ "arxiv.org/pdf/1706.03762": () => new Response(PDF) }))
    await call("library.add", { paper: { id: "arxiv-1706.03762", title: "Attention", authors: [], ids: { arxiv: "1706.03762" } } })
    const paper = await call("library.fetchPdf", { id: "arxiv-1706.03762" })
    expect(paper.pdf.url).toBe("owlit-file://workspace/library/papers/arxiv-1706.03762/paper.pdf")
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers/arxiv-1706.03762/acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ version: 2, state: "have-it", route: "arxiv", tried: [{ by: "owlit", ended: "pdf", route: "arxiv" }] })
  })

  it("records no PDF with every route tried when the publisher wants a login", async () => {
    const fetch = serving({
      "dl.acm.org/doi/pdf": () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
      "api.unpaywall.org": () => Response.json({ oa_locations: [] }),
    })
    const { root, call } = await setup(fetch, { contactEmail: "me@example.org" })
    await call("library.add", { paper: { id: "doi-10.1145-1", title: "Paywalled", authors: [], ids: { doi: "10.1145/1" } } })
    const paper = await call("library.fetchPdf", { id: "doi-10.1145-1" })
    expect(paper.pdf).toBeUndefined()
    expect(paper.pdfState).toMatchObject({ state: "no-pdf", tried: [{ by: "owlit", ended: "no-copy", route: "publisher:acm" }], reason: { ended: "no-copy" } })
    // The next look, a day after this one
    expect(paper.pdfState.nextLook - paper.pdfState.tried[0].at).toBe(24 * 60 * 60 * 1000)
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-1/acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "no-pdf", looks: 1, dropHere: path.join(root, "library/papers/doi-10.1145-1/paper.pdf") })

    // The user has the file: it becomes the paper's PDF
    const file = path.join(root, "..", "found.pdf")
    writeFileSync(file, PDF)
    const attached = await call("library.attachPdf", { id: "doi-10.1145-1", path: file })
    expect(attached.pdf.url).toMatch(/paper\.pdf$/)
    expect(attached.pdfState).toBeUndefined()
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.1145-1/acquisition.json"), "utf8"))).toMatchObject({ state: "have-it", route: "dropped", tried: [{ ended: "no-copy" }, { by: "you", ended: "pdf", route: "dropped" }] })
    writeFileSync(file, "not a pdf")
    await expect(call("library.attachPdf", { id: "doi-10.1145-1", path: file })).rejects.toThrow("That file isn't a PDF.")
  })

  it("names no route it didn't try, and still counts the look", async () => {
    const { call } = await setup(serving({}))
    await call("library.add", { paper: { id: "doi-10.9999-x", title: "Nowhere", authors: [], ids: { doi: "10.9999/x" } } })
    await call("library.fetchPdf", { id: "doi-10.9999-x" })
    // Unpaywall wasn't asked without a contact email, so it isn't named
    expect((await call("library.list")).papers[0].pdfState).toMatchObject({ state: "no-pdf", tried: [{ by: "owlit", ended: "no-copy" }] })
    expect((await call("library.list")).papers[0].pdfState.tried[0].route).toBeUndefined()
  })

  it("waits for the network when nothing could be reached, and says so", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof globalThis.fetch
    const { root, call } = await setup(offline)
    await call("library.add", { paper: { id: "arxiv-1706.03762", title: "Attention", authors: [], ids: { arxiv: "1706.03762" } } })
    // The look after the add, whose retries are minutes apart: its first try is enough
    const file = path.join(root, "library/papers/arxiv-1706.03762/acquisition.json")
    await vi.waitFor(() => expect(existsSync(file)).toBe(true))
    const paper = (await call("library.list")).papers[0]
    expect(paper.pdfState).toMatchObject({ state: "finding", reason: { by: "owlit", ended: "offline" } })
    expect(paper.pdfState.nextLook).toBeUndefined()
    const acquisition = JSON.parse(readFileSync(file, "utf8"))
    expect(acquisition.state).toBe("finding")
    expect(lookDue(acquisition, Date.now())).toBe(true)
  })
})

describe("owlit-file", () => {
  it("serves workspace files with byte ranges and nothing outside the workspace", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-serve-")))
    const root = path.join(base, "ws")
    mkdirSync(path.join(root, "library/papers/p"), { recursive: true })
    writeFileSync(path.join(root, "library/papers/p/paper.pdf"), PDF)
    writeFileSync(path.join(base, "secret.txt"), "outside")
    symlinkSync(path.join(base, "secret.txt"), path.join(root, "link.txt"))
    const get = (url: string, headers: Record<string, string> = {}) => serveWorkspaceFile(root, new Request(url, { headers }))

    const whole = await get("owlit-file://workspace/library/papers/p/paper.pdf")
    expect(whole.status).toBe(200)
    expect(whole.headers.get("content-type")).toBe("application/pdf")
    expect(Buffer.from(await whole.arrayBuffer()).equals(PDF)).toBe(true)

    const part = await get("owlit-file://workspace/library/papers/p/paper.pdf", { range: "bytes=1-4" })
    expect(part.status).toBe(206)
    expect(part.headers.get("content-range")).toBe(`bytes 1-4/${PDF.length}`)
    expect(await part.text()).toBe("PDF-")
    expect((await get("owlit-file://workspace/library/papers/p/paper.pdf", { range: "bytes=-5" })).headers.get("content-range")).toBe(
      `bytes ${PDF.length - 5}-${PDF.length - 1}/${PDF.length}`,
    )
    expect((await get("owlit-file://workspace/library/papers/p/paper.pdf", { range: "bytes=9999-" })).status).toBe(416)

    expect((await get("owlit-file://workspace/../secret.txt")).status).not.toBe(200)
    expect((await get("owlit-file://workspace/%2E%2E/secret.txt")).status).not.toBe(200)
    expect((await get("owlit-file://workspace/link.txt")).status).toBe(403)
    expect((await get("owlit-file:///etc/passwd")).status).toBe(404)
    expect((await get("owlit-file://workspace/etc/passwd")).status).toBe(404)
    expect((await serveWorkspaceFile(undefined, new Request("owlit-file://workspace/library/papers/p/paper.pdf"))).status).toBe(404)
  })
})

describe("a repository's page instead of its PDF", () => {
  const title = "Lifelogging for memory support in everyday life"
  const page = (pdf: string) => () => new Response(`<html><head><meta name="citation_pdf_url" content="${pdf}"></head></html>`, { headers: { "content-type": "text/html" } })
  const unpaywall = () => Response.json({ oa_locations: [{ url_for_pdf: "https://repo.example.org/item/1", host_type: "repository" }] })
  const paper = { id: "doi-10.9999-repo", title, authors: [], ids: { doi: "10.9999/repo" } }

  it("takes the PDF the page names, once its first pages are the paper", async () => {
    const { root, call } = await setup(
      serving({
        "api.unpaywall.org": unpaywall,
        "repo.example.org/item/1/paper.pdf": () => new Response(makePdf([[{ x: 72, y: 72, size: 12, text: title }]])),
        "repo.example.org/item/1": page("https://repo.example.org/item/1/paper.pdf"),
      }),
      { contactEmail: "me@example.org" },
    )
    await call("library.add", { paper })
    expect((await call("library.fetchPdf", { id: paper.id })).pdf).toBeDefined()
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", paper.id, "acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "have-it", route: "unpaywall/repository:page" })
  })

  it("turns away a PDF the page names that is another paper", async () => {
    const { root, call } = await setup(
      serving({
        "api.unpaywall.org": unpaywall,
        "repo.example.org/item/1/other.pdf": () => new Response(makePdf([[{ x: 72, y: 72, size: 12, text: "A different paper about something else entirely" }]])),
        "repo.example.org/item/1": page("/item/1/other.pdf"),
      }),
      { contactEmail: "me@example.org" },
    )
    await call("library.add", { paper })
    await call("library.fetchPdf", { id: paper.id }).catch(() => undefined)
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", paper.id, "acquisition.json"), "utf8"))
    expect(acquisition.state).toBe("no-pdf")
    expect(acquisition.tried).toContainEqual(expect.objectContaining({ by: "owlit", ended: "no-copy", route: "unpaywall/repository:page" }))
    expect(existsSync(path.join(root, "library/papers", paper.id, "paper.pdf"))).toBe(false)
  })

  it("reads the PDF's address from the page's tags", () => {
    expect(pdfInHtml(`<meta content="https://tud.qucosa.de/api/x/attachment/ATT-0/" name="citation_pdf_url">`, "https://tud.qucosa.de/landing")).toBe("https://tud.qucosa.de/api/x/attachment/ATT-0/")
    expect(pdfInHtml(`<meta name="citation_pdf_url" content=""><link rel="alternate" type="application/pdf" href="/files/a.pdf?x=1&amp;y=2">`, "https://r.org/p/1")).toBe("https://r.org/files/a.pdf?x=1&y=2")
    expect(pdfInHtml(`<a href="a.pdf">PDF</a>`, "https://r.org/p/1")).toBeUndefined()
  })
})

describe("looking again for a paper without a PDF", () => {
  const day = 24 * 60 * 60 * 1000
  const noPdf = (at: number, looks?: number) => ({ state: "no-pdf" as const, tried: [{ by: "owlit" as const, ended: "no-copy" as const, at }], looks })
  it("waits longer each time nothing came: 1, 3, 7, then 30 days", () => {
    const now = 100 * day
    expect(lookDue(noPdf(now - day, 1), now)).toBe(true)
    expect(lookDue(noPdf(now - day, 2), now)).toBe(false)
    expect(lookDue(noPdf(now - 3 * day, 2), now)).toBe(true)
    expect(lookDue(noPdf(now - 6 * day, 3), now)).toBe(false)
    expect(lookDue(noPdf(now - 29 * day, 9), now)).toBe(false)
    expect(lookDue(noPdf(now - 30 * day, 9), now)).toBe(true)
    // Written before looks were counted: as after the first
    expect(lookDue(noPdf(now - day), now)).toBe(true)
  })

  it("goes again at once for a paper whose look reached nothing, and leaves one being looked for", () => {
    const now = 100 * day
    expect(lookDue({ state: "finding", tried: [{ by: "owlit", ended: "offline", at: now - 60_000 }] }, now)).toBe(true)
    expect(lookDue({ state: "finding", tried: [] }, now)).toBe(false)
  })
})

describe("is this the paper", () => {
  it("knows it by its DOI or whole title, and says when it can't tell", () => {
    const paper = { doi: "10.1/x", title: "Living “in the zone”: hyperfocus in adult ADHD" }
    expect(isThisPaper({ doi: "10.1/X", text: "" }, paper)).toBe("unknown")
    expect(isThisPaper({ doi: "10.1/X", text: "anything" }, paper)).toBe("yes")
    // Hyphens and quotes don't count
    expect(isThisPaper({ text: "Original Article Living \"in the zone\": hyper-focus in adult ADHD by" }, paper)).toBe("yes")
    expect(isThisPaper({ text: "Living in the zone: flow in adult ADHD" }, paper)).toBe("no")
    expect(isThisPaper({ text: "Living in the zone: hyperfocus in adult ADHD. Abstract" }, paper)).toBe("yes")
    expect(isThisPaper({ text: "Something else" }, paper)).toBe("no")
    expect(isThisPaper({ text: "Something else" }, { title: "Flow" })).toBe("unknown")
  })
})

describe("a paper without a DOI", () => {
  const title = "Flow states in sustained attention during everyday computer work"
  const entry = (name: string, author: string) =>
    `<feed><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>${name}</title><published>2024-01-01T00:00:00Z</published><author><name>${author}</name></author></entry></feed>`

  it("looks for an open copy with its very title, and keeps it once its pages say so", async () => {
    const { root, call } = await setup(
      serving({
        "export.arxiv.org": () => new Response(entry(title.toUpperCase(), "Mihaly Csikszentmihalyi")),
        "arxiv.org/pdf/2401.00001": () => new Response(makePdf([[{ x: 72, y: 72, size: 12, text: title }]])),
      }),
    )
    const paper = { id: "openalex-w1", title, authors: ["M. Csikszentmihalyi"], ids: { openalex: "W1" } }
    await call("library.add", { paper })
    expect((await call("library.fetchPdf", { id: paper.id })).pdf).toBeDefined()
    expect(JSON.parse(readFileSync(path.join(root, "library/papers", paper.id, "acquisition.json"), "utf8"))).toMatchObject({ route: "title:arxiv" })
  })

  it("leaves a paper by someone else with that title alone", async () => {
    const { root, call } = await setup(
      serving({
        "export.arxiv.org": () => new Response(entry(title, "Somebody Else")),
        "arxiv.org/pdf/2401.00001": () => new Response(makePdf([[{ x: 72, y: 72, size: 12, text: title }]])),
      }),
    )
    const paper = { id: "openalex-w1", title, authors: ["M. Csikszentmihalyi"], ids: { openalex: "W1" } }
    await call("library.add", { paper })
    await call("library.fetchPdf", { id: paper.id }).catch(() => undefined)
    expect(JSON.parse(readFileSync(path.join(root, "library/papers", paper.id, "acquisition.json"), "utf8")).state).toBe("no-pdf")
  })
})
