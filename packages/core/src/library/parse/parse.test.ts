import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../../core.ts"
import { until } from "../../test-util.ts"
import type { Workspace } from "../../workspace/workspace.ts"
import { makePdf, paragraph } from "../text/make-pdf.ts"
import { toMarkdown } from "../text/extract.ts"
import { contentListToText, type ContentBlock } from "./convert.ts"
import { unzip } from "./unzip.ts"

// A zip with stored entries (what unzip must read; MinerU's are deflated, which node's zlib handles)
function zipOf(files: Record<string, string | Buffer>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text)
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const contentList: ContentBlock[] = [
  { type: "text", text: "Awareness in Shared Workspaces", text_level: 1, bbox: [80, 28, 800, 57], page_idx: 0 },
  { type: "text", text: "Groups coordinate through what they can see of each other.", bbox: [80, 100, 480, 160], page_idx: 0 },
  { type: "equation", text: "$$a = b + c$$", bbox: [100, 200, 400, 220], page_idx: 0 },
  { type: "table", table_caption: ["Table 1: Results"], table_body: "<table><tr><td>A</td><td>1</td></tr><tr><td>B &amp; C</td><td>2</td></tr></table>", bbox: [80, 300, 900, 400], page_idx: 0 },
  { type: "ref_text", text: "[1] Dourish, P. and Bellotti, V. 1992. Awareness and coordination.", bbox: [80, 800, 900, 830], page_idx: 0 },
  { type: "page_number", text: "1", bbox: [490, 960, 510, 975], page_idx: 0 },
]

// MinerU's layout for the same page: Figure 1 in two panels (its caption under the right one), Figure 2
// a chart kept whole, and Table 1
const span = (content: string) => ({ lines: [{ spans: [{ type: "text", content }] }] })
const picture = (image_path: string) => ({ lines: [{ spans: [{ type: "image", image_path }] }] })
const layout = {
  pdf_info: [
    {
      page_idx: 0,
      page_size: [612, 792],
      para_blocks: [
        { type: "image", bbox: [72, 420, 290, 560], blocks: [{ type: "image_body", bbox: [72, 420, 290, 560], ...picture("images/left.jpg") }] },
        {
          type: "image",
          bbox: [310, 420, 540, 590],
          blocks: [
            { type: "image_body", bbox: [310, 420, 540, 560], ...picture("images/right.jpg") },
            { type: "image_caption", bbox: [72, 570, 540, 590], ...span("Figure 1: Two panels of one figure.") },
          ],
        },
        {
          type: "chart",
          bbox: [72, 620, 300, 760],
          blocks: [
            { type: "chart_body", bbox: [72, 620, 300, 740], ...picture("images/chart.jpg") },
            { type: "chart_caption", bbox: [72, 745, 300, 760], ...span("Fig. 2. A chart.") },
          ],
        },
        {
          type: "table",
          bbox: [72, 240, 540, 320],
          blocks: [
            { type: "table_caption", bbox: [72, 240, 540, 255], ...span("Table 1: Results") },
            { type: "table_body", bbox: [72, 260, 540, 320], ...picture("images/table.jpg") },
          ],
        },
      ],
    },
  ],
}

describe("contentListToText", () => {
  it("turns MinerU's blocks into pages of blocks in points", () => {
    const text = contentListToText(contentList, [{ width: 612, height: 792 }])
    expect(text.source).toBe("mineru")
    expect(text.pages[0].blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "formula", "table", "paragraph", "other"])
    expect(text.pages[0].blocks[0].rect).toEqual({ x: 48.96, y: 22.18, w: 440.64, h: 22.97 })
    expect(text.pages[0].blocks[3].lines.map((l) => l.text)).toEqual(["Table 1: Results", "| A | 1 |", "| B & C | 2 |"])
  })

  it("keeps empty cells, pipes in cells, code lines and list items in text.md", () => {
    const blocks: ContentBlock[] = [
      { type: "table", table_body: "<table><tr><th></th><th>BLEU</th></tr><tr><td>P(y | x)</td><td></td></tr></table>", page_idx: 0 },
      { type: "code", code_caption: ["Listing 1"], code_body: "def f(x):\n    return x", page_idx: 0 },
      { type: "list", list_items: ["First item", "Second item"], page_idx: 0 },
    ]
    expect(toMarkdown(contentListToText(blocks, [{ width: 612, height: 792 }]))).toBe(
      ["<!-- page 1 -->", "|  | BLEU |\n| --- | --- |\n| P(y \\| x) |  |", "Listing 1", "```\ndef f(x):\n    return x\n```", "- First item\n- Second item"].join("\n\n") + "\n",
    )
  })
})

describe("unzip", () => {
  it("reads the files of a zip", () => {
    const files = unzip(zipOf({ "a/content_list.json": "[]", "a/full.md": "# Hi" }))
    expect([...files.keys()]).toEqual(["a/content_list.json", "a/full.md"])
    expect(files.get("a/full.md")!.toString()).toBe("# Hi")
  })
})

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

// A MinerU cloud that takes one file, runs for `polls` checks and then hands back a zip
function mineruCloud(options: { polls?: number; refuse?: boolean; hang?: boolean } = {}) {
  const asked: string[] = []
  let checks = 0
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`)
    if (url.endsWith("/api/v4/file-urls/batch")) {
      if (options.refuse) return Response.json({ code: "A0202", msg: "token is invalid" })
      return Response.json({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://oss.example.org/upload/batch-1"] } })
    }
    if (url.startsWith("https://oss.example.org/upload")) return new Response("")
    if (url.includes("/api/v4/extract-results/batch/batch-1")) {
      if (options.hang) return new Promise<Response>(() => {})
      checks++
      const done = checks > (options.polls ?? 1)
      return Response.json({
        code: 0,
        data: {
          extract_result: [
            done
              ? { state: "done", full_zip_url: "https://cdn.example.org/batch-1.zip" }
              : { state: "running", extract_progress: { extracted_pages: 1, total_pages: 2 } },
          ],
        },
      })
    }
    if (url === "https://cdn.example.org/batch-1.zip")
      return new Response(
        zipOf({
          "x/x_content_list.json": JSON.stringify(contentList),
          "x/full.md": "# x",
          "x/layout.json": JSON.stringify(layout),
          "x/images/left.jpg": Buffer.from("left panel"),
          "x/images/right.jpg": Buffer.from("right panel"),
          "x/images/chart.jpg": Buffer.from("a chart"),
          "x/images/table.jpg": Buffer.from("a table"),
        }),
      )
    return new Response("", { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

async function setup(fetch: typeof globalThis.fetch, parsing: object, dir?: { base: string; root: string }) {
  const base = dir?.base ?? realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-parse-")))
  const root = dir?.root ?? path.join(base, "ws")
  mkdirSync(root, { recursive: true })
  mkdirSync(path.join(base, "userData"), { recursive: true })
  writeFileSync(path.join(base, "userData/settings.json"), JSON.stringify({ version: 1, recentWorkspaces: [], parsing }))
  const core = new Core({ userDataDir: path.join(base, "userData"), host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const workspace = (core as unknown as { workspace: Workspace }).workspace
  return { base, root, call, core, workspace }
}

async function addWithPdf(call: (m: string, p?: unknown) => Promise<any>, base: string) {
  await call("library.add", { paper: { id: "doi-10.9-p", title: "P", authors: [], ids: { doi: "10.9/p" } } })
  writeFileSync(path.join(base, "p.pdf"), makePdf([paragraph(72, 100, ["pdfium's reading of the page."])]))
  await call("library.attachPdf", { id: "doi-10.9-p", path: path.join(base, "p.pdf") })
}

const settled = (workspace: Workspace, kind: string) =>
  until(
    () => {
      const task = workspace.tasks.list().find((t) => t.kind === kind && t.subject === "doi-10.9-p")
      return task && ["done", "failed", "cancelled"].includes(task.state) ? task : undefined
    },
    { what: `${kind} to finish` },
  )

describe("paper.parse", () => {
  it("sends the PDF to MinerU's cloud and replaces pdfium's text with its own", async () => {
    const cloud = mineruCloud({ polls: 1 })
    const { base, root, call, workspace } = await setup(cloud.fetch, { service: "cloud", token: "t" })
    await addWithPdf(call, base)
    await settled(workspace, "paper.text")
    // Polls are 5s apart in real use; this one finishes after one check
    const task = await settled(workspace, "paper.parse").catch(async () => workspace.tasks.run("paper.parse", "doi-10.9-p", "waiting"))
    expect(task.state).toBe("done")
    const dir = path.join(root, "library/papers/doi-10.9-p")
    expect(JSON.parse(readFileSync(path.join(dir, "text.json"), "utf8")).source).toBe("mineru")
    expect(JSON.parse(readFileSync(path.join(dir, "text.pdfium.json"), "utf8")).source).toBe("pdfium")
    expect(readFileSync(path.join(dir, "text.md"), "utf8")).toMatch(/## Awareness in Shared Workspaces[\s\S]*\$\$a = b \+ c\$\$[\s\S]*Table 1: Results\n\n\| A \| 1 \|\n\| --- \| --- \|\n\| B & C \| 2 \|/)
    expect(JSON.parse(readFileSync(path.join(dir, "parse.json"), "utf8"))).toMatchObject({ status: "done", service: "cloud", job: "batch-1" })
    expect((await call("library.list")).papers[0].text).toBe("full")
    expect(cloud.asked.filter((a) => a.startsWith("POST"))).toHaveLength(1)
    expect(cloud.asked).toContain("PUT https://oss.example.org/upload/batch-1")

    // The figures come with it: MinerU's own picture where it kept one whole, the PDF drawn again
    // where it cut one into panels
    const figures = await call("library.figures", { id: "doi-10.9-p" })
    expect(figures.map((f: { id: string; label: string; page: number }) => [f.id, f.label, f.page])).toEqual([
      ["table-1", "Table 1", 0],
      ["figure-1", "Figure 1", 0],
      ["figure-2", "Figure 2", 0],
    ])
    expect(figures[1].rect).toEqual({ x: 72, y: 420, w: 468, h: 140 })
    expect(figures[1].url).toBe("owlit-file://workspace/library/papers/doi-10.9-p/figures/figure-1.png")
    expect(readFileSync(path.join(dir, "figures/figure-1.png")).subarray(1, 4).toString()).toBe("PNG")
    expect(readFileSync(path.join(dir, "figures/figure-2.jpg"), "utf8")).toBe("a chart")
    expect(readFileSync(path.join(dir, "figures/table-1.jpg"), "utf8")).toBe("a table")
  }, 30_000)

  it("looks up the recorded job after a restart instead of submitting another", async () => {
    const hanging = mineruCloud({ hang: true })
    const first = await setup(hanging.fetch, { service: "cloud", token: "t" })
    await addWithPdf(first.call, first.base)
    await settled(first.workspace, "paper.text")
    await until(() => first.workspace.tasks.list().find((t) => t.kind === "paper.parse")?.external, { what: "the job recorded on the task" })
    expect(first.workspace.tasks.list().find((t) => t.kind === "paper.parse")?.external).toMatchObject({ service: "mineru", jobId: "batch-1" })
    await first.core.dispose()

    const resumed = mineruCloud({ polls: 0 })
    const second = await setup(resumed.fetch, { service: "cloud", token: "t" }, { base: first.base, root: first.root })
    const task = await settled(second.workspace, "paper.parse")
    expect(task.state).toBe("done")
    expect(resumed.asked.some((a) => a.startsWith("POST"))).toBe(false)
    expect(resumed.asked.some((a) => a.includes("extract-results/batch/batch-1"))).toBe(true)
  }, 30_000)

  it("records a refusal in parse.json and keeps pdfium's text", async () => {
    const cloud = mineruCloud({ refuse: true })
    const { base, root, call, workspace } = await setup(cloud.fetch, { service: "cloud", token: "bad" })
    await addWithPdf(call, base)
    const task = await settled(workspace, "paper.parse")
    expect(task).toMatchObject({ state: "failed", attempts: 1 })
    const dir = path.join(root, "library/papers/doi-10.9-p")
    expect(JSON.parse(readFileSync(path.join(dir, "parse.json"), "utf8"))).toMatchObject({ status: "failed", error: "MinerU said: token is invalid" })
    expect(JSON.parse(readFileSync(path.join(dir, "text.json"), "utf8")).source).toBe("pdfium")
    expect((await call("library.list")).papers[0].text).toBe("basic")
  })

  it("does nothing without a service set up", async () => {
    const cloud = mineruCloud()
    const { base, root, call, workspace } = await setup(cloud.fetch, {})
    await addWithPdf(call, base)
    expect((await settled(workspace, "paper.parse")).state).toBe("done")
    expect(cloud.asked.filter((a) => a.includes("mineru"))).toEqual([])
    expect(existsSync(path.join(root, "library/papers/doi-10.9-p/parse.json"))).toBe(false)
  })
})
