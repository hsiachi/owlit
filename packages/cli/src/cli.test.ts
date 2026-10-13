import { Core } from "@owlit/core"
import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { makePdf, paragraph } from "../../core/src/library/text/make-pdf.ts"
import { run } from "./cli.ts"

const MAIN = path.join(import.meta.dirname, "main.ts")
const fixtures = path.join(import.meta.dirname, "../../core/src/library/fixtures")

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

const pdf = makePdf([
  [{ x: 180, y: 120, size: 17, text: "Attention Is All You Need" }, ...paragraph(72, 200, ["Recurrent models dominate sequence transduction."])],
  [...paragraph(72, 100, ["Scaled dot-product attention."])],
  [...paragraph(72, 100, ["Training on eight GPUs."])],
  [...paragraph(72, 100, ["Results on WMT 2014."])],
])

// A core serving a workspace on its own socket, with arXiv answering from fixtures
async function setup(options: { open?: boolean } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-cli-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const dir = realpathSync(mkdtempSync("/tmp/owc-"))
  const routes: Record<string, string | Buffer> = {
    "export.arxiv.org": readFileSync(path.join(fixtures, "arxiv-1706.03762.xml"), "utf8"),
    "arxiv.org/pdf/1706.03762": pdf,
  }
  const fetch = (async (url: string) => {
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    return match ? new Response(typeof match[1] === "string" ? match[1] : new Uint8Array(match[1]), { headers: typeof match[1] === "string" ? {} : { "content-type": "application/pdf" } }) : new Response("", { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const core = new Core({ userDataDir: path.join(base, "userData"), socket: { dir }, host: { fetch }, retryBaseMs: 1 })
  cores.push(core)
  if (options.open !== false) await core.handle({ jsonrpc: "2.0", id: 1, method: "workspace.open", params: { path: root } })
  // owlit <args> in a folder: what it printed and how it exited
  const owlit = async (args: string[], cwd = root) => {
    let out = ""
    let err = ""
    const code = await run([...args, "--socket-dir", dir], { cwd, env: {}, out: (t) => (out += t), err: (t) => (err += t) })
    return { code, out, err }
  }
  return { root, dir, owlit }
}

describe("owlit", () => {
  it("adds a paper, follows its tasks and reads two of its pages", async () => {
    const { owlit } = await setup()
    const added = await owlit(["add", "1706.03762", "--json"])
    expect(added.code).toBe(0)
    const [result] = JSON.parse(added.out)
    expect(result).toMatchObject({ ref: "1706.03762", id: "arxiv-1706.03762", title: "Attention Is All You Need", existed: false })
    expect(result.tasks.length).toBeGreaterThan(0)

    expect((await owlit(["list"])).out).toBe("arxiv-1706.03762  2017  Attention Is All You Need\n")
    expect((await owlit(["add", "1706.03762"])).out).toBe("Already in the library: arxiv-1706.03762 · Attention Is All You Need\n")

    // Every task the addition queued finishes, and owlit tasks says so
    for (;;) {
      const tasks = JSON.parse((await owlit(["tasks", "--json"])).out) as { id: string; state: string }[]
      const mine = tasks.filter((t) => result.tasks.includes(t.id))
      if (mine.length === result.tasks.length && mine.every((t) => t.state === "done")) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect((await owlit(["tasks"])).out).toMatch(/^done\s+paper\.\w+\s+arxiv-1706\.03762/m)

    for (;;) {
      if ((await owlit(["read", "arxiv-1706.03762"])).code === 0) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect((await owlit(["index", "rebuild"])).out).toBe("The search index is rebuilt: 1 paper, 0 docs, 0 chats.\n")
    expect((await owlit(["search", "dot-product"])).out).toMatch(/^arxiv-1706\.03762 · Attention Is All You Need\n/)
    const read = await owlit(["read", "arxiv-1706.03762", "--pages", "3-4"])
    expect(read).toMatchObject({ code: 0, err: "" })
    expect(read.out).toMatch(/^<!-- page 3 -->\n\nTraining on eight GPUs\.\n\n<!-- page 4 -->\n\nResults on WMT 2014\.\n$/)
  })

  it("finds the workspace from a folder inside it, and says which refs the library knows", async () => {
    const { root, owlit } = await setup()
    await owlit(["add", "1706.03762"])
    const inside = path.join(root, "drafts/chapter-1")
    mkdirSync(inside, { recursive: true })
    expect(await owlit(["known", "10.1/none", "arXiv:1706.03762"], inside)).toMatchObject({ code: 0, out: "10.1/none         -\narXiv:1706.03762  arxiv-1706.03762\n" })
    expect(JSON.parse((await owlit(["known", "1706.03762", "--json"], inside)).out)).toEqual([{ ref: "1706.03762", id: "arxiv-1706.03762" }])
  })

  it("says when owlit isn't open with the workspace, and how to open it", async () => {
    const { root, owlit } = await setup({ open: false })
    mkdirSync(path.join(root, ".owlit"))
    expect(await owlit(["list"])).toEqual({ code: 3, out: "", err: `owlit isn't open with ws. Run "owlit open" to open it.\n` })
    expect(await owlit(["list"], tmpdir())).toMatchObject({ code: 2, err: /isn't in an owlit workspace/ })
  })

  it("imports a BibTeX file and follows it to the end", async () => {
    const { root, owlit } = await setup()
    writeFileSync(path.join(root, "refs.bib"), "@article{v, title = {Attention Is All You Need}, eprint = {1706.03762}, archivePrefix = {arXiv}}\n@misc{x}\n")
    const result = await owlit(["import", "bibtex", "refs.bib"])
    expect(result).toMatchObject({ code: 0, err: expect.stringMatching(/Importing|Reading/) })
    expect(result.out).toMatch(/^1 added · 0 already there · 1 couldn't be added\n  x: It has no title, identifier or PDF\.\nPDFs and text arrive by themselves/)
    const again = JSON.parse((await owlit(["import", "bibtex", "refs.bib", "--json"])).out)
    expect(again).toMatchObject({ source: "bibtex", added: [], existed: 1 })
    expect(await owlit(["import", "endnote", "refs.enl"])).toMatchObject({ code: 2, err: /^owlit import takes zotero, bibtex or folder/ })
  })

  it("explains a wrong command", async () => {
    const { owlit } = await setup()
    expect(await owlit(["fetch"])).toMatchObject({ code: 2, err: "There is no command fetch.\nRun owlit --help for the commands.\n" })
    expect(await owlit(["add"])).toMatchObject({ code: 2, err: /^owlit add needs at least one ref/ })
    expect(await owlit(["read", "x", "--note", "--pages", "2"])).toMatchObject({ code: 2, err: /^--pages and --section are for the text/ })
    expect(await owlit(["read", "doi-10.1-nope"])).toMatchObject({ code: 1, err: "That paper is not in the library.\n" })
    expect(await owlit(["--bogus"])).toMatchObject({ code: 2 })
    expect((await owlit(["--help"])).out).toMatch(/^owlit: the owlit app from Terminal/)
  })

  it("runs as a command", async () => {
    const { root, dir } = await setup()
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = execFile(process.execPath, [MAIN, "list", "--json", "--socket-dir", dir], { cwd: root }, (_error, stdout) => resolve({ code: child.exitCode, stdout }))
    })
    expect(result).toEqual({ code: 0, stdout: "[]\n" })
  })
})
