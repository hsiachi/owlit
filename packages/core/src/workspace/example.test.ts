import { MENTION_LINK, parseOwlitUri, type Thread, type ThreadSummary, type Paper } from "@owlit/protocol"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { copyExample } from "./example.ts"

// The example workspace the desktop app ships, as a first launch copies it
const SHIPPED = path.resolve(import.meta.dirname, "../../../../apps/desktop/resources/example-workspace")

async function source() {
  const dir = await mkdtemp(path.join(tmpdir(), "owlit-example-src-"))
  await mkdir(path.join(dir, ".owlit", "papers", "p1"), { recursive: true })
  await writeFile(path.join(dir, ".owlit", "workspace.json"), JSON.stringify({ version: 1, layout: {} }))
  await writeFile(path.join(dir, ".owlit", "papers", "p1", "state.json"), JSON.stringify({ addedAt: 1_760_000_000_000, status: "read", page: 3 }))
  await writeFile(path.join(dir, ".owlit", "papers", "p1", "highlights.jsonl"), JSON.stringify({ createdAt: 1_760_000_500_000, page: 2 }) + "\n")
  await mkdir(path.join(dir, ".owlit", "threads", "c1"), { recursive: true })
  await writeFile(path.join(dir, ".owlit", "threads", "c1", "thread.json"), JSON.stringify({ seenAt: 1_760_000_100_000, changedAt: { "memo:s1": 1_760_000_100_000 } }))
  await writeFile(path.join(dir, "Draft.md"), "# Draft\n")
  return dir
}

describe("copyExample", () => {
  it("copies the example into the parent and moves its latest time to an hour before now", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "owlit-example-dst-"))
    const now = 1_800_000_000_000
    const folder = await copyExample(await source(), parent, now)
    expect(folder).toBe(path.join(parent, "Owlit Example"))
    const state = JSON.parse(await readFile(path.join(folder, ".owlit", "papers", "p1", "state.json"), "utf8"))
    const highlight = JSON.parse((await readFile(path.join(folder, ".owlit", "papers", "p1", "highlights.jsonl"), "utf8")).trim())
    expect(highlight.createdAt).toBe(now - 3_600_000)
    expect(state.addedAt).toBe(now - 3_600_000 - 500_000)
    // Not a time: left alone
    expect(state.page).toBe(3)
    // A map of times moves with the rest
    const thread = JSON.parse(await readFile(path.join(folder, ".owlit", "threads", "c1", "thread.json"), "utf8"))
    expect(thread.changedAt["memo:s1"]).toBe(thread.seenAt)
    expect(thread.seenAt).toBe(now - 3_600_000 - 400_000)
    expect((await stat(path.join(folder, "Draft.md"))).mtimeMs).toBeLessThanOrEqual(now)
  })

  it("opens an earlier copy again rather than making a second", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "owlit-example-dst-"))
    const src = await source()
    const first = await copyExample(src, parent)
    expect(await copyExample(src, parent)).toBe(first)
    expect(existsSync(path.join(parent, "Owlit Example 2"))).toBe(false)
  })

  it("leaves a folder of the same name that isn't a workspace alone", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "owlit-example-dst-"))
    await mkdir(path.join(parent, "Owlit Example"))
    expect(await copyExample(await source(), parent)).toBe(path.join(parent, "Owlit Example 2"))
  })
})

describe("the shipped example workspace", () => {
  it("opens with its threads, every paper they name in the library or the thread", async () => {
    const parent = realpathSync(await mkdtemp(path.join(tmpdir(), "owlit-example-dst-")))
    const folder = await copyExample(SHIPPED, parent)
    const core = new Core({ userDataDir: path.join(parent, "userData") })
    try {
      const call = async <T>(method: string, params?: unknown) => {
        const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
        if ("error" in response) throw new Error(response.error.message)
        return response.result as T
      }
      await call("workspace.open", { path: folder })
      const list = await call<ThreadSummary[]>("threads.list")
      expect(list.length).toBeGreaterThanOrEqual(2)
      const { papers, aliases } = await call<{ papers: Paper[]; aliases: Record<string, string> }>("library.list")
      const inLibrary = (id: string) => papers.some((p) => p.id === id) || !!aliases[id]
      for (const summary of list) {
        const c = await call<Thread>("threads.get", { id: summary.id })
        expect(c.rows.length).toBeGreaterThan(0)
        // Times moved with the copy: nothing in it is from the future
        expect(c.updatedAt).toBeLessThanOrEqual(Date.now())
        for (const s of c.memo) {
          for (const m of s.text.matchAll(new RegExp(MENTION_LINK.source, "g"))) {
            const u = parseOwlitUri(m[2]!)
            if (u?.kind === "paper") expect(inLibrary(u.id) || c.rows.some((r) => r.id === u.id), `${summary.id}: ${m[0]}`).toBe(true)
          }
        }
        for (const r of c.rows) if (r.cells.q?.depth === "full") expect(r.cells.q.passage?.page, `${summary.id}: ${r.id}`).toBeGreaterThan(0)
      }
    } finally {
      await core.dispose()
    }
  })
})
