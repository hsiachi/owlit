import { RpcErrorCode, type PaperRecord } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.dispose()))
})

// A core whose network serves recorded responses
async function setup(routes: Record<string, string | number>) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-library-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const asked: string[] = []
  const fetch = (async (url: string) => {
    asked.push(url)
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    return typeof match[1] === "number" ? new Response("", { status: match[1] }) : new Response(match[1])
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  return { root, call, asked, core }
}

const published = {
  "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
  "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
}

function putPaper(root: string, record: Partial<PaperRecord> & { id: string }) {
  const dir = path.join(root, "library/papers", record.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, title: "?", authors: [], fields: {}, ...record }))
}

describe("library over RPC", () => {
  it("resolves a pasted DOI link into a preview with its library id", async () => {
    const { call } = await setup(published)
    const { paper, existingId } = await call("library.resolve", { input: "https://doi.org/10.1145/3626772.3657891" })
    expect(existingId).toBeUndefined()
    expect(paper).toMatchObject({ id: "doi-10.1145-3626772.3657891", year: 2024, kind: "conference", ids: { arxiv: "2403.17859" } })
  })

  it("finds a paper the library has under another of its ids, without asking anyone", async () => {
    const { root, call, asked } = await setup({})
    putPaper(root, { id: "arxiv-2403.17859", title: "ChroniclingAmericaQA", ids: { arxiv: "2403.17859", doi: "10.1145/3626772.3657891" } })
    const { existingId, paper } = await call("library.resolve", { input: "10.1145/3626772.3657891" })
    expect(existingId).toBe("arxiv-2403.17859")
    expect(paper.title).toBe("ChroniclingAmericaQA")
    expect(asked).toEqual([])
    expect(await call("library.known", { inputs: ["arXiv:2403.17859v2", "10.9999/x", "words"] })).toEqual(["arxiv-2403.17859", null, null])
  })

  it("answers in sentences when it can't", async () => {
    const { call } = await setup({ "api.openalex.org": 503, "api.semanticscholar.org": 503 })
    await expect(call("library.resolve", { input: "hello there" })).rejects.toMatchObject({ code: RpcErrorCode.NotFound })
    await expect(call("library.resolve", { input: "10.1145/3626772.3657891" })).rejects.toMatchObject({
      code: RpcErrorCode.Unavailable,
      message: "api.openalex.org is having trouble right now.",
    })
  })

  it("paper.metadata rewrites paper.json, keeps the sources and keeps fields the services lack", async () => {
    const { root, core } = await setup(published)
    putPaper(root, { id: "doi-10.1145-3626772.3657891", title: "Old title", ids: { doi: "10.1145/3626772.3657891" }, venue: "kept?" })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    const done = await workspace.tasks.run("paper.metadata", "doi-10.1145-3626772.3657891")
    expect(done.state).toBe("done")
    const dir = path.join(root, "library/papers/doi-10.1145-3626772.3657891")
    const record = JSON.parse(readFileSync(path.join(dir, "paper.json"), "utf8")) as PaperRecord
    expect(record).toMatchObject({
      id: "doi-10.1145-3626772.3657891",
      ids: { doi: "10.1145/3626772.3657891", arxiv: "2403.17859", openalex: "W4393248081" },
      year: 2024,
      kind: "conference",
      fields: { title: "openalex", tldr: "s2" },
      pdfUrls: ["https://arxiv.org/pdf/2403.17859"],
    })
    expect(record.title).toMatch(/^ChroniclingAmericaQA/)
    expect(record.fetchedAt).toBeGreaterThan(0)
    expect(existsSync(path.join(dir, "sources/openalex.json"))).toBe(true)
    expect(existsSync(path.join(dir, "sources/s2.json"))).toBe(true)
  })

  it("paper.metadata leaves a paper nobody can be asked about alone", async () => {
    const { root, core, asked } = await setup({})
    putPaper(root, { id: "local-abc123", title: "Scanned notes", ids: {} })
    const workspace = (core as unknown as { workspace: import("../workspace/workspace.ts").Workspace }).workspace
    expect((await workspace.tasks.run("paper.metadata", "local-abc123")).state).toBe("done")
    expect(asked).toEqual([])
  })
})
