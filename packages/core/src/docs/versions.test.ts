import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { KEEP_MS, KEEP_PER_PATH, Versions } from "./versions.ts"

describe("Versions", () => {
  it("keeps the newest of each file and nothing older than the keep window", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-versions-"))
    const versions = new Versions(owlit)
    const old = await versions.saveFile("old.md", "long ago", "then")
    for (let i = 0; i < KEEP_PER_PATH + 5; i++) await versions.saveFile("a.md", `text ${i}`, `text ${i + 1}`, { chatId: "c1" })
    await versions.savePaper("arxiv-1706.03762", "added", { chatId: "c1" })
    // The first one, back-dated past the window
    const index = path.join(owlit, "versions/index.jsonl")
    writeFileSync(index, readFileSync(index, "utf8").replace(`"at":${old.at}`, `"at":${old.at - KEEP_MS - 1}`))

    expect(await versions.cleanup()).toBe(6)
    const left = await versions.list({ path: "a.md" })
    expect(left).toHaveLength(KEEP_PER_PATH)
    // The newest are the ones kept, with what they hold
    expect(left[0]).toMatchObject({ kind: "file", chatId: "c1", by: "agent" })
    expect((await versions.get(left[0].id))?.content).toBe(`text ${KEEP_PER_PATH + 4}`)
    expect(await versions.list({ path: "old.md" })).toEqual([])
    expect(await versions.list({ path: "arxiv-1706.03762" })).toMatchObject([{ kind: "paper", op: "added" }])
    // The dropped versions' files are gone too
    expect(readdirSync(path.join(owlit, "versions"))).toHaveLength(KEEP_PER_PATH + 1 + 1)
  })

  it("reads versions written before they had kinds as file versions", async () => {
    const owlit = mkdtempSync(path.join(tmpdir(), "owlit-versions-"))
    const dir = path.join(owlit, "versions")
    const versions = new Versions(owlit)
    await versions.saveFile("x.md", "x", "y")
    writeFileSync(path.join(dir, "1-a.md"), "before")
    writeFileSync(path.join(dir, "index.jsonl"), readFileSync(path.join(dir, "index.jsonl"), "utf8") + JSON.stringify({ id: "1-a.md", path: "a.md", at: Date.now(), existed: true, after: "abc" }) + "\n")
    expect(await versions.get("1-a.md")).toMatchObject({ kind: "file", by: "agent", content: "before" })
  })
})
