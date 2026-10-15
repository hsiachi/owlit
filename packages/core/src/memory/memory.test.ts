import { MEMORY_MAX_LINES, type MemoryLine } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Versions } from "../docs/versions.ts"
import { claudeNoteOf, formatMemory, Memory, parseMemory } from "./memory.ts"

function setUp() {
  const root = mkdtempSync(path.join(tmpdir(), "owlit-memory-"))
  const owlit = path.join(root, ".owlit")
  mkdirSync(owlit)
  const versions = new Versions(owlit)
  const heard: MemoryLine[][] = []
  const memory = new Memory(owlit, root, versions, (lines) => heard.push(lines))
  return { root, owlit, versions, memory, heard, file: path.join(owlit, "memory.md") }
}

const configDir = process.env.CLAUDE_CONFIG_DIR
afterEach(() => {
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = configDir
})

describe("Memory", () => {
  it("reads back what it writes, and numbers bullets written by hand", () => {
    const lines: MemoryLine[] = [
      { id: "m1", kind: "work", text: "Cite as (Author, Year).", at: Date.parse("2026-10-16T12:00:00"), chatId: "c1" },
      { id: "m4", kind: "about", text: "I own P5 in Infera.", at: Date.parse("2026-10-15T12:00:00") },
    ]
    const text = formatMemory(lines)
    expect(text).toContain("- Cite as (Author, Year). <!-- m1 · 2026-10-16 · chat c1 -->")
    expect(parseMemory(text)).toEqual(lines)
    // Added in another editor: no comment, so the next id after the highest
    const edited = text.replace("## About your work\n\n", "## About your work\n\n* My advisor is Prof. Li\n")
    expect(parseMemory(edited).find((l) => l.text === "My advisor is Prof. Li")).toMatchObject({ id: "m5", kind: "about", at: 0 })
  })

  it("adds, replaces and removes for an agent, each change undone by its version", async () => {
    const { memory, versions, heard, file } = setUp()
    const added = await memory.agentWrite({ op: "add", kind: "work", text: "Answer  in Chinese." }, { chatId: "c1" })
    expect(added.line).toMatchObject({ id: "m1", kind: "work", text: "Answer in Chinese.", chatId: "c1" })
    expect(added.before).toBeNull()
    // The same line again is not a second line
    expect((await memory.agentWrite({ op: "add", kind: "work", text: "answer in chinese" })).versionId).toBeUndefined()

    const replaced = await memory.agentWrite({ op: "replace", id: "m1", text: "Answer in the language I write in." }, { chatId: "c2" })
    expect(replaced.before?.text).toBe("Answer in Chinese.")
    expect(readFileSync(file, "utf8")).toContain("- Answer in the language I write in. <!-- m1 ·")

    // Undo puts the old line back, and the undo can be undone
    const v = await versions.get(replaced.versionId!)
    const { redoId } = await memory.restoreVersion("m1", v!.content, v!.after, false, {})
    expect((await memory.list())[0].text).toBe("Answer in Chinese.")
    const redo = await versions.get(redoId)
    await memory.restoreVersion("m1", redo!.content, redo!.after, false, {})
    expect((await memory.list())[0].text).toBe("Answer in the language I write in.")

    const removed = await memory.agentWrite({ op: "remove", id: "m1" })
    expect(removed.line).toBeNull()
    expect(await memory.list()).toEqual([])
    const r = await versions.get(removed.versionId!)
    await memory.restoreVersion("m1", r!.content, r!.after, false, {})
    expect(await memory.list()).toMatchObject([{ id: "m1", text: "Answer in the language I write in." }])
    expect(heard.length).toBeGreaterThan(4)
  })

  it("leaves a line the user changed since alone", async () => {
    const { memory, versions } = setUp()
    const { versionId } = await memory.agentWrite({ op: "add", kind: "about", text: "I study proactive agents." })
    await memory.put({ id: "m1", kind: "about", text: "I study proactive agents for ADHD." })
    const v = await versions.get(versionId!)
    await expect(memory.restoreVersion("m1", v!.content, v!.after, false, {})).rejects.toThrow(/changed after Owlit wrote it/)
  })

  it("tells the agent what went wrong in words it can act on", async () => {
    const { memory } = setUp()
    await expect(memory.agentWrite({ op: "replace", id: "m9", text: "x" })).rejects.toThrow(/no line m9/)
    await expect(memory.agentWrite({ op: "add", kind: "work", text: "x".repeat(400) })).rejects.toThrow(/one short sentence/)
    for (let i = 0; i < MEMORY_MAX_LINES; i++) await memory.put({ kind: "about", text: `Fact ${i}` })
    await expect(memory.agentWrite({ op: "add", kind: "about", text: "One more" })).rejects.toThrow(/full/)
  })

  it("puts a removed line back where Settings undoes it, under its own id", async () => {
    const { memory } = setUp()
    await memory.put({ kind: "work", text: "Short answers." })
    await memory.put({ kind: "work", text: "No emoji." })
    const [first] = await memory.list()
    await memory.remove(first.id)
    await memory.put(first)
    expect((await memory.list()).map((l) => l.id).sort()).toEqual(["m1", "m2"])
  })

  it("offers Claude Code's notes for this folder until each is kept or dropped", async () => {
    const { root, memory } = setUp()
    const config = mkdtempSync(path.join(tmpdir(), "owlit-claude-"))
    process.env.CLAUDE_CONFIG_DIR = config
    const dir = path.join(config, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"), "memory")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "MEMORY.md"), "- [a](a.md) — index\n")
    writeFileSync(path.join(dir, "docs.md"), '---\nname: docs\ndescription: "Discuss docs in chat; edit only when asked"\nmetadata:\n  type: feedback\n---\n\nLong body.\n')
    writeFileSync(path.join(dir, "p5.md"), "---\nname: p5\ndescription: I own P5 in Infera\nmetadata:\n  type: project\n---\n\nBody.\n")

    expect(await memory.claudeNotes()).toEqual([
      { file: "docs.md", kind: "work", text: "Discuss docs in chat; edit only when asked" },
      { file: "p5.md", kind: "about", text: "I own P5 in Infera" },
    ])
    const lines = await memory.decideClaudeNotes([{ file: "p5.md", kind: "about", text: "I own P5 in the Infera project" }], ["docs.md"])
    expect(lines).toMatchObject([{ id: "m1", kind: "about", text: "I own P5 in the Infera project" }])
    expect(await memory.claudeNotes()).toEqual([])
  })

  it("reads a Claude Code note without front matter by its first paragraph", () => {
    expect(claudeNoteOf("x.md", "Prefers APA.\n\nMore.")).toEqual({ file: "x.md", kind: "about", text: "Prefers APA." })
    expect(claudeNoteOf("y.md", "")).toBeNull()
  })
})
