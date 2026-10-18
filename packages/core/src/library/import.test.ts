import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { makePdf, paragraph } from "./text/make-pdf.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup(routes: Record<string, string> = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-import-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const fetch = (async (url: string) => {
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    return match ? new Response(match[1]) : new Response("", { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const file = (name: string, pdf: Buffer) => {
    const at = path.join(base, name)
    writeFileSync(at, pdf)
    return at
  }
  return { root, call, file }
}

const arxivPdf = makePdf([
  [
    { x: 20, y: 400, size: 20, text: "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023" },
    { x: 180, y: 120, size: 17, text: "Attention Is All You Need" },
    ...paragraph(72, 200, ["The dominant sequence transduction models are based on complex recurrent networks."]),
  ],
])

const unknownPdf = makePdf([
  [
    { x: 120, y: 100, size: 18, text: "Notes Toward a Theory of Margins" },
    { x: 240, y: 130, size: 11, text: "A. Writer" },
    ...paragraph(72, 180, ["This is a workshop paper that no service has ever heard of, with no identifier."]),
  ],
])

describe("library.importPdf", () => {
  it("recognises an arXiv PDF by its stamp, adds it with its metadata and keeps the file", async () => {
    const { root, call, file } = await setup({ "export.arxiv.org": fixture("arxiv-1706.03762.xml") })
    const { paper, existed } = await call("library.importPdf", { path: file("1706.03762v7.pdf", arxivPdf) })
    expect(existed).toBe(false)
    expect(paper).toMatchObject({ id: "arxiv-1706.03762", title: "Attention Is All You Need", year: 2017 })
    expect(paper.authors).toHaveLength(8)
    expect(paper.pdf.url).toMatch(/arxiv-1706\.03762\/paper\.pdf$/)
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers/arxiv-1706.03762/acquisition.json"), "utf8"))
    expect(acquisition).toMatchObject({ state: "have-it", route: "dropped" })
    expect(acquisition.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("finds a DOI printed on the first page", async () => {
    const { call, file } = await setup({
      "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
      "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
    })
    const pdf = makePdf([[{ x: 72, y: 60, size: 8, text: "https://doi.org/10.1145/3626772.3657891" }, ...paragraph(72, 120, ["ChroniclingAmericaQA body text."])]])
    const { paper } = await call("library.importPdf", { path: file("sigir.pdf", pdf) })
    expect(paper).toMatchObject({ id: "doi-10.1145-3626772.3657891", year: 2024, kind: "conference" })
  })

  it("keeps a file nobody can name as local-<hash>, titled from its first page", async () => {
    const { root, call, file } = await setup()
    const { paper } = await call("library.importPdf", { path: file("scan_0042.pdf", unknownPdf) })
    expect(paper.id).toMatch(/^local-[0-9a-f]{12}$/)
    expect(paper.title).toBe("Notes Toward a Theory of Margins")
    expect(paper.ids).toEqual({})
    expect(existsSync(path.join(root, "library/papers", paper.id, "paper.pdf"))).toBe(true)
  })

  it("knows the same file dropped twice", async () => {
    const { call, file } = await setup()
    const first = await call("library.importPdf", { path: file("a.pdf", unknownPdf) })
    const again = await call("library.importPdf", { path: file("copy of a.pdf", unknownPdf) })
    expect(again).toMatchObject({ existed: true, paper: { id: first.paper.id } })
    expect((await call("library.list")).papers).toHaveLength(1)
  })

  it("refuses a file that isn't a PDF", async () => {
    const { call, file } = await setup()
    await expect(call("library.importPdf", { path: file("notes.pdf", Buffer.from("hello")) })).rejects.toThrow("That file isn't a PDF.")
  })

  it("moves a local paper to its DOI once the user gives one, and keeps the old id as an alias", async () => {
    const { root, call, file } = await setup({
      "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
      "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
    })
    const { paper } = await call("library.importPdf", { path: file("x.pdf", unknownPdf) })
    await call("library.update", { id: paper.id, patch: { starred: true } })
    await call("library.setNote", { paperId: paper.id, content: "my note" })
    const moved = await call("library.update", { id: paper.id, patch: { ids: { doi: "https://doi.org/10.1145/3626772.3657891" } } })
    expect(moved.id).toBe("doi-10.1145-3626772.3657891")
    expect(moved.starred).toBe(true)
    expect(existsSync(path.join(root, "library/papers", paper.id))).toBe(false)
    expect(existsSync(path.join(root, "library/papers/doi-10.1145-3626772.3657891/paper.pdf"))).toBe(true)
    const listed = await call("library.list")
    expect(listed.aliases).toEqual({ [paper.id]: "doi-10.1145-3626772.3657891" })
    expect(listed.notes).toMatchObject([{ paperId: "doi-10.1145-3626772.3657891", content: "my note" }])
    // The same file dropped again finds the paper where it now is
    expect((await call("library.importPdf", { path: file("x2.pdf", unknownPdf) })).paper.id).toBe("doi-10.1145-3626772.3657891")
  })
})
