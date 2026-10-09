import { RpcErrorCode, type AgentRecord } from "@owlit/protocol"
import type { Journal } from "../activity/index.ts"
import { sha1 } from "../docs/versions.ts"
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
    if (rel === ".owlit" || rel.startsWith(".owlit/")) throw new RpcFailure(RpcErrorCode.InvalidParams, "Agents can't write inside .owlit.", { path: rel })
    const holder = this.options.ui.holder(rel)
    const before = (await this.fromEditor(rel)) ?? (await ws.docs.readDisk(rel))
    const version = await ws.versions.save(rel, before, content, chatId)
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

  // An agent that writes the disk itself (Claude Code does, not through ACP's fs): its change, seen by the
  // watcher while one of its tool calls names the file, is kept and journaled the same way
  async recordDirect(rel: string, before: string | null, after: string | null, chatId: string) {
    if (this.writing.has(rel)) return
    const ws = this.workspace()
    log(`${rel} changed by the agent of chat ${chatId.slice(0, 8)}`)
    const version = await ws.versions.save(rel, before, after, chatId)
    this.options.journal.record({ kind: "agent.wrote", at: version.at, path: rel, versionId: version.id, chatId })
    this.options.wrote({ path: rel, versionId: version.id, chatId })
  }

  // Puts a file back as it was before an agent's write, unless it changed since; a file the agent
  // created goes to the Trash
  async restore(versionId: string) {
    const ws = this.workspace()
    const version = await ws.versions.get(versionId)
    if (!version) throw new RpcFailure(RpcErrorCode.NotFound, "That earlier version is no longer kept.", { versionId })
    const now = (await this.fromEditor(version.path)) ?? (await ws.docs.readDisk(version.path))
    const untouched = version.deleted ? now === null : now !== null && sha1(now) === version.after
    if (!untouched) {
      throw new RpcFailure(RpcErrorCode.Conflict, `${version.path.split("/").pop()} changed after the agent's edit, so owlit left it as it is.`, { path: version.path })
    }
    if (version.existed) await ws.docs.writeTold(version.path, version.before)
    else await ws.docs.removeTold(version.path)
    return { path: version.path }
  }

  private workspace() {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, "Open a folder as the workspace first.")
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
