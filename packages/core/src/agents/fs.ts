import { t } from "@lingui/core/macro"
import { asComment, editStats, RpcErrorCode, type AgentRecord, type DocComment } from "@owlit/protocol"
import type { Journal } from "../activity/index.ts"
import { sha1, type Version } from "../docs/versions.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { UiBridge } from "../ui/bridge.ts"
import type { Workspace } from "../workspace/workspace.ts"

const log = (line: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[agent fs] ${line}`)

interface AgentFsOptions {
  workspace: () => Workspace | null
  ui: UiBridge
  journal: Journal
  // An agent wrote a file that no window had open: windows offer Undo for it
  wrote: (record: { path: string; versionId: string; chatId?: string }) => void
  // An undo added or removed a note; windows show it
  commentsChanged: (change: { path: string; changed?: DocComment; removed?: string }) => void
}

// What agents read and write (ACP fs/read_text_file and fs/write_text_file). A doc open in a window is
// read from and written through its editor, so the agent sees what the user sees and its edit is one
// undoable change there; anything else goes to disk. Every write first keeps the file as it was
// (.owlit/versions/) and is journaled as the agent's.
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

  async write(file: string, content: string, chatId?: string) {
    log(`write ${file} (${content.length} characters)`)
    const ws = this.workspace()
    const rel = ws.docs.resolve(file)
    // A paper's note is the user's, like a doc: the agent may change it when asked (the edit is shown in
    // the note first), and it goes through the library so open windows take it in
    const notePaper = ws.library.noteOf(rel)
    if (notePaper) {
      const before = (await ws.library.read(notePaper, "note")).text
      const version = await ws.versions.saveFile(rel, before || null, content, { chatId })
      this.options.journal.record({ kind: "agent.wrote", at: version.at, path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) })
      // Already kept above; the change the library then reports is not a second one
      this.writing.add(rel)
      try {
        await ws.library.writeNoteFor(notePaper, content)
      } finally {
        this.writing.delete(rel)
      }
      this.options.wrote({ path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) })
      return
    }
    // By its first segment, whatever its case: macOS's file system takes .OWLIT for .owlit
    if (rel.split("/")[0].toLowerCase() === ".owlit") throw new RpcFailure(RpcErrorCode.InvalidParams, "Agents can't write inside .owlit.", { path: rel })
    const holder = this.options.ui.holder(rel)
    const before = (await this.fromEditor(rel)) ?? (await ws.docs.readDisk(rel))
    const version = await ws.versions.saveFile(rel, before, content, { chatId })
    const record: AgentRecord = { kind: "agent.wrote", at: version.at, path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) }
    this.options.journal.record(record)
    if (holder) {
      const applied = await this.options.ui
        .request(holder, "fs.write", { path: rel, content, versionId: version.id })
        .then((r) => r.applied)
        .catch(() => false)
      log(applied ? `  through the editor in window ${holder.slice(0, 8)}` : "  the window didn't take it; writing to disk")
      if (applied) return
    }
    this.writing.add(rel)
    try {
      await ws.docs.writeTold(rel, content)
    } finally {
      this.writing.delete(rel)
    }
    this.options.wrote({ path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) })
  }

  // Deletes docs for an agent (owlit-mcp's docs_delete, once the chat's role allows it). Each file's text is
  // kept first, so the chat offers Undo for it; the files themselves go to the Trash.
  async remove(paths: string[], chatId?: string) {
    const ws = this.workspace()
    const done: string[] = []
    for (const file of paths) {
      const rel = this.docPath(file)
      const texts = await ws.docs.textsUnder(rel)
      await ws.docs.delete(rel, true)
      for (const t of texts) await this.keep(t.path, t.content, null, chatId)
      done.push(rel)
    }
    return done
  }

  // Moves or renames a doc or folder for an agent (owlit-mcp's docs_move). Kept as each file leaving its
  // old place and arriving at the new one, so Undo puts it back.
  async move(file: string, to: string, chatId?: string) {
    const ws = this.workspace()
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
      await this.keep(t.path, t.content, null, chatId)
      await this.keep(at + t.path.slice(rel.length), null, t.content, chatId)
    }
    return at
  }

  // A workspace path an agent may delete or move: a doc or folder of the user's, not owlit's own
  private docPath(file: string) {
    const rel = this.workspace().docs.resolve(file)
    const top = rel.split("/")[0].toLowerCase()
    if (top === ".owlit" || top === "library") throw new RpcFailure(RpcErrorCode.InvalidParams, `${rel} is owlit's, not a doc; agents can't delete or move it.`, { path: rel })
    return rel
  }

  private async keep(rel: string, before: string | null, after: string | null, chatId?: string) {
    const version = await this.workspace().versions.saveFile(rel, before, after, { chatId })
    this.options.journal.record({ kind: "agent.wrote", at: version.at, path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) })
    this.options.wrote({ path: rel, versionId: version.id, ...(chatId ? { chatId } : {}) })
  }

  // An agent that writes the disk itself (Claude Code does, not through ACP's fs): its change, seen by the
  // watcher while one of its tool calls names the file, is kept and journaled the same way
  async recordDirect(rel: string, before: string | null, after: string | null, chatId: string) {
    if (this.writing.has(rel)) return
    const ws = this.workspace()
    log(`${rel} changed by the agent of chat ${chatId.slice(0, 8)}`)
    const version = await ws.versions.saveFile(rel, before, after, { chatId })
    this.options.journal.record({ kind: "agent.wrote", at: version.at, path: rel, versionId: version.id, chatId })
    this.options.wrote({ path: rel, versionId: version.id, chatId })
  }

  // How much a run of an agent's writes to one file changed it: from the text before the first (`from`) to
  // the text after the last (`to`), which the file's next version holds when one was kept since, and the
  // file itself otherwise. Agents report their edits in pieces, if at all; these texts are what happened.
  async stats(from: string, to: string) {
    const ws = this.workspace()
    const first = await ws.versions.get(from)
    const last = to === from ? first : await ws.versions.get(to)
    if (first?.kind !== "file" || last?.kind !== "file" || last.path !== first.path) return null
    const all = (await ws.versions.list({ path: first.path })).reverse()
    const next = all.slice(all.findIndex((v) => v.id === last.id) + 1).find((v) => v.kind === "file")
    const after = last.deleted ? "" : next ? ((await ws.versions.get(next.id))?.content ?? null) : ((await this.fromEditor(first.path)) ?? (await ws.docs.readDisk(first.path)))
    if (after === null) return null
    return editStats(first.path, first.existed === false ? "" : first.content, after)
  }

  // Takes back what a version recorded: a file goes back to its text from before (one the agent created
  // goes to the Trash), a note an agent left goes, a paper an agent added goes to .owlit/trash/. What it
  // replaces is kept as a version too, so the undo can be undone (redoId). Unless forced, a file that
  // changed since is left alone.
  async restore(versionId: string, force = false): Promise<{ path: string; kind: Version["kind"]; redoId: string }> {
    const ws = this.workspace()
    const version = await ws.versions.get(versionId)
    if (!version) throw new RpcFailure(RpcErrorCode.NotFound, t`That earlier version is no longer kept.`, { versionId })
    const meta = { by: "undo" as const, ...(version.chatId ? { chatId: version.chatId } : {}) }

    if (version.kind === "note") {
      const comment = asComment(JSON.parse(version.content))
      if (version.op === "added") {
        // Taking back Owlit's comment takes the replies under it too; the redo brings them back
        const removed = await ws.docs.removeComment(version.path, comment.id)
        if (!removed) throw new RpcFailure(RpcErrorCode.Conflict, t`That comment is already gone.`, { path: version.path })
        const redo = await ws.versions.saveComment(version.path, removed, "removed", meta)
        this.options.commentsChanged({ path: version.path, removed: comment.id })
        return { path: version.path, kind: "note", redoId: redo.id }
      }
      await ws.docs.addComment(version.path, comment)
      this.options.commentsChanged({ path: version.path, changed: comment })
      const redo = await ws.versions.saveComment(version.path, comment, "added", meta)
      return { path: version.path, kind: "note", redoId: redo.id }
    }

    if (version.kind === "paper") {
      if (version.op === "added") await ws.library.remove([version.path])
      else await ws.library.restore([version.path])
      const redo = await ws.versions.savePaper(version.path, version.op === "added" ? "removed" : "added", meta)
      return { path: version.path, kind: "paper", redoId: redo.id }
    }

    if (version.kind === "memory") {
      const { redoId } = await ws.memory.restoreVersion(version.path, version.content, version.after, force, version.chatId ? { chatId: version.chatId } : {})
      return { path: version.path, kind: "memory", redoId }
    }

    if (version.kind === "thread") {
      const { redoId } = await ws.threads.restoreVersion(version.path, version.content, version.existed !== false, version.chatId ? { chatId: version.chatId } : {})
      return { path: version.path, kind: "thread", redoId }
    }

    const notePaper = ws.library.noteOf(version.path)
    if (notePaper) {
      const now = (await ws.library.read(notePaper, "note")).text
      if (sha1(now) !== version.after && !force) {
        throw new RpcFailure(RpcErrorCode.Conflict, t`The note changed after the agent's edit, so owlit left it as it is.`, { path: version.path })
      }
      const redo = await ws.versions.saveFile(version.path, now || null, version.existed ? version.content : null, meta)
      this.writing.add(version.path)
      try {
        await ws.library.writeNoteFor(notePaper, version.existed ? version.content : "")
      } finally {
        this.writing.delete(version.path)
      }
      return { path: version.path, kind: "file", redoId: redo.id }
    }

    const now = (await this.fromEditor(version.path)) ?? (await ws.docs.readDisk(version.path))
    const untouched = version.deleted ? now === null : now !== null && sha1(now) === version.after
    if (!untouched && !force) {
      const name = version.path.split("/").pop() ?? version.path
      throw new RpcFailure(RpcErrorCode.Conflict, t`${name} changed after the agent's edit, so owlit left it as it is.`, { path: version.path })
    }
    const redo = await ws.versions.saveFile(version.path, now, version.existed ? version.content : null, meta)
    this.writing.add(version.path)
    try {
      if (version.existed) await ws.docs.writeTold(version.path, version.content)
      else await ws.docs.removeTold(version.path)
    } finally {
      this.writing.delete(version.path)
    }
    return { path: version.path, kind: "file", redoId: redo.id }
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
