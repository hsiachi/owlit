import { t } from "@lingui/core/macro"
import { isMarkdown, RpcErrorCode, type ActorId, type ChangeOrigin, type Role } from "@owlit/protocol"
import { newWriteId } from "../changes/record.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
import type { UiBridge } from "../ui/bridge.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { decide, offLimits, type Target } from "./policy.ts"
import type { Claim } from "./turns.ts"

const log = (line: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[agent fs] ${line}`)

interface AgentFsOptions {
  workspace: () => Workspace | null
  ui: UiBridge
  // The tool call claiming a file now (agents/turns.ts)
  claimOf?: (rel: string) => Claim | undefined
  // The role a chat's agent works in now (Turns.roleOf)
  roleOf?: (chatId: string) => Promise<Role | undefined>
}

// What agents read and write (ACP fs/read_text_file and fs/write_text_file). A doc open in a window is
// read from and written through its editor, so the agent sees what the user sees and its edit is one
// undoable change there; anything else goes to disk. Every write goes in the change log with the file
// as it was, so it can be taken back (changes/undo.ts, which reads and writes docs the same way).
export class AgentFs {
  private readonly options: AgentFsOptions

  constructor(options: AgentFsOptions) {
    this.options = options
  }

  async read(file: string, line?: number, limit?: number) {
    log(`read ${file}`)
    const ws = this.workspace()
    const rel = ws.docs.resolve(file)
    const content = (await this.fromEditor(rel)) ?? (await ws.docs.readDisk(rel))
    if (content === null) throw new RpcFailure(RpcErrorCode.NotFound, `There is no ${rel} in the workspace.`, { path: rel })
    if (line === undefined && limit === undefined) return { content }
    // line is 1-based; limit counts lines
    const lines = content.split("\n")
    const start = Math.max(0, (line ?? 1) - 1)
    return { content: lines.slice(start, limit === undefined ? undefined : start + limit).join("\n") }
  }

  // An agent's ACP write, for the chat it runs in, or core's own write for no chat.
  // The chat's tool call that named the file says which call wrote it, and whether the user chose it (Apply).
  async write(file: string, content: string, { chatId }: { chatId?: string } = {}) {
    log(`write ${file} (${content.length} characters)`)
    const ws = this.workspace()
    const caller: Caller = { kind: "owlit", ...(chatId ? { chatId } : {}) }
    const target = await this.target([file])
    // A chat's agent writes as its role lets it; core's own write was decided by core, and only
    // the target's limits hold for it
    const role = chatId ? await this.options.roleOf?.(chatId) : undefined
    const decision = chatId ? decide({ caller, actor: await this.actorOf(caller), ...(role ? { role } : {}) }, "words", target) : offLimits(target)
    if (decision !== "allow") throw new RpcFailure(RpcErrorCode.Forbidden, decision.refuse, { path: file })
    const rel = target.files![0]!
    const claim = chatId ? this.options.claimOf?.(rel) : undefined
    const origin: Partial<ChangeOrigin> = claim && claim.chatId === chatId ? { via: claim.accepted ? "apply" : "tool", toolCallId: claim.toolCallId } : {}
    // A paper's note is the user's, like a doc: the agent may change it when asked (the edit is shown in
    // the note first), and it goes through the library so open windows take it in
    const notePaper = ws.library.noteOf(rel)
    if (notePaper) {
      const before = (await ws.library.read(notePaper, "note")).text
      const change = await ws.recorder.doc(caller, rel, before || null, content, { origin }, { quiet: true })
      await ws.library.writeNoteFor(notePaper, content)
      ws.recorder.say(change)
      return
    }
    const before = await this.text(rel)
    // Said once it is written, so the window that shows it has it
    const change = await ws.recorder.doc(caller, rel, before, content, { origin }, { quiet: true })
    await this.place(rel, content, change.id)
    ws.recorder.say(change)
  }

  // The files a write or an engine's request names, as the policy's target (policy.ts): each resolved
  // against the workspace, and whether all are the user's: inside the workspace and docs (not library/,
  // .owlit/ or another dot-folder, as written or where a link leads), or a paper's note
  async target(paths: string[]): Promise<Target> {
    const { docs, library } = this.workspace()
    const files: string[] = []
    let notDoc = false
    for (const file of paths) {
      let rel: string
      try {
        rel = docs.resolve(file)
      } catch {
        notDoc = true
        continue
      }
      files.push(rel)
      if (library.noteOf(rel)) continue
      if (!docs.isDoc(rel)) notDoc = true
    }
    return { what: "file", files, ...(notDoc ? { notDoc } : {}) }
  }

  // The caller as the change log names it
  actorOf(caller: Caller): Promise<ActorId> {
    return this.workspace().recorder.actorOf(caller)
  }

  // A doc's text as the person sees it: its open editor's, else the disk's; null when there is none
  async text(rel: string) {
    return (await this.fromEditor(rel)) ?? (await this.workspace().docs.readDisk(rel))
  }

  // Writes a doc through the editor that has it open, as one step of its undo, else to disk. undo: an
  // undo of a change in the log, which the editor applies without saying it as an agent's edit.
  async place(rel: string, content: string, changeId: string, undo = false) {
    const holder = this.options.ui.holder(rel)
    if (holder) {
      const applied = await this.options.ui
        .request(holder, "fs.write", { path: rel, content, changeId, ...(undo ? { undo } : {}) })
        .then((r) => r.applied)
        .catch(() => false)
      log(applied ? `  through the editor in window ${holder.slice(0, 8)}` : "  the window didn't take it; writing to disk")
      if (applied) return
    }
    await this.workspace().docs.writeTold(rel, content)
  }

  // Writes a doc of the agent's own whole (owlit-mcp's docs_write), once the policy found it the caller's:
  // a new Markdown file, or one only the caller has changed (core.ts docTarget). Recorded as the
  // caller's write, so its chat offers Undo; a new doc's Undo takes it away.
  async writeOwn(file: string, content: string, caller: Caller) {
    const ws = this.workspace()
    const rel = this.docPath(file)
    if (!isMarkdown(rel)) throw new RpcFailure(RpcErrorCode.InvalidParams, "docs_write writes Markdown docs: give the path a .md name.", { path: rel })
    const before = await this.text(rel)
    const change = await ws.recorder.doc(caller, rel, before, content, {}, { quiet: true })
    await this.place(rel, content, change.id)
    ws.recorder.say(change)
    return { path: rel, created: before === null }
  }

  // Deletes docs for an agent (owlit-mcp's docs_delete, once the chat's role allows it). Each file's text is
  // recorded first, so the chat offers Undo for it; the files themselves go to the Trash.
  async remove(paths: string[], caller: Caller) {
    const ws = this.workspace()
    const writeId = newWriteId()
    const done: string[] = []
    for (const file of paths) {
      const rel = this.docPath(file)
      const texts = await ws.docs.textsUnder(rel)
      await ws.docs.delete(rel, true)
      for (const t of texts) await this.keep(caller, t.path, t.content, null, writeId)
      done.push(rel)
    }
    return done
  }

  // Moves or renames a doc or folder for an agent (owlit-mcp's docs_move). Recorded as each file leaving
  // its old place and arriving at the new one, so Undo puts it back.
  async move(file: string, to: string, caller: Caller) {
    const ws = this.workspace()
    const writeId = newWriteId()
    const rel = this.docPath(file)
    const target = this.docPath(to)
    const texts = await ws.docs.textsUnder(rel)
    const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : ""
    const name = target.slice(folder ? folder.length + 1 : 0)
    // Only where there is none: making one beside a folder of the same name would add "Folder 2"
    if (folder) await ws.docs.ensureFolder(folder)
    let at = rel
    const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")
    // Told to windows, which didn't ask for it: the doc keeps its id there and follows to its new path
    if (parent(at) !== folder) at = (await ws.docs.move(at, folder, true)).path
    if (at.slice(at.lastIndexOf("/") + 1) !== name) at = (await ws.docs.rename(at, name, true)).path
    for (const t of texts) {
      await this.keep(caller, t.path, t.content, null, writeId)
      await this.keep(caller, at + t.path.slice(rel.length), null, t.content, writeId)
    }
    return at
  }

  // A workspace path an agent names; whether it may delete or move it is the policy's (core.ts gives the
  // router target for agents.deleteDocs and agents.moveDoc)
  private docPath(file: string) {
    return this.workspace().docs.resolve(file)
  }

  private keep(caller: Caller, rel: string, before: string | null, after: string | null, writeId: string) {
    return this.workspace().recorder.doc(caller, rel, before, after, { origin: { writeId } })
  }

  private workspace() {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    return ws
  }

  // The text in the editor that has this doc open, if any window does and answers
  private async fromEditor(rel: string): Promise<string | null> {
    const holder = this.options.ui.holder(rel)
    if (!holder) return null
    const answer = await this.options.ui.request(holder, "fs.read", { path: rel }).catch(() => null)
    return answer?.content ?? null
  }
}
