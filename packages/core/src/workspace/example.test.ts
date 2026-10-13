import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { copyExample } from "./example.ts"

async function source() {
  const dir = await mkdtemp(path.join(tmpdir(), "owlit-example-src-"))
  await mkdir(path.join(dir, ".owlit", "papers", "p1"), { recursive: true })
  await writeFile(path.join(dir, ".owlit", "workspace.json"), JSON.stringify({ version: 1, layout: {} }))
  await writeFile(path.join(dir, ".owlit", "papers", "p1", "state.json"), JSON.stringify({ addedAt: 1_760_000_000_000, status: "read", page: 3 }))
  await writeFile(path.join(dir, ".owlit", "papers", "p1", "highlights.jsonl"), JSON.stringify({ createdAt: 1_760_000_500_000, page: 2 }) + "\n")
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
