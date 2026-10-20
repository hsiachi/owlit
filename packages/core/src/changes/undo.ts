import { t } from "@lingui/core/macro"
import { editStats, RpcErrorCode, type Change, type ChangeOrigin, type CommentEntry, type DocComment, type MemoryLine, type PaperPatch } from "@owlit/protocol"
import { sha1 } from "../fs-util.ts"
import { sameJson } from "../util.ts"
import { RpcFailure, type Caller } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import type { DigestRecord } from "../library/digest/prompt.ts"
import { hunks, merge } from "./hunks.ts"
import { passagePart, passageSpans, proposalHunks } from "./proposals.ts"

// A doc where the person sees it (agents/fs.ts): its open editor's text, else the disk's
export interface DocAccess {
  // null when there is no such doc
  text(rel: string): Promise<string | null>
  // Through the editor that has it open, as one step of its undo, else to disk
  write(rel: string, content: string, changeId: string): Promise<void>
}

interface UndoOptions {
  workspace: () => Workspace | null
  docs: DocAccess
  // An undo added, changed or removed a comment; windows show it
  commentsChanged: (change: { path: string; changed?: DocComment; removed?: string }) => void
}

// The undo's own entry, and for a doc the passages that changed since and so weren't put back
export interface Undone {
  change: Change
  left?: string[]
}

// Takes back one entry of the change log at the entry's own size: a doc's passages, a paper's field, a
// thread's item, a comment, a memory line. The undo is itself an entry that undoes the first, so undoing
// it is the redo. A change that something else changed since is refused, or for a doc kept where it
// clashes, never written over.
export class Undo {
  private readonly options: UndoOptions

  constructor(options: UndoOptions) {
    this.options = options
  }

  async undo(id: string, caller: Caller): Promise<Undone> {
    const ws = this.workspace()
    const change = await ws.changes.get(id)
    if (!change) throw gone(id)
    // An undo carries the chat of what it takes back, so that chat's card finds it
    const extra = { undoes: change.id, origin: change.origin.chatId ? { chatId: change.origin.chatId } : {} }
    switch (change.target.kind) {
      case "doc":
        return this.doc(ws, change, caller, extra)
      case "paper":
        return { change: await this.paper(ws, change, caller, extra) }
      case "thread": {
        const { path, part } = change.target
        return { change: part ? await ws.threads.setItem(path, part, change.before, change.after, caller, extra) : await ws.threads.undoWhole(change, caller, extra) }
      }
      case "comment":
        return { change: await this.comment(ws, change, caller, extra) }
      case "memory":
        return { change: await ws.memory.setLine(change.target.part!, (change.before as MemoryLine | undefined) ?? null, (change.after as MemoryLine | undefined) ?? null, caller, extra) }
    }
  }

  // One passage of a doc's change goes back, as the doc marks it (proposals.ts passageSpans, by index):
  // its words as they were before the change, put onto the doc as it is now. Recorded as an undo of the
  // change naming the passage (target.part), so the change's other passages still stand, and the chat's
  // card reads it as partly undone. A passage edited since is left as it is, and refused.
  async undoPart(id: string, index: number, caller: Caller): Promise<Undone> {
    const ws = this.workspace()
    const change = await ws.changes.get(id)
    if (!change) throw gone(id)
    const rel = change.target.path
    const name = rel.split("/").pop() ?? rel
    if (change.target.kind !== "doc" || change.action !== "update" || change.target.part !== undefined) {
      throw new RpcFailure(RpcErrorCode.InvalidParams, "Only a change to a doc's text is undone one passage at a time.", { id })
    }
    const before = await ws.changes.content(change.id)
    if (before === null) throw gone(id)
    const from = await this.leftBy(ws, change)
    const span = from === null ? undefined : passageSpans(before, from)[index]
    if (from === null || !span) throw new RpcFailure(RpcErrorCode.NotFound, t`That passage is no longer part of the change.`, { id })
    const note = ws.library.noteOf(rel)
    const now = note ? (await ws.library.read(note, "note")).text : await this.options.docs.text(rel)
    if (now === null) throw new RpcFailure(RpcErrorCode.NotFound, t`${name} is gone, so owlit couldn't put the change back.`, { path: rel })
    const { text, left } = merge(from, [{ from: span.af, to: span.at, insert: before.slice(span.bf, span.bt) }], hunks(from, now))
    if (left.length) throw new RpcFailure(RpcErrorCode.Conflict, t`That passage of ${name} was edited since, so owlit left it as it is.`, { path: rel })
    const extra = { undoes: change.id, part: passagePart(index), origin: change.origin.chatId ? { chatId: change.origin.chatId } : {} }
    // Recorded before the write, so the editor's save of it is known as this entry coming back
    const undo = await ws.recorder.doc(caller, rel, now, text, extra, { quiet: true })
    if (note) await ws.library.writeNoteFor(note, text)
    else await this.options.docs.write(rel, text, undo.id)
    ws.recorder.say(undo)
    return { change: undo }
  }

  // How much a run of entries on one doc changed it: from the text before the first to the text the last
  // left. Agents report their edits in pieces, if at all; these texts are what happened.
  async stats(ids: string[]) {
    const ws = this.workspace()
    const first = await ws.changes.get(ids[0])
    const last = ids.length > 1 ? await ws.changes.get(ids.at(-1)!) : first
    if (first?.target.kind !== "doc" || last?.target.kind !== "doc" || last.target.path !== first.target.path) return null
    const before = first.action === "create" ? "" : await ws.changes.content(first.id)
    const after = await this.leftBy(ws, last).catch(() => undefined)
    if (before === null || after === undefined) return null
    // Passages as the doc marks them, so a card can say how many of them the person undid there
    return { ...editStats(first.target.path, before, after ?? ""), passages: proposalHunks(before, after ?? "").length }
  }

  // A doc's passages go back: the hunks from the text the entry left to the text before it, applied to the
  // doc as it is now. Those that meet a later edit stay as they are and are named in `left`.
  private async doc(ws: Workspace, change: Change, caller: Caller, extra: Extra): Promise<Undone> {
    const rel = change.target.path
    const name = rel.split("/").pop() ?? rel
    const before = change.action === "create" ? null : await ws.changes.content(change.id)
    if (change.action !== "create" && before === null) throw gone(change.id)
    const from = await this.leftBy(ws, change)
    // A paper's note is always there, empty or not, and goes through the library so windows take it in
    const note = ws.library.noteOf(rel)
    const now = note ? (await ws.library.read(note, "note")).text : await this.options.docs.text(rel)

    let to: string | null
    let left: string[] = []
    if (note) {
      const merged = this.passages(name, from ?? "", before ?? "", now ?? "")
      to = merged.text
      left = merged.left
    } else if (from === null) {
      if (now !== null) throw new RpcFailure(RpcErrorCode.Conflict, t`There is a doc at ${name} again, so owlit left it as it is.`, { path: rel })
      to = before
    } else if (before === null) {
      if (now !== from) throw new RpcFailure(RpcErrorCode.Conflict, t`${name} changed after it was made, so owlit left it where it is.`, { path: rel })
      to = null
    } else {
      if (now === null) throw new RpcFailure(RpcErrorCode.NotFound, t`${name} is gone, so owlit couldn't put the change back.`, { path: rel })
      const merged = this.passages(name, from, before, now)
      to = merged.text
      left = merged.left
    }

    // Recorded before the write, so the editor's save of it is known as this entry coming back. The undo
    // of a passage's undo names the passage too, so it reads as that undo taken back.
    const part = change.target.part !== undefined ? { part: change.target.part } : {}
    const undo = await ws.recorder.doc(caller, rel, note ? now || null : now, note ? to || null : to, { ...extra, ...part }, { quiet: true })
    if (note) await ws.library.writeNoteFor(note, to ?? "")
    else if (to === null) await ws.docs.removeTold(rel)
    else await this.options.docs.write(rel, to, undo.id)
    ws.recorder.say(undo)
    return left.length ? { change: undo, left } : { change: undo }
  }

  // from → before put onto now; refused when no passage of it fits any more
  private passages(name: string, from: string, before: string, now: string) {
    if (now === from) return { text: before, left: [] }
    const wanted = hunks(from, before)
    const { text, left } = merge(from, wanted, hunks(from, now))
    if (wanted.length && left.length === wanted.length) {
      throw new RpcFailure(RpcErrorCode.Conflict, t`Every passage of that change in ${name} was edited since, so owlit left it as it is.`, { path: name })
    }
    return { text, left: left.map((h) => (h.insert || from.slice(h.from, h.to)).trim()).filter(Boolean) }
  }

  // The text a doc's entry left (null: none, it deleted the doc): the next entry's text from before, or
  // for the newest the doc as it is, on disk or in its editor, whichever still matches the entry
  private async leftBy(ws: Workspace, change: Change): Promise<string | null> {
    const rel = change.target.path
    const all = (await ws.changes.list({ target: { kind: "doc", path: rel } })).reverse()
    const next = all[all.findIndex((c) => c.id === change.id) + 1]
    if (next) {
      if (next.action === "create") return null
      const text = await ws.changes.content(next.id)
      if (text === null) throw gone(change.id)
      return text
    }
    if (change.action === "delete") return null
    const note = ws.library.noteOf(rel)
    if (note) return (await ws.library.read(note, "note")).text
    const disk = await ws.docs.readDisk(rel)
    // Typing not saved yet is in the editor only: the disk still has what the entry left
    if (disk !== null && sha1(disk) === change.afterHash) return disk
    return this.options.docs.text(rel)
  }

  // A paper added or removed comes back out or in; a field goes back to its value before, while it is
  // still what the entry left
  private async paper(ws: Workspace, change: Change, caller: Caller, extra: Extra) {
    const { target } = change
    if (!target.part) {
      if (change.action === "create") {
        if (!(await ws.library.get(target.path))) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper is already gone from the library.`)
        await ws.library.remove([target.path])
      } else if (!(await ws.library.restore([target.path])).length) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper is no longer in the trash.`)
      return ws.recorder.record(caller, { action: change.action === "create" ? "delete" : "create", target, ...extra })
    }
    if (target.part === "digest") return this.digest(ws, change, caller, extra)
    const field = target.part.replace(/^overrides\./, "") as keyof PaperPatch
    const paper = await ws.library.get(target.path)
    if (!paper) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the library any more.`)
    if (!sameJson(paper[field], change.after)) {
      const what = fieldName(field)
      throw new RpcFailure(RpcErrorCode.Conflict, t`The paper's ${what} changed since, so owlit left it as it is.`, { id: target.path, field })
    }
    await ws.library.update(target.path, { [field]: change.before })
    return ws.recorder.record(caller, { action: "update", target, ...extra, ...(change.after !== undefined ? { before: change.after } : {}), ...(change.before !== undefined ? { after: change.before } : {}) })
  }

  // A digest goes back to the one before it, or away when there was none, while it is still the one the
  // entry wrote
  private async digest(ws: Workspace, change: Change, caller: Caller, extra: Extra) {
    const id = change.target.path
    const now = await ws.library.digest(id).catch(() => null)
    const still = change.action === "delete" ? now === null : now !== null && sha1(now) === change.afterHash
    if (!still) throw new RpcFailure(RpcErrorCode.Conflict, t`The paper's digest changed since, so owlit left it as it is.`, { id })
    const before = change.action === "create" ? null : await ws.changes.content(change.id)
    if (change.action !== "create" && before === null) throw gone(change.id)
    const done = await ws.library.putDigest(id, before, (change.before as DigestRecord | undefined) ?? null)
    return ws.recorder.record(caller, {
      action: before === null ? "delete" : "update",
      target: change.target,
      ...extra,
      ...(done.beforeRecord ? { before: done.beforeRecord } : {}),
      ...(change.before !== undefined ? { after: change.before } : {}),
      ...(before !== null ? { afterHash: sha1(before) } : {}),
      ...(done.before !== null ? { content: done.before } : {}),
    })
  }

  // A whole comment comes out (with its replies) or back; its own fields or one of its entries go back
  // while they are what the change left
  private async comment(ws: Workspace, change: Change, caller: Caller, extra: Extra) {
    const { target } = change
    const [id, entryId] = target.part!.split("/") as [string, string | undefined]
    const now = (await ws.docs.listComments(target.path)).find((c) => c.id === id) ?? null
    const changed = t`That comment changed since, so owlit left it as it is.`
    const put = async (comment: DocComment) => {
      await ws.docs.putComment(target.path, comment)
      this.options.commentsChanged({ path: target.path, changed: comment })
    }
    if (!entryId && change.action === "create") {
      const removed = await ws.docs.removeComment(target.path, id)
      if (!removed) throw new RpcFailure(RpcErrorCode.Conflict, t`That comment is already gone.`, { path: target.path })
      this.options.commentsChanged({ path: target.path, removed: removed.id })
      return ws.recorder.record(caller, { action: "delete", target, before: removed, ...extra })
    }
    if (!entryId && change.action === "delete") {
      if (now) throw new RpcFailure(RpcErrorCode.Conflict, t`That comment is back already.`, { path: target.path })
      const comment = change.before as DocComment
      await ws.docs.addComment(target.path, comment)
      this.options.commentsChanged({ path: target.path, changed: comment })
      return ws.recorder.record(caller, { action: "create", target, after: comment, ...extra })
    }
    if (!now) throw new RpcFailure(RpcErrorCode.NotFound, t`That comment is gone.`, { path: target.path })
    if (!entryId) {
      const { entries, ...own } = now
      if (!sameJson(own, change.after)) throw new RpcFailure(RpcErrorCode.Conflict, changed, { path: target.path })
      await put({ ...(change.before as Omit<DocComment, "entries">), entries })
      return ws.recorder.record(caller, { action: "update", target, before: own, after: change.before, ...extra })
    }
    const entry = now.entries.find((e) => e.id === entryId)
    if (!sameJson(entry, change.after)) throw new RpcFailure(RpcErrorCode.Conflict, changed, { path: target.path })
    const back = change.before as CommentEntry | undefined
    const entries = now.entries.filter((e) => e.id !== entryId)
    if (back) entries.splice(entry ? now.entries.indexOf(entry) : entries.filter((e) => e.at <= back.at).length, 0, back)
    await put({ ...now, entries })
    return ws.recorder.record(caller, { action: !entry ? "create" : !back ? "delete" : "update", target, ...extra, ...(entry ? { before: entry } : {}), ...(back ? { after: back } : {}) })
  }

  private workspace() {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    return ws
  }
}

type Extra = { undoes: string; origin: Partial<ChangeOrigin> }

const gone = (id: string) => new RpcFailure(RpcErrorCode.NotFound, t`That change is no longer kept.`, { id })


function fieldName(field: keyof PaperPatch) {
  switch (field) {
    case "starred":
      return t({ message: "star", comment: "a paper's field, in: The paper's star changed since" })
    case "status":
      return t({ message: "reading status", comment: "a paper's field: unread, reading or read" })
    case "tags":
      return t({ message: "tags", comment: "a paper's field" })
    case "title":
      return t({ message: "title", comment: "a paper's field" })
    case "authors":
      return t({ message: "authors", comment: "a paper's field" })
    case "year":
      return t({ message: "year", comment: "a paper's field" })
    case "venue":
      return t({ message: "venue", comment: "a paper's field" })
    case "abstract":
      return t({ message: "abstract", comment: "a paper's field" })
    default:
      return t({ message: "details", comment: "a paper's field: its kind or ids" })
  }
}
