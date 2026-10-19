import { MEMORY_MAX_LINES, type Change, type MemoryLine } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ChangeLog } from "../changes/log.ts"
import { Recorder } from "../changes/record.ts"
import { claudeNoteOf, formatMemory, Memory, parseMemory } from "./memory.ts"

function setUp() {
  const root = mkdtempSync(path.join(tmpdir(), "owlit-memory-"))
  const owlit = path.join(root, ".owlit")
  mkdirSync(owlit)
  const changes = new ChangeLog(owlit)
  const heard: MemoryLine[][] = []
  const memory = new Memory(owlit, root, new Recorder(changes, { profile: async () => ({ id: "1234abcd" }) }), (lines) => heard.push(lines))
  return { root, owlit, changes, memory, heard, file: path.join(owlit, "memory.md") }
}

const chat = (chatId: string) => ({ kind: "socket" as const, chatId })
const window = { kind: "window" as const }

// What changes/undo.ts does with a memory line's entry
const undo = (memory: Memory, e: Change) => memory.setLine(e.target.part!, (e.before as MemoryLine | undefined) ?? null, (e.after as MemoryLine | undefined) ?? null, window, { undoes: e.id })

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

  it("adds, replaces and removes for an agent, each change undone through the log", async () => {
    const { memory, changes, heard, file } = setUp()
    const added = await memory.agentWrite({ op: "add", kind: "work", text: "Answer  in Chinese." }, chat("c1"))
    expect(added.line).toMatchObject({ id: "m1", kind: "work", text: "Answer in Chinese.", chatId: "c1" })
    expect(added.before).toBeNull()
    // The same line again is not a second line
    expect((await memory.agentWrite({ op: "add", kind: "work", text: "answer in chinese" }, chat("c1"))).changeId).toBeUndefined()

    const replaced = await memory.agentWrite({ op: "replace", id: "m1", text: "Answer in the language I write in." }, chat("c2"))
    expect(replaced.before?.text).toBe("Answer in Chinese.")
    expect(readFileSync(file, "utf8")).toContain("- Answer in the language I write in. <!-- m1 ·")
    const entry = (await changes.get(replaced.changeId!))!
    expect(entry).toMatchObject({ actor: "o_1234abcd", action: "update", target: { kind: "memory", path: "memory", part: "m1" }, origin: { via: "tool", chatId: "c2" } })
    expect(entry.before).toMatchObject({ text: "Answer in Chinese." })

    // Undo puts the old line back, and the undo can be undone
    const undone = await undo(memory, entry)
    expect(undone).toMatchObject({ actor: "p_1234abcd", undoes: entry.id })
    expect((await memory.list())[0].text).toBe("Answer in Chinese.")
    await undo(memory, undone)
    expect((await memory.list())[0].text).toBe("Answer in the language I write in.")

    const removed = await memory.agentWrite({ op: "remove", id: "m1" }, chat("c2"))
    expect(removed.line).toBeNull()
    expect(await memory.list()).toEqual([])
    await undo(memory, (await changes.get(removed.changeId!))!)
    expect(await memory.list()).toMatchObject([{ id: "m1", text: "Answer in the language I write in." }])
    expect(heard.length).toBeGreaterThan(4)
  })

  it("leaves a line the user changed since alone", async () => {
    const { memory, changes } = setUp()
    const { changeId } = await memory.agentWrite({ op: "add", kind: "about", text: "I study proactive agents." }, chat("c1"))
    await memory.put({ id: "m1", kind: "about", text: "I study proactive agents for ADHD." }, window)
    await expect(undo(memory, (await changes.get(changeId!))!)).rejects.toThrow(/changed since/)
  })

  it("tells the agent what went wrong in words it can act on", async () => {
    const { memory } = setUp()
    await expect(memory.agentWrite({ op: "replace", id: "m9", text: "x" }, chat("c1"))).rejects.toThrow(/no line m9/)
    await expect(memory.agentWrite({ op: "add", kind: "work", text: "x".repeat(400) }, chat("c1"))).rejects.toThrow(/one short sentence/)
    for (let i = 0; i < MEMORY_MAX_LINES; i++) await memory.put({ kind: "about", text: `Fact ${i}` }, window)
    await expect(memory.agentWrite({ op: "add", kind: "about", text: "One more" }, chat("c1"))).rejects.toThrow(/full/)
  })

  it("puts a removed line back where Settings undoes it, under its own id", async () => {
    const { memory } = setUp()
    await memory.put({ kind: "work", text: "Short answers." }, window)
    await memory.put({ kind: "work", text: "No emoji." }, window)
    const [first] = await memory.list()
    await memory.remove(first.id, window)
    await memory.put(first, window)
    expect((await memory.list()).map((l) => l.id).sort()).toEqual(["m1", "m2"])
  })

  it("records the user's own lines from Settings: added, edited, removed, each with both sides", async () => {
    const { memory, changes } = setUp()
    await memory.put({ kind: "work", text: "Short answers." }, window)
    await memory.put({ id: "m1", kind: "work", text: "Short answers, in English." }, window)
    // The same line again changes nothing
    await memory.put({ id: "m1", kind: "work", text: "Short answers, in English." }, window)
    await memory.remove("m1", window)
    const all = (await changes.list({ target: { kind: "memory" } })).reverse()
    expect(all.map((c) => [c.action, c.target.part, c.actor, c.origin.via])).toEqual([
      ["create", "m1", "p_1234abcd", "editor"],
      ["update", "m1", "p_1234abcd", "editor"],
      ["delete", "m1", "p_1234abcd", "editor"],
    ])
    expect(all[1]).toMatchObject({ before: { text: "Short answers." }, after: { text: "Short answers, in English." } })
    expect(all[2]).toMatchObject({ before: { text: "Short answers, in English." } })
    expect(all[2]!.after).toBeUndefined()
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
    const lines = await memory.decideClaudeNotes([{ file: "p5.md", kind: "about", text: "I own P5 in the Infera project" }], ["docs.md"], window)
    expect(lines).toMatchObject([{ id: "m1", kind: "about", text: "I own P5 in the Infera project" }])
    expect(await memory.claudeNotes()).toEqual([])
  })

  it("reads a Claude Code note without front matter by its first paragraph", () => {
    expect(claudeNoteOf("x.md", "Prefers APA.\n\nMore.")).toEqual({ file: "x.md", kind: "about", text: "Prefers APA." })
    expect(claudeNoteOf("y.md", "")).toBeNull()
  })
})
