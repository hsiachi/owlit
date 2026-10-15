import { t } from "@lingui/core/macro"
import { MEMORY_MAX_CHARS, MEMORY_MAX_LINES, RpcErrorCode, type ClaudeNote, type MemoryKind, type MemoryLine } from "@owlit/protocol"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { sha1, type Versions } from "../docs/versions.ts"
import { ignoreMissing, readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { Serial } from "../util.ts"

// Owlit's memory of the user, one per workspace, in .owlit/memory.md: how they want Owlit to work, and
// facts about their work that have no other home. The agents' own memories are off (profiles.ts), so
// this is the only one, the same whichever agent runs, and a plain file the user can read and edit in
// any editor. It is read again on every use rather than watched: it is small, and an edit made
// elsewhere is then in the next session without a watcher to miss it.
//
//   # What Owlit keeps in mind
//   ## How you like Owlit to work
//   - Cite as (Author, Year). <!-- m3 · 2026-10-16 · chat 8f2c… -->
//   ## About your work
//   - I own P5 in the Infera project. <!-- m4 · 2026-10-15 -->
//
// Only the bullets are kept: owlit writes the file whole, in this shape, on every change. A bullet
// written by hand has no comment yet and gets its id on the next write.

const FILE = "memory.md"
// Which Claude Code notes the user kept or dropped (the offer to copy them in)
const SIDECAR = "memory.json"

const HEADINGS: Record<MemoryKind, string> = { work: "How you like Owlit to work", about: "About your work" }
const HEADER = `# What Owlit keeps in mind

Owlit reads this list at the start of every chat in this workspace, whichever agent runs it. Edit it here or in Settings › Owlit; one bullet per line. Owlit adds to it when you tell it something worth keeping, and says so in the chat.
`

const COMMENT = /\s*<!--(.*?)-->\s*$/

export function parseMemory(text: string): MemoryLine[] {
  const lines: MemoryLine[] = []
  let kind: MemoryKind = "work"
  const loose: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^#{2,}\s+(.*)$/)
    if (heading) {
      kind = /about/i.test(heading[1]) ? "about" : "work"
      continue
    }
    const bullet = raw.match(/^\s*[-*+]\s+(.*)$/)
    if (!bullet) continue
    let body = bullet[1]
    let id: string | undefined
    let at = 0
    let chatId: string | undefined
    const comment = body.match(COMMENT)
    if (comment) {
      body = body.slice(0, comment.index)
      for (const part of comment[1].split("·").map((p) => p.trim())) {
        if (/^m\d+$/.test(part)) id = part
        else if (/^\d{4}-\d{2}-\d{2}$/.test(part)) at = Date.parse(`${part}T12:00:00`)
        else if (part.startsWith("chat ")) chatId = part.slice(5).trim() || undefined
      }
    }
    const text = body.trim()
    if (!text) continue
    if (!id || lines.some((l) => l.id === id)) loose.push(lines.length)
    lines.push({ id: id ?? "", kind, text, at, ...(chatId ? { chatId } : {}) })
  }
  // Bullets written by hand, or a copied id: numbered after the highest id there is
  for (const i of loose) lines[i] = { ...lines[i], id: nextId(lines) }
  return lines
}

function nextId(lines: MemoryLine[]) {
  const top = Math.max(0, ...lines.map((l) => Number(l.id.match(/^m(\d+)$/)?.[1] ?? 0)))
  return `m${top + 1}`
}

const day = (at: number) => new Date(at).toLocaleDateString("sv-SE")

export function formatMemory(lines: MemoryLine[]) {
  const section = (kind: MemoryKind) => {
    const mine = lines.filter((l) => l.kind === kind)
    const bullets = mine.map((l) => `- ${oneLine(l.text)} <!-- ${[l.id, ...(l.at ? [day(l.at)] : []), ...(l.chatId ? [`chat ${l.chatId}`] : [])].join(" · ")} -->`)
    return `## ${HEADINGS[kind]}\n\n${bullets.length ? bullets.join("\n") + "\n" : ""}`
  }
  return `${HEADER}\n${section("work")}\n${section("about")}`
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").replace(/<!--|-->/g, "").trim()

// The memory of a workspace by its folder, for work that has the folder but not the open Workspace
// (background runs started while it opens)
export async function readMemory(root: string) {
  const text = await readFile(path.join(root, ".owlit", FILE), "utf8").catch(() => "")
  return parseMemory(text)
}

export type MemoryOp = { op: "add"; kind: MemoryKind; text: string } | { op: "replace"; id: string; text: string; kind?: MemoryKind } | { op: "remove"; id: string }

export interface MemoryChange {
  // The line as it is now; null when it was removed
  line: MemoryLine | null
  before: MemoryLine | null
  versionId?: string
}

export class Memory {
  readonly file: string
  private readonly sidecar: string
  private readonly root: string
  private readonly versions: Versions
  private readonly changed: (lines: MemoryLine[]) => void
  private readonly serial = new Serial()

  constructor(owlitDir: string, root: string, versions: Versions, changed: (lines: MemoryLine[]) => void = () => undefined) {
    this.file = path.join(owlitDir, FILE)
    this.sidecar = path.join(owlitDir, SIDECAR)
    this.root = root
    this.versions = versions
    this.changed = changed
  }

  async list(): Promise<MemoryLine[]> {
    const text = await readFile(this.file, "utf8").catch((error) => {
      ignoreMissing(error)
      return ""
    })
    return parseMemory(text)
  }

  // An agent's change (owlit-mcp's memory_write). What it sends back is said to the agent, so it is plain
  // English and says how to do better when the change can't be made. Each change is kept as a version, so
  // the chat's result row can undo it.
  agentWrite(op: MemoryOp, meta: { chatId?: string } = {}): Promise<MemoryChange> {
    return this.serial.run(async () => {
      const lines = await this.list()
      const now = Date.now()
      let change: MemoryChange
      if (op.op === "add") {
        const text = checked(op.text)
        const same = lines.find((l) => sameText(l.text, text))
        if (same) return { line: same, before: same }
        if (lines.length >= MEMORY_MAX_LINES) {
          throw new RpcFailure(RpcErrorCode.InvalidParams, `The memory is full (${MEMORY_MAX_LINES} lines). Replace or merge lines instead of adding one.`)
        }
        const line: MemoryLine = { id: nextId(lines), kind: op.kind, text, at: now, ...(meta.chatId ? { chatId: meta.chatId } : {}) }
        lines.push(line)
        change = { line, before: null }
      } else {
        const i = lines.findIndex((l) => l.id === op.id)
        if (i < 0) throw new RpcFailure(RpcErrorCode.NotFound, `There is no line ${op.id} in the memory; it may have been removed. The list as it is now is in this session's last [owlit] memory note.`)
        const before = lines[i]
        if (op.op === "remove") {
          lines.splice(i, 1)
          change = { line: null, before }
        } else {
          const line: MemoryLine = { ...before, kind: op.kind ?? before.kind, text: checked(op.text), at: now, ...(meta.chatId ? { chatId: meta.chatId } : {}) }
          lines[i] = line
          change = { line, before }
        }
      }
      const version = await this.versions.saveMemory(change.line?.id ?? change.before!.id, change.before, change.line?.text ?? null, meta)
      await this.save(lines)
      return { ...change, versionId: version.id }
    })
  }

  // The user's own change, from Settings: a new line (no id), a line edited, or a removed one put back
  put(input: { id?: string; kind: MemoryKind; text: string; at?: number; chatId?: string }): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const lines = await this.list()
      const text = oneLine(input.text)
      if (!text) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Write something to keep first.`)
      const i = input.id ? lines.findIndex((l) => l.id === input.id) : -1
      if (i >= 0) {
        lines[i] = { ...lines[i], kind: input.kind, text, at: lines[i].text === text ? lines[i].at : Date.now() }
      } else {
        // A line removed a moment ago comes back as it was, under its own id
        lines.push({ id: input.id ?? nextId(lines), kind: input.kind, text, at: input.at ?? Date.now(), ...(input.chatId ? { chatId: input.chatId } : {}) })
      }
      await this.save(lines)
      return lines
    })
  }

  remove(id: string): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const lines = (await this.list()).filter((l) => l.id !== id)
      await this.save(lines)
      return lines
    })
  }

  // Undo of an agent's change (versions.restore): the line goes back to what it was before, wherever it
  // is now in the list. What it replaces is kept as a version too, so the undo can be undone. A line the
  // user changed since is left alone unless forced.
  restoreVersion(id: string, content: string, after: string | undefined, force: boolean, meta: { chatId?: string }) {
    return this.serial.run(async () => {
      const lines = await this.list()
      const i = lines.findIndex((l) => l.id === id)
      const now = i >= 0 ? lines[i] : null
      if (!force && after !== undefined && sha1(now?.text ?? "") !== after) {
        throw new RpcFailure(RpcErrorCode.Conflict, t`That line changed after Owlit wrote it, so owlit left it as it is.`, { id })
      }
      const before = JSON.parse(content) as { before: MemoryLine | null }
      const redo = await this.versions.saveMemory(id, now, before.before?.text ?? null, { ...meta, by: "undo" })
      if (before.before && i >= 0) lines[i] = before.before
      else if (before.before) lines.push(before.before)
      else if (i >= 0) lines.splice(i, 1)
      await this.save(lines)
      return { redoId: redo.id }
    })
  }

  // ---- What Claude Code kept for this folder before

  // The notes in Claude Code's memory folder for this workspace that the user hasn't kept or dropped yet.
  // Claude Code names the folder after the path, every character but letters and digits made "-".
  async claudeNotes(): Promise<ClaudeNote[]> {
    const config = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude")
    const dir = path.join(config, "projects", this.root.replace(/[^a-zA-Z0-9]/g, "-"), "memory")
    const names = await readdir(dir).catch(() => [] as string[])
    const decided = (await readJson<{ claudeCode?: Record<string, string> }>(this.sidecar).catch(() => undefined))?.claudeCode ?? {}
    const notes: ClaudeNote[] = []
    for (const file of names.sort()) {
      if (!file.endsWith(".md") || file === "MEMORY.md" || decided[file]) continue
      const note = claudeNoteOf(file, await readFile(path.join(dir, file), "utf8").catch(() => ""))
      if (note) notes.push(note)
    }
    return notes
  }

  // Keeps the chosen notes as lines (edited first, if the user did) and remembers every note named as
  // decided, kept or not, so none is offered again
  decideClaudeNotes(keep: { file: string; kind: MemoryKind; text: string }[], drop: string[]): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const lines = await this.list()
      for (const note of keep) {
        const text = oneLine(note.text)
        if (text && !lines.some((l) => sameText(l.text, text)) && lines.length < MEMORY_MAX_LINES) lines.push({ id: nextId(lines), kind: note.kind, text, at: Date.now() })
      }
      const sidecar = (await readJson<{ claudeCode?: Record<string, string> }>(this.sidecar).catch(() => undefined)) ?? {}
      const claudeCode = { ...sidecar.claudeCode }
      for (const note of keep) claudeCode[note.file] = "kept"
      for (const file of drop) claudeCode[file] = "dropped"
      await writeJsonAtomic(this.sidecar, { ...sidecar, claudeCode })
      if (keep.length) await this.save(lines)
      return lines
    })
  }

  private async save(lines: MemoryLine[]) {
    await writeFileAtomic(this.file, formatMemory(lines))
    this.changed(lines)
  }
}

function checked(text: string) {
  const line = oneLine(text)
  if (!line) throw new RpcFailure(RpcErrorCode.InvalidParams, "The line is empty.")
  if (line.length > MEMORY_MAX_CHARS) throw new RpcFailure(RpcErrorCode.InvalidParams, `That line is ${line.length} characters; keep it to one short sentence (at most ${MEMORY_MAX_CHARS}).`)
  return line
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, " ").trim() === b.toLowerCase().replace(/\W+/g, " ").trim()

// A Claude Code memory note: front matter (name, description, metadata.type) and a body. Its description
// is the one line that says it; a feedback note is about how to work, every other kind about the work.
export function claudeNoteOf(file: string, content: string): ClaudeNote | null {
  const front = content.match(/^---\n([\s\S]*?)\n---/)
  const field = (key: string) => front?.[1].match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "")
  const body = (front ? content.slice(front[0].length) : content).trim()
  const text = oneLine(field("description") ?? body.split(/\n\s*\n/)[0] ?? "")
  if (!text) return null
  return { file, kind: field("type") === "feedback" ? "work" : "about", text: text.slice(0, MEMORY_MAX_CHARS) }
}
