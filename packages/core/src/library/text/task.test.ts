import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../../core.ts"
import type { Workspace } from "../../workspace/workspace.ts"
import { makePdf, paragraph } from "./make-pdf.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-text-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  // No network: a paper with no PDF finds none
  const fetch = (async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  return { base, root, call, workspace }
}

describe("paper.text", () => {
  it("reads a PDF once it is attached and writes text.json and text.md", async () => {
    const { base, root, call, workspace } = await setup()
    await call("library.add", { paper: { id: "doi-10.9999-t", title: "T", authors: [], ids: { doi: "10.9999/t" } } })
    expect(await call("library.text", { id: "doi-10.9999-t" })).toBeNull()
    const file = path.join(base, "t.pdf")
    writeFileSync(file, makePdf([paragraph(72, 100, ["First page text that is long enough to count."]), paragraph(72, 100, ["Second page."])]))
    await call("library.attachPdf", { id: "doi-10.9999-t", path: file })
    const task = workspace.tasks.list().find((t) => t.kind === "paper.text" && t.subject === "doi-10.9999-t")!
    expect((await workspace.tasks.wait(task.id)).state).toBe("done")
    const text = await call("library.text", { id: "doi-10.9999-t" })
    expect(text.pages.map((p: { blocks: { lines: { text: string }[] }[] }) => p.blocks[0].lines[0].text)).toEqual([
      "First page text that is long enough to count.",
      "Second page.",
    ])
    const md = readFileSync(path.join(root, "library/papers/doi-10.9999-t/text.md"), "utf8")
    expect(md).toBe("<!-- page 1 -->\n\nFirst page text that is long enough to count.\n\n<!-- page 2 -->\n\nSecond page.\n")
    // Nothing changed: running again reads nothing
    const again = await workspace.tasks.run("paper.text", "doi-10.9999-t")
    expect(again.state).toBe("done")
  })

  it("finds a citation's sentence in the text, across a line break, by any id of the paper", async () => {
    const { root, call } = await setup()
    await call("library.add", { paper: { id: "doi-10.9999-q", title: "Q", authors: [], ids: { doi: "10.9999/q" } } })
    expect(await call("library.findPassage", { id: "doi-10.9999-q", quote: "anything" })).toBeNull()
    writeFileSync(path.join(root, "library/papers/doi-10.9999-q/text.md"), "<!-- page 1 -->\n\nIntro.\n\n<!-- page 2 -->\n\nDecoding reduces exact\nmatch by 2.1 points.\n")
    expect(await call("library.findPassage", { id: "doi-10.9999-q", quote: "Decoding reduces exact match by 2.1 points." })).toEqual({ page: 2 })
    expect(await call("library.findPassage", { id: "doi-10.9999-q", quote: "Decoding removes the need for retrieval." })).toBeNull()
  })

  it("has nothing to do for a paper without a PDF", async () => {
    const { root, workspace, call } = await setup()
    await call("library.add", { paper: { id: "doi-10.9999-none", title: "None", authors: [], ids: { doi: "10.9999/none" } } })
    const done = await workspace.tasks.run("paper.text", "doi-10.9999-none")
    expect(done.state).toBe("done")
    expect(existsSync(path.join(root, "library/papers/doi-10.9999-none/text.json"))).toBe(false)
  })

  it("leaves MinerU's text alone", async () => {
    const { base, root, call, workspace } = await setup()
    await call("library.add", { paper: { id: "doi-10.9999-m", title: "M", authors: [], ids: { doi: "10.9999/m" } } })
    writeFileSync(path.join(base, "m.pdf"), makePdf([paragraph(72, 100, ["pdfium would say this"])]))
    await call("library.attachPdf", { id: "doi-10.9999-m", path: path.join(base, "m.pdf") })
    await workspace.tasks.run("paper.text", "doi-10.9999-m")
    // MinerU read this PDF since
    const mineru = { version: 1, source: "mineru", pages: [] }
    writeFileSync(path.join(root, "library/papers/doi-10.9999-m/text.json"), JSON.stringify(mineru))
    await workspace.tasks.run("paper.text", "doi-10.9999-m")
    expect(JSON.parse(readFileSync(path.join(root, "library/papers/doi-10.9999-m/text.json"), "utf8"))).toEqual(mineru)
  })

  it("reads a PDF that replaces one MinerU read", async () => {
    const { base, root, call, workspace } = await setup()
    await call("library.add", { paper: { id: "doi-10.9999-r", title: "R", authors: [], ids: { doi: "10.9999/r" } } })
    writeFileSync(path.join(root, "library/papers/doi-10.9999-r/text.json"), JSON.stringify({ version: 1, source: "mineru", pages: [] }))
    writeFileSync(path.join(base, "r.pdf"), makePdf([paragraph(72, 100, ["the right paper"])]))
    await call("library.attachPdf", { id: "doi-10.9999-r", path: path.join(base, "r.pdf") })
    await workspace.tasks.run("paper.text", "doi-10.9999-r")
    expect(readFileSync(path.join(root, "library/papers/doi-10.9999-r/text.md"), "utf8")).toContain("the right paper")
  })
})
