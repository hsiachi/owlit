import type { ImportSummary, Task } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../../core.ts"
import { makePdf, paragraph } from "../text/make-pdf.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "../fixtures", name), "utf8")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

const arxivPdf = makePdf([
  [
    { x: 20, y: 400, size: 20, text: "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023" },
    { x: 180, y: 120, size: 17, text: "Attention Is All You Need" },
    ...paragraph(72, 200, ["The dominant sequence transduction models are based on complex recurrent networks."]),
  ],
])
const unknownPdf = makePdf([
  [{ x: 120, y: 100, size: 18, text: "Notes Toward a Theory of Margins" }, ...paragraph(72, 180, ["A workshop paper no service has heard of."])],
])

// A workspace whose core answers arXiv from a fixture and nothing else; reopened on the same folders
// when given base
function setup(options: { base?: string; settings?: unknown } = {}) {
  const base = options.base ?? realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-bulk-")))
  const root = path.join(base, "ws")
  mkdirSync(root, { recursive: true })
  mkdirSync(path.join(base, "userData"), { recursive: true })
  if (options.settings) writeFileSync(path.join(base, "userData", "settings.json"), JSON.stringify(options.settings))
  const fetch = (async (url: string) => {
    if (url.includes("export.arxiv.org")) return new Response(fixture("arxiv-1706.03762.xml"))
    // A title search finds the one paper OpenAlex has, whatever was asked
    if (url.includes("api.openalex.org/works?search")) return new Response(JSON.stringify({ meta: { count: 1 }, results: [JSON.parse(fixture("openalex-doi.json"))] }))
    return new Response("", { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const task = async (id: string): Promise<Task> => ((await call("tasks.list")) as Task[]).find((t) => t.id === id)!
  // Resolves with the import's task once it is in one of these states
  const until = async (id: string, states: Task["state"][]) => {
    for (;;) {
      const t = await task(id)
      if (t && states.includes(t.state)) return t
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const summary = async (id: string): Promise<ImportSummary> => ((await call("library.imports")) as ImportSummary[]).find((s) => s.id === id)!
  return { base, root, core, call, task, until, summary, open: () => call("workspace.open", { path: root }) }
}

const bib = (entries: string[]) => entries.join("\n\n")

describe("library.import", () => {
  it("adds a BibTeX file's papers, skips the ones the library has and says which it couldn't add", async () => {
    const { base, call, open, until, summary } = setup()
    await open()
    await call("library.add", { paper: { id: "doi-10.1145-3626772.3657891", title: "ChroniclingAmericaQA", authors: ["Bhawna Piryani"], ids: { doi: "10.1145/3626772.3657891" } } })
    const file = path.join(base, "refs.bib")
    writeFileSync(
      file,
      bib([
        "@inproceedings{vaswani2017, title = {Attention Is All You Need}, author = {Vaswani, Ashish and Shazeer, Noam}, year = 2017, eprint = {1706.03762}, archivePrefix = {arXiv}}",
        "@article{piryani2024, title = {{ChroniclingAmericaQA}}, author = {Piryani, Bhawna}, doi = {10.1145/3626772.3657891}, year = 2024}",
        "@article{ghost, title = {A Paper Nobody Indexed}, author = {Nobody, A.}, year = 1999}",
      ]),
    )
    expect(await call("library.previewImport", { source: "bibtex", path: file })).toEqual({ total: 3, withPdf: 0, known: 1, collections: 0, asksParse: false })
    const started: ImportSummary = await call("library.import", { source: "bibtex", path: file })
    expect(started).toMatchObject({ source: "bibtex", path: file, added: [], existed: 0 })
    expect(await until(started.taskId, ["done"])).toMatchObject({ kind: "import.bibtex", progress: { done: 3, total: 3 } })
    const done = await summary(started.id)
    expect(done).toMatchObject({ total: 3, added: ["arxiv-1706.03762"], existed: 1, failed: [{ key: "ghost", title: "A Paper Nobody Indexed" }] })
    expect(done.finishedAt).toBeGreaterThan(0)
    const { papers } = await call("library.list")
    expect(papers.find((p: { id: string }) => p.id === "arxiv-1706.03762")).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, addedBy: "user" })

    await call("library.dismissImport", { id: started.id })
    expect(await summary(started.id)).toMatchObject({ dismissed: true })
  })

  it("brings in a folder of PDFs: recognised ones with their metadata, the rest as local papers whose text can be read", async () => {
    const { base, call, open, until, summary } = setup()
    await open()
    const folder = path.join(base, "pdfs")
    mkdirSync(path.join(folder, "2023"), { recursive: true })
    writeFileSync(path.join(folder, "2023", "attention.pdf"), arxivPdf)
    writeFileSync(path.join(folder, "margins.pdf"), unknownPdf)
    const started: ImportSummary = await call("library.import", { source: "folder", path: folder })
    await until(started.taskId, ["done"])
    const { added } = await summary(started.id)
    expect(added).toHaveLength(2)
    expect(added).toContain("arxiv-1706.03762")
    const local = added.find((id) => id.startsWith("local-"))!
    for (;;) {
      const read = await call("library.read", { id: local, part: "text" }).catch(() => null)
      if (read) {
        expect(read.text).toMatch(/workshop paper no service has heard of/)
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    // Importing the same folder again adds nothing
    const again: ImportSummary = await call("library.import", { source: "folder", path: folder })
    await until(again.taskId, ["done"])
    expect(await summary(again.id)).toMatchObject({ added: [], existed: 2 })
  })

  it("looks up an entry with only a title, taking an exact match alone", async () => {
    const { base, call, open, until, summary } = setup()
    await open()
    const file = path.join(base, "titles.bib")
    writeFileSync(
      file,
      bib([
        "@article{qa, title = {{ChroniclingAmericaQA}: A Large-scale Question Answering Dataset based on Historical American Newspaper Pages}}",
        "@book{other, title = {Historical American Newspapers}}",
      ]),
    )
    const started: ImportSummary = await call("library.import", { source: "bibtex", path: file })
    await until(started.taskId, ["done"])
    expect(await summary(started.id)).toMatchObject({ added: ["doi-10.1145-3626772.3657891"], failed: [{ key: "other", error: "No paper with this title was found." }] })
  })

  it("refuses a path that isn't there", async () => {
    const { call, open } = setup()
    await open()
    await expect(call("library.import", { source: "bibtex", path: "/nowhere/refs.bib" })).rejects.toThrow(/There is nothing at/)
  })

  it("carries on after owlit stops in the middle, without adding anything twice", async () => {
    const first = setup()
    await first.open()
    const file = path.join(first.base, "many.bib")
    writeFileSync(file, bib(Array.from({ length: 40 }, (_, i) => `@article{p${i}, title = {Paper ${i}}, author = {Writer, A.}, doi = {10.5555/p${i}}, year = 2020}`)))
    const started: ImportSummary = await first.call("library.import", { source: "bibtex", path: file })
    for (;;) {
      const t = await first.task(started.taskId)
      if ((t.progress?.done ?? 0) >= 5 || t.state === "done") break
      await new Promise((r) => setTimeout(r, 5))
    }
    await first.core.dispose()

    const second = setup({ base: first.base })
    await second.open()
    await second.until(started.taskId, ["done"])
    const done = await second.summary(started.id)
    expect(done.added).toHaveLength(40)
    expect(new Set(done.added).size).toBe(40)
    expect(done.existed).toBe(0)
    expect((await second.call("library.list")).papers).toHaveLength(40)
  })

  it("stops before the next paper when cancelled, and continues when asked", async () => {
    const { base, call, open, until, summary } = setup()
    await open()
    const file = path.join(base, "many.bib")
    writeFileSync(file, bib(Array.from({ length: 200 }, (_, i) => `@article{p${i}, title = {Paper ${i}}, doi = {10.5555/c${i}}}`)))
    const started: ImportSummary = await call("library.import", { source: "bibtex", path: file })
    await until(started.taskId, ["running"])
    await call("tasks.cancel", { id: started.taskId })
    await new Promise((r) => setTimeout(r, 200))
    const after = await summary(started.id)
    expect(after.added.length).toBeLessThan(200)
    expect((await call("library.list")).papers).toHaveLength(after.added.length)
    expect((await until(started.taskId, ["cancelled"])).state).toBe("cancelled")

    const continued: ImportSummary = await call("library.continueImport", { id: started.id })
    expect(continued.taskId).not.toBe(started.taskId)
    await until(continued.taskId, ["done"])
    expect(await summary(started.id)).toMatchObject({ total: 200, existed: 0 })
    expect((await summary(started.id)).added).toHaveLength(200)
  })

  it("asks before MinerU reads more than a hundred PDFs, and leaves them unread when told", async () => {
    const { base, call, open, until, summary } = setup({ settings: { parsing: { service: "self-hosted", url: "http://127.0.0.1:9", auto: true } } })
    await open()
    const folder = path.join(base, "pdfs")
    mkdirSync(folder)
    for (let i = 0; i < 101; i++) {
      writeFileSync(path.join(folder, `margins-${i}.pdf`), makePdf([[{ x: 120, y: 100, size: 18, text: `Margins, part ${i}` }, ...paragraph(72, 180, [`Part ${i} of a long series.`])]]))
    }
    const started: ImportSummary = await call("library.import", { source: "folder", path: folder })
    expect(await call("library.previewImport", { source: "folder", path: folder })).toMatchObject({ total: 101, withPdf: 101, known: 0, asksParse: true })
    expect(await until(started.taskId, ["waiting_for_you"])).toMatchObject({ waiting: { reason: "confirm_spend", detail: expect.stringMatching(/101 new papers/) } })
    await call("library.importAnswer", { id: started.id, parse: false })
    await until(started.taskId, ["done"])
    expect(await summary(started.id)).toMatchObject({ parse: false })
    expect((await summary(started.id)).added).toHaveLength(101)
    // Every paper's text is read by pdfium; none goes to MinerU
    for (;;) {
      const tasks: Task[] = await call("tasks.list")
      if (!tasks.some((t) => t.kind === "paper.text" && t.state !== "done")) {
        expect(tasks.filter((t) => t.kind === "paper.parse")).toEqual([])
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    // A hundred and one PDFs read twice (recognising each, then its text)
  }, 60_000)
})
