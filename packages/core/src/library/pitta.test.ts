import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { makePdf, paragraph } from "./text/make-pdf.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

// Every file under a folder with its bytes' hash: what "unchanged" means
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const child = path.join(rel, name)
      if (statSync(path.join(dir, child)).isDirectory()) walk(child)
      else out[child] = createHash("sha256").update(readFileSync(path.join(dir, child))).digest("hex")
    }
  }
  walk("")
  return out
}

function pittaLibrary(base: string) {
  const root = path.join(base, "pitta")
  const paper = (id: string, files: Record<string, string | Buffer>) => {
    const dir = path.join(root, "papers", id)
    mkdirSync(path.join(dir, "sources"), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body)
  }
  paper("arxiv-2408.00447", {
    "metadata.json": JSON.stringify({ paper_id: "arxiv-2408.00447", source: "arxiv", external_ids: { arxiv: "2408.00447" }, title: "DiscipLink", authors: ["Chengbo Zheng"], abstract: "Interdisciplinary studies.", published: "2024-08-01", pdf_url: "https://arxiv.org/pdf/2408.00447v1", venue: "", added_at: "2026-08-02T15:28:25Z" }),
    "paper.pdf": makePdf([paragraph(72, 100, ["DiscipLink body text on the first page."])]),
    "parsed.md": "# DiscipLink\n\nMinerU's careful Markdown.",
    "digest.md": "# Digest\n\nWhat matters in this paper.",
    "sources/arxiv.xml": "<feed/>",
    "download.json": JSON.stringify({ attempts: [{ route: "arxiv", url: "https://arxiv.org/pdf/2408.00447", status: 200, at: "2026-08-02T15:28:30Z" }], pdf_source: "arxiv" }),
  })
  paper("doi-10.1177-00380385241263810", {
    "metadata.json": JSON.stringify({ paper_id: "doi-10.1177-00380385241263810", source: "semantic_scholar", external_ids: { s2: "2625f9fca0d9564d827304f33fe24f4ae20e7e3a", doi: "10.1177/00380385241263810" }, title: "The Consequentiality of Absences", authors: ["Konstantinos Poulis"], published: "2024-08-02", venue: "Sociology", added_at: "2026-08-02T04:02:26Z" }),
    "download.json": JSON.stringify({ attempts: [{ route: "upstream", url: "https://journals.sagepub.com/x", status: 403, error: "403", at: "2026-08-02T04:02:26Z" }], pdf_source: null, attempted_at: "2026-08-02T04:03:00Z" }),
  })
  // An older record: no external_ids
  paper("arxiv-2005.11401", { "metadata.json": JSON.stringify({ paper_id: "arxiv-2005.11401", source: "arxiv", title: "Retrieval-Augmented Generation", authors: ["Patrick Lewis"] }) })
  return root
}

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-pitta-")))
  const ws = path.join(base, "ws")
  mkdirSync(ws)
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: ws })
  return { base, ws, call, workspace: (core as unknown as { workspace: Workspace }).workspace }
}

describe("importing a pitta library", () => {
  it("brings every paper in under its id, once, and leaves the source as it was", async () => {
    const { base, ws, call, workspace } = await setup()
    const pitta = pittaLibrary(base)
    const before = fingerprint(pitta)

    expect(await call("library.importPitta", { root: pitta })).toEqual({ added: 3, skipped: 0, failed: [] })
    const { papers } = await call("library.list")
    const byId = Object.fromEntries(papers.map((p: { id: string }) => [p.id, p]))
    expect(Object.keys(byId).sort()).toEqual(["arxiv-2005.11401", "arxiv-2408.00447", "doi-10.1177-00380385241263810"])
    expect(byId["arxiv-2408.00447"]).toMatchObject({ title: "DiscipLink", year: 2024, kind: "preprint", hasDigest: true, ids: { arxiv: "2408.00447" } })
    expect(byId["arxiv-2408.00447"].pdf).toBeDefined()
    expect(byId["arxiv-2408.00447"].addedAt).toBe(Date.parse("2026-08-02T15:28:25Z"))
    expect(byId["doi-10.1177-00380385241263810"]).toMatchObject({ venue: "Sociology", pdfState: { state: "no-pdf", tried: [{ by: "owlit", ended: "no-copy", route: "upstream" }] }, ids: { doi: "10.1177/00380385241263810" } })
    expect(byId["arxiv-2005.11401"].ids).toEqual({ arxiv: "2005.11401" })
    expect(await call("library.digest", { id: "arxiv-2408.00447" })).toMatch(/What matters/)

    // pdfium adds the coordinates and leaves MinerU's Markdown alone
    const text = workspace.tasks.list().find((t) => t.kind === "paper.text" && t.subject === "arxiv-2408.00447")!
    await workspace.tasks.wait(text.id)
    const dir = path.join(ws, "library/papers/arxiv-2408.00447")
    expect(readFileSync(path.join(dir, "text.md"), "utf8")).toMatch(/MinerU's careful Markdown/)
    expect(JSON.parse(readFileSync(path.join(dir, "text.json"), "utf8")).source).toBe("pdfium")
    expect(readFileSync(path.join(dir, "sources/arxiv.xml"), "utf8")).toBe("<feed/>")

    expect(await call("library.importPitta", { root: pitta })).toEqual({ added: 0, skipped: 3, failed: [] })
    expect(fingerprint(pitta)).toEqual(before)
  })

  it("says so when the folder isn't a pitta library", async () => {
    const { base, call } = await setup()
    await expect(call("library.importPitta", { root: path.join(base, "nowhere") })).rejects.toThrow(/no papers folder/)
  })
})
