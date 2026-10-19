import { t } from "@lingui/core/macro"
import { asComment, editStats, RpcErrorCode, type Change, type DocComment } from "@owlit/protocol"
import { newWriteId } from "../changes/record.ts"
import { sha1 } from "../fs-util.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
import type { UiBridge } from "../ui/bridge.ts"
import type { Workspace } from "../workspace/workspace.ts"

const log = (line: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[agent fs] ${line}`)

interface AgentFsOptions {
  workspace: () => Workspace | null
  ui: UiBridge
  // An undo added or removed a comment; windows show it
  commentsChanged: (change: { path: string; changed?: DocComment; removed?: string }) => void
}

// What agents read and write (ACP fs/read_text_file and fs/write_text_file). A doc open in a window is
// read from and written through its editor, so the agent sees what the user sees and its edit is one
// undoable change there; anything else goes to disk. Every write goes in the change log with the file
// as it was, so it can be taken back.
export class AgentFs {
  private readonly options: AgentFsOptions
  // Paths this class is writing right now, whose change on disk is already recorded
  private writing = new Set<string>()

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

  // An agent's ACP write, for the chat it runs in (or the run a review is part of)
  async write(file: string, content: string, chatId?: string) {
    log(`write ${file} (${content.length} characters)`)
    const ws = this.workspace()
    const rel = ws.docs.resolve(file)
    const caller: Caller = { kind: "owlit", ...(chatId ? { chatId } : {}) }
    // A paper's note is the user's, like a doc: the agent may change it when asked (the edit is shown in
    // the note first), and it goes through the library so open windows take it in
    const notePaper = ws.library.noteOf(rel)
    if (notePaper) {
      const before = (await ws.library.read(notePaper, "note")).text
      const change = await ws.recorder.doc(caller, rel, before || null, content, {}, { quiet: true })
      await this.writingTo(rel, () => ws.library.writeNoteFor(notePaper, content))
      ws.recorder.say(change)
      return
    }
    if (ws.docs.isOwlits(rel)) throw new RpcFailure(RpcErrorCode.InvalidParams, `${rel} is owlit's, not a doc; agents can't write it.`, { path: rel })
    const holder = this.options.ui.holder(rel)
    const before = (await this.fromEditor(rel)) ?? (await ws.docs.readDisk(rel))
    // Said only once it reaches the disk: an editor that takes it shows the edit itself
    const change = await ws.recorder.doc(caller, rel, before, content, {}, { quiet: true })
    if (holder) {
      const applied = await this.options.ui
        .request(holder, "fs.write", { path: rel, content, changeId: change.id })
        .then((r) => r.applied)
        .catch(() => false)
      log(applied ? `  through the editor in window ${holder.slice(0, 8)}` : "  the window didn't take it; writing to disk")
      if (applied) return
    }
    await this.writingTo(rel, () => ws.docs.writeTold(rel, content))
    ws.recorder.say(change)
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

  // A workspace path an agent may delete or move: a doc or folder of the user's, not owlit's own
  private docPath(file: string) {
    const docs = this.workspace().docs
    const rel = docs.resolve(file)
    if (docs.isOwlits(rel)) throw new RpcFailure(RpcErrorCode.InvalidParams, `${rel} is owlit's, not a doc; agents can't delete or move it.`, { path: rel })
    return rel
  }

  private keep(caller: Caller, rel: string, before: string | null, after: string | null, writeId: string) {
    return this.workspace().recorder.doc(caller, rel, before, after, { origin: { writeId } })
  }

  // An agent that writes the disk itself (Claude Code does, not through ACP's fs): its change, seen by the
  // watcher while one of its tool calls names the file, is recorded as its chat's
  async recordDirect(rel: string, before: string | null, after: string | null, chatId: string) {
    if (this.writing.has(rel)) return
    log(`${rel} changed by the agent of chat ${chatId.slice(0, 8)}`)
    await this.workspace().recorder.doc({ kind: "watcher", chatId }, rel, before, after)
  }

  // How much a run of changes to one doc changed it: from the text before the first to the text after
  // the last, which the doc's next entry holds when there is one since, and the file itself otherwise.
  // Agents report their edits in pieces, if at all; these texts are what happened.
  async stats(ids: string[]) {
    const ws = this.workspace()
    const first = await ws.changes.get(ids[0])
    const last = ids.length > 1 ? await ws.changes.get(ids.at(-1)!) : first
    if (first?.target.kind !== "doc" || last?.target.kind !== "doc" || last.target.path !== first.target.path) return null
    const path = first.target.path
    const before = first.action === "create" ? "" : await ws.changes.content(first.id)
    if (before === null) return null
    const all = (await ws.changes.list({ target: { kind: "doc", path } })).reverse()
    const next = all.slice(all.findIndex((c) => c.id === last.id) + 1)[0]
    const after =
      last.action === "delete" ? "" : next ? (next.action === "create" ? "" : await ws.changes.content(next.id)) : ((await this.fromEditor(path)) ?? (await ws.docs.readDisk(path)))
    if (after === null) return null
    return editStats(path, before, after)
  }

  // Takes back one change of the log, recorded as a change that undoes it, so the undo can be undone in
  // turn: a doc goes back to its text from before (one the change created goes to the Trash), a comment
  // an agent left goes, a paper an agent added goes to .owlit/trash/. Unless forced, a doc that changed
  // since is left alone.
  async undo(id: string, caller: Caller, force = false): Promise<Change> {
    const ws = this.workspace()
    const change = await ws.changes.get(id)
    if (!change) throw new RpcFailure(RpcErrorCode.NotFound, t`That change is no longer kept.`, { id })
    const { target } = change
    const undoes = change.id

    if (target.kind === "comment") {
      if (change.action === "create") {
        // Taking back Owlit's comment takes the replies under it too; the redo brings them back
        const removed = await ws.docs.removeComment(target.path, asComment(change.after as DocComment).id)
        if (!removed) throw new RpcFailure(RpcErrorCode.Conflict, t`That comment is already gone.`, { path: target.path })
        this.options.commentsChanged({ path: target.path, removed: removed.id })
        return ws.recorder.record(caller, { action: "delete", target, before: removed, undoes })
      }
      const comment = asComment(change.before as DocComment)
      await ws.docs.addComment(target.path, comment)
      this.options.commentsChanged({ path: target.path, changed: comment })
      return ws.recorder.record(caller, { action: "create", target, after: comment, undoes })
    }

    if (target.kind === "paper") {
      if (change.action === "create") await ws.library.remove([target.path])
      else await ws.library.restore([target.path])
      return ws.recorder.record(caller, { action: change.action === "create" ? "delete" : "create", target, undoes })
    }

    if (target.kind === "memory") return ws.memory.undo(change, caller, force)
    if (target.kind === "thread") return ws.threads.undo(change, await ws.changes.content(change.id), caller)

    const before = change.action === "create" ? null : await ws.changes.content(change.id)
    if (change.action !== "create" && before === null) throw new RpcFailure(RpcErrorCode.NotFound, t`That change is no longer kept.`, { id })
    const notePaper = ws.library.noteOf(target.path)
    if (notePaper) {
      const now = (await ws.library.read(notePaper, "note")).text
      if (sha1(now) !== change.afterHash && !force) {
        throw new RpcFailure(RpcErrorCode.Conflict, t`The note changed after the agent's edit, so owlit left it as it is.`, { path: target.path })
      }
      const undo = await ws.recorder.doc(caller, target.path, now || null, before, { undoes })
      await this.writingTo(target.path, () => ws.library.writeNoteFor(notePaper, before ?? ""))
      return undo
    }

    const now = (await this.fromEditor(target.path)) ?? (await ws.docs.readDisk(target.path))
    const untouched = change.action === "delete" ? now === null : now !== null && sha1(now) === change.afterHash
    if (!untouched && !force) {
      const name = target.path.split("/").pop() ?? target.path
      throw new RpcFailure(RpcErrorCode.Conflict, t`${name} changed after the agent's edit, so owlit left it as it is.`, { path: target.path })
    }
    const undo = await ws.recorder.doc(caller, target.path, now, before, { undoes })
    await this.writingTo(target.path, () => (before !== null ? ws.docs.writeTold(target.path, before) : ws.docs.removeTold(target.path)))
    return undo
  }

  // A write whose change on disk is already recorded, so the watcher's report of it isn't a second one
  private async writingTo(rel: string, write: () => Promise<unknown>) {
    this.writing.add(rel)
    try {
      await write()
    } finally {
      this.writing.delete(rel)
    }
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
