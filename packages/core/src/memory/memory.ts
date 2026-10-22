import { t } from "@lingui/core/macro"
import { MEMORY_MAX_CHARS, MEMORY_MAX_LINES, projectKey, RpcErrorCode, type ClaudeNote, type MemoryKind, type MemoryLine, type MemoryScope, type Project } from "@owlit/protocol"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { RecordInput, Recorder } from "../changes/record.ts"
import { ignoreMissing, readJson, writeFileAtomic, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
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
//   - Scope is the home-care study only. <!-- m5 · 2026-10-22 · chat 8f2c… · project Work/Proactive -->
//
// Only the bullets are kept: owlit writes the file whole, in this shape, on every change. A bullet
// written by hand has no comment yet and gets its id on the next write. A line's project (the marked
// folder it is kept for) is the comment's last part, so the file has no section per project and reads as
// it always did; a bullet without one is the workspace's.

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
    let project: string | undefined
    const comment = body.match(COMMENT)
    if (comment) {
      body = body.slice(0, comment.index)
      const [rest, folder] = splitProject(comment[1])
      if (kind === "about") project = folder
      for (const part of rest.split("·").map((p) => p.trim())) {
        if (/^m\d+$/.test(part)) id = part
        else if (/^\d{4}-\d{2}-\d{2}$/.test(part)) at = Date.parse(`${part}T12:00:00`)
        else if (part.startsWith("chat ")) chatId = part.slice(5).trim() || undefined
      }
    }
    const text = body.trim()
    if (!text) continue
    if (!id || lines.some((l) => l.id === id)) loose.push(lines.length)
    lines.push({ id: id ?? "", kind, text, at, ...(chatId ? { chatId } : {}), ...(project ? { project } : {}) })
  }
  // Bullets written by hand, or a copied id: numbered after the highest id there is
  for (const i of loose) lines[i] = { ...lines[i], id: nextId(lines) }
  return lines
}

function nextId(lines: MemoryLine[]) {
  const top = Math.max(0, ...lines.map((l) => Number(l.id.match(/^m(\d+)$/)?.[1] ?? 0)))
  return `m${top + 1}`
}

// The project part comes last and is read to the comment's end, since a folder's name may hold a "·"
const PROJECT_PART = /(?:^|·)\s*project (.+)$/

function splitProject(comment: string): [rest: string, project: string | undefined] {
  const m = PROJECT_PART.exec(comment)
  return m ? [comment.slice(0, m.index), projectPath(m[1])] : [comment, undefined]
}

// A project's path as a line keeps it, without slashes around it; undefined for none
const projectPath = (value: string | undefined) => value?.trim().replace(/^\/+|\/+$/g, "") || undefined

const day = (at: number) => new Date(at).toLocaleDateString("sv-SE")

export function formatMemory(lines: MemoryLine[]) {
  const section = (kind: MemoryKind) => {
    const mine = lines.filter((l) => l.kind === kind)
    const bullets = mine.map((l) => `- ${oneLine(l.text)} <!-- ${[l.id, ...(l.at ? [day(l.at)] : []), ...(l.chatId ? [`chat ${l.chatId}`] : []), ...(l.project ? [`project ${oneLine(l.project)}`] : [])].join(" · ")} -->`)
    return `## ${HEADINGS[kind]}\n\n${bullets.length ? bullets.join("\n") + "\n" : ""}`
  }
  return `${HEADER}\n${section("work")}\n${section("about")}`
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").replace(/<!--|-->/g, "").trim()

// scope: where an about line is kept; a work line is always the workspace's. A replace without one keeps
// the line where it was.
export type MemoryOp =
  | { op: "add"; kind: MemoryKind; text: string; scope?: MemoryScope }
  | { op: "replace"; id: string; text: string; kind?: MemoryKind; scope?: MemoryScope }
  | { op: "remove"; id: string }

export interface MemoryChange {
  // The line as it is now; null when it was removed
  line: MemoryLine | null
  before: MemoryLine | null
  // The change log's entry; absent when nothing changed
  changeId?: string
  // Asked to be kept for the chat's project, the line is the workspace's: the chat is in none
  noProject?: true
}

export interface MemoryServices {
  // The projects a chat is in, nearest marks (Projects.projectsOf): a line an agent keeps for its chat's
  // project goes to the first
  projectsOfChat?: (chatId: string) => Promise<Project[]>
}

export class Memory {
  readonly file: string
  private readonly sidecar: string
  private readonly root: string
  private readonly recorder: Recorder
  private readonly changed: (lines: MemoryLine[]) => void
  private readonly services: MemoryServices
  private readonly serial = new Serial()

  constructor(owlitDir: string, root: string, recorder: Recorder, changed: (lines: MemoryLine[]) => void = () => undefined, services: MemoryServices = {}) {
    this.file = path.join(owlitDir, FILE)
    this.sidecar = path.join(owlitDir, SIDECAR)
    this.root = root
    this.recorder = recorder
    this.changed = changed
    this.services = services
  }

  async list(): Promise<MemoryLine[]> {
    const text = await readFile(this.file, "utf8").catch((error) => {
      ignoreMissing(error)
      return ""
    })
    return parseMemory(text)
  }

  // The lines kept for one project, by its marked folder's path exactly: a project inside it keeps its own
  async read(project: string): Promise<MemoryLine[]> {
    const want = projectKey(project)
    return want ? (await this.list()).filter((l) => projectKey(l.project) === want) : []
  }

  // Where an agent's line is kept: a work line is the workspace's; an about line replaced without a scope
  // stays where it was; "project" is the chat's first project, the workspace when the chat is in none
  private async placed(kind: MemoryKind, scope: MemoryScope | undefined, was: string | undefined, chatId: string | undefined): Promise<{ project?: string; noProject?: true }> {
    if (kind === "work" || scope === "workspace") return {}
    if (scope === undefined) return was ? { project: was } : {}
    const first = chatId ? (await this.services.projectsOfChat?.(chatId).catch(() => []))?.[0] : undefined
    return first ? { project: first.path } : { noProject: true }
  }

  // An agent's change (owlit-mcp's memory_write). What it sends back is said to the agent, so it is plain
  // English and says how to do better when the change can't be made. Each change goes in the change log,
  // so the chat's result row can undo it.
  agentWrite(op: MemoryOp, caller: Caller): Promise<MemoryChange> {
    const chatId = caller.kind === "window" ? undefined : caller.chatId
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
        const { project, noProject } = await this.placed(op.kind, op.scope, undefined, chatId)
        const line: MemoryLine = { id: nextId(lines), kind: op.kind, text, at: now, ...(chatId ? { chatId } : {}), ...(project ? { project } : {}) }
        lines.push(line)
        change = { line, before: null, ...(noProject ? { noProject } : {}) }
      } else {
        const i = lines.findIndex((l) => l.id === op.id)
        if (i < 0) throw new RpcFailure(RpcErrorCode.NotFound, `There is no line ${op.id} in the memory; it may have been removed. The list as it is now is in this session's last [owlit] memory note.`)
        const before = lines[i]
        if (op.op === "remove") {
          lines.splice(i, 1)
          change = { line: null, before }
        } else {
          const kind = op.kind ?? before.kind
          const { project: _was, ...rest } = before
          const { project, noProject } = await this.placed(kind, op.scope, before.project, chatId)
          const line: MemoryLine = { ...rest, kind, text: checked(op.text), at: now, ...(chatId ? { chatId } : {}), ...(project ? { project } : {}) }
          lines[i] = line
          change = { line, before, ...(noProject ? { noProject } : {}) }
        }
      }
      const entry = await this.record(caller, change.before, change.line)
      await this.save(lines)
      return { ...change, changeId: entry.id }
    })
  }

  // The user's own change, from Settings: a new line (no id), a line edited or moved to a project (or to
  // the workspace, no project), or a removed one put back
  put(input: { id?: string; kind: MemoryKind; text: string; at?: number; chatId?: string; project?: string }, caller: Caller): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const lines = await this.list()
      const text = oneLine(input.text)
      if (!text) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Write something to keep first.`)
      const i = input.id ? lines.findIndex((l) => l.id === input.id) : -1
      const before = i >= 0 ? lines[i]! : null
      // A line the person rewrites is theirs: it no longer names the chat it came from, which would make it
      // Owlit's again once the log has dropped this change (memory/rpc.ts memoryTarget)
      const { chatId: _from, project: _was, ...kept } = before ?? {}
      const rewritten = !!before && (before.text !== text || before.kind !== input.kind)
      // A work line is the workspace's wherever it is put
      const project = input.kind === "about" ? projectPath(input.project) : undefined
      const placed = project ? { project } : {}
      // A line only moved keeps its words, and so stays the line of the chat it came from
      const moved = !!before && !rewritten && projectKey(before.project) !== projectKey(project)
      // A line removed a moment ago comes back as it was, under its own id, naming its chat again; only the
      // window says what that was
      const chatId = caller.kind === "window" ? input.chatId : undefined
      const line: MemoryLine = before
        ? rewritten
          ? { ...(kept as MemoryLine), kind: input.kind, text, at: before.text === text ? before.at : Date.now(), ...placed }
          : moved
            ? { ...(kept as MemoryLine), ...(before.chatId ? { chatId: before.chatId } : {}), ...placed }
            : before
        : { id: input.id ?? nextId(lines), kind: input.kind, text, at: input.at ?? Date.now(), ...(chatId ? { chatId } : {}), ...placed }
      if (before) lines[i] = line
      else lines.push(line)
      if (JSON.stringify(before) !== JSON.stringify(line)) await this.record(caller, before, line)
      await this.save(lines)
      return lines
    })
  }

  remove(id: string, caller: Caller): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const all = await this.list()
      const before = all.find((l) => l.id === id)
      const lines = all.filter((l) => l !== before)
      if (before) await this.record(caller, before, null)
      await this.save(lines)
      return lines
    })
  }

  // Undo of a line's entry (changes/undo.ts): the line goes back to `to` wherever it is now in the list,
  // but only while its text is still what the entry left (`expect`)
  setLine(id: string, to: MemoryLine | null, expect: MemoryLine | null, caller: Caller, extra: Pick<RecordInput, "origin" | "undoes">) {
    return this.serial.run(async () => {
      const lines = await this.list()
      const i = lines.findIndex((l) => l.id === id)
      const now = i >= 0 ? lines[i] : null
      if ((now?.text ?? null) !== (expect?.text ?? null)) throw new RpcFailure(RpcErrorCode.Conflict, t`That line changed since, so owlit left it as it is.`, { id })
      if (to && i >= 0) lines[i] = to
      else if (to) lines.push(to)
      else if (i >= 0) lines.splice(i, 1)
      const entry = await this.record(caller, now, to, extra)
      await this.save(lines)
      return entry
    })
  }

  private record(caller: Caller, before: MemoryLine | null, after: MemoryLine | null, extra: Pick<RecordInput, "origin" | "undoes"> = {}) {
    const line = (after ?? before)!
    return this.recorder.record(
      caller,
      {
        action: before === null ? "create" : after === null ? "delete" : "update",
        target: { kind: "memory", path: "memory", part: line.id },
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...extra,
      },
      { label: line.text },
    )
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
  decideClaudeNotes(keep: { file: string; kind: MemoryKind; text: string }[], drop: string[], caller: Caller): Promise<MemoryLine[]> {
    return this.serial.run(async () => {
      const lines = await this.list()
      for (const note of keep) {
        const text = oneLine(note.text)
        if (!text || lines.some((l) => sameText(l.text, text)) || lines.length >= MEMORY_MAX_LINES) continue
        const line: MemoryLine = { id: nextId(lines), kind: note.kind, text, at: Date.now() }
        lines.push(line)
        await this.record(caller, null, line)
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

// Two lines that differ only in case, spacing and punctuation. Letters and digits of every script count:
// \W would take a line written only in Chinese for nothing at all, and so for the same as any other.
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const sameText = (a: string, b: string) => words(a) === words(b)

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
