import type { Chat } from "./chat.ts"
import type { Paper } from "./library.ts"
import type { ThreadCell } from "./threads.ts"

// The change log: every change to something in the workspace, whoever made it, in .owlit/versions/.

// Who made a change: p_<8 hex> a person, o_<8 hex> that person's Owlit (minted together from the
// profile), "other" when owlit couldn't tell (another program, or a person not in the roster)
export type PersonId = `p_${string}`
export type OwlitId = `o_${string}`
export type ActorId = PersonId | OwlitId | "other"

export type ChangeAction = "create" | "update" | "delete"

export interface ChangeTarget {
  kind: "doc" | "comment" | "paper" | "thread" | "memory"
  // The doc's path, the comment's doc path, the paper's id, the thread's id, "memory"
  path: string
  // The piece inside it: a comment's id (<comment>/<entry> for one entry), a paper's field (status,
  // overrides.title…), a thread item (row:…, cell:…, memo:…, title), a memory line's id; absent when the
  // whole thing was created, deleted or changed
  part?: string
}

export interface ChangeOrigin {
  // editor: a window's save or op; tool: an agent through owlit's fs or tools; apply: an agent's edit
  // allowed before it wrote, by the user or by owlit as a proposal; watcher: a change seen on disk; auto:
  // something the app did on its own on the actor's action
  via: "editor" | "tool" | "apply" | "watcher" | "auto"
  // The chat or run it came from
  chatId?: string
  // The reply of that chat whose turn made it, when a turn was running (or its tool call was one of the
  // turn's): a chat's result card attributes by it
  replyId?: string
  toolCallId?: string
  // Shared by the entries of one write (the toolCallId when there is one)
  writeId?: string
}

export interface Change {
  // <at>-<rand>-<path>; also the name of the file holding a doc's text from before
  id: string
  at: number
  // A folded session's last save
  until?: number
  actor: ActorId
  action: ChangeAction
  target: ChangeTarget
  origin: ChangeOrigin
  // The value on each side, inline for everything but a doc (a comment, a paper's field, a thread's
  // item, a memory line); a doc's text from before is in the file named by id instead
  before?: unknown
  after?: unknown
  // A doc's sha1 after the change, to tell whether it changed since
  afterHash?: string
  // This change takes back that one; redo is the undo of the undo
  undoes?: string
}

// changes.list: every field given must match
export interface ChangeFilter {
  target?: Partial<ChangeTarget>
  // target.path, whatever the kind
  path?: string
  chatId?: string
  actor?: ActorId
  since?: number
}

// .owlit/members.json: names for the ids in the log
export type Member = { kind: "person"; name?: string } | { kind: "assistant"; of: PersonId }
export type Roster = Record<string, Member>

export const isPerson = (actor: ActorId): actor is PersonId => actor.startsWith("p_")
export const isOwlit = (actor: ActorId): actor is OwlitId => actor.startsWith("o_")
export const owlitOf = (person: PersonId): OwlitId => `o_${person.slice(2)}`
export const personOf = (owlit: OwlitId): PersonId => `p_${owlit.slice(2)}`

// ---- Seen: what a person last looked at, in .owlit/seen/<person>.json ----

// Each mark carries when it was made, so a mark older than the one kept is ignored
export interface SeenMarks {
  // When this person's marks began: comments from before it count as seen
  since: number
  // A doc: the sha1 of its text as it was on the person's screen
  docs: Record<string, { hash: string; at: number }>
  // A thread, by id: each item when it was on screen, and the thread's own id for the first look at it
  // as a whole
  threads: Record<string, Record<string, number>>
  // A chat or run: the last of its messages the person saw ended
  chats: Record<string, { message: string; at: number }>
  // A doc's comments, by its path
  comments: Record<string, number>
  // A paper's digest, by paper id: when it was on screen, or when the person asked for it
  digests: Record<string, number>
}

export type SeenKind = Exclude<keyof SeenMarks, "since">

// seen.mark: one unit the person has on screen now (at defaults to now)
export type SeenMark = { at?: number } & (
  | { kind: "doc"; path: string; hash: string }
  | { kind: "thread"; id: string; items: string[] }
  | { kind: "chat"; id: string; message: string }
  | { kind: "comments"; path: string }
  | { kind: "digest"; paper: string }
)

// changes.unseen: what changed since the person last looked, by anyone but them. changes: the log's
// entries newer than the person's mark on their unit (a doc, a thread's item, a doc's comments); chats:
// chats and runs whose last reply ended after the last message the person saw; digests: papers whose
// digest came after the person last looked
export interface Unseen {
  changes: Change[]
  chats: string[]
  digests: string[]
}

// changes.proposals: one of Owlit's changes to a doc since the text the person last had on screen, as
// the passages it replaced, so the doc can mark each and offer Keep and Undo on it
export interface Proposal {
  id: string
  at: number
  actor: ActorId
  hunks: ProposalHunk[]
}

// One passage of a proposal, as the text it put in and the text it took out, with the words either side
// of it in the text it left, so an editor can find it in the doc as it reads now (the words stop at the
// neighbouring passages, so one passage undone doesn't lose the next)
export interface ProposalHunk {
  insert: string
  removed: string
  before: string
  after: string
}

// changes.since: a paragraph of a doc as it reads now that someone other than the person wrote since
// the text they last had on screen
export interface ChangedPassage {
  text: string
  actor: ActorId
  at: number
}

// A thread item's entry by someone else carries a dot when it is something the person reads: the title,
// a memo sentence, a group, a new row, Owlit's answer in a cell the person didn't rewrite. Columns, a
// row moved between groups and the thread's settings don't.
export function threadDot(change: Change): boolean {
  const part = change.target.part ?? ""
  const [kind] = part.split(":")
  if (part === "title" || kind === "memo" || kind === "group") return true
  if (kind === "row") return change.action === "create"
  if (kind === "cell") return !(change.after as { edit?: unknown } | undefined)?.edit
  return false
}

// A cell's entry that is Owlit answering again from the full text what it had answered from the abstract
// or the title only: the answer it replaced and what that was from. The entry holds the whole cell on each
// side, so nothing else records it. A cell the person rewrote shows their words, so Owlit's rewrite under
// them isn't one.
export function readInFull(change: Change | undefined): { was: string; from: "abstract" | "title" } | null {
  if (!change || change.action !== "update" || !change.target.part?.startsWith("cell:")) return null
  const before = (change.before as { value?: ThreadCell } | undefined)?.value
  const after = change.after as { value?: ThreadCell; edit?: unknown } | undefined
  if (!before || !after?.value || after.edit || after.value.depth !== "full" || before.depth === "full") return null
  return { was: before.text, from: before.depth }
}

// A chat whose last reply ended well after the last message the person saw. A chat they never looked at
// (a run, or one from before the marks) has none: it is not news.
function chatUnseen(chat: Pick<Chat, "messages">, mark: SeenMarks["chats"][string] | undefined): boolean {
  const last = chat.messages.at(-1)
  return !!mark && last?.role === "assistant" && last.status === "done" && last.id !== mark.message
}

// A digest Owlit wrote after the person last opened the paper or looked at (or asked for) its digest.
// One on a paper they never opened or asked about was written in the background and is not news.
export function digestUnseen(paper: Pick<Paper, "hasDigest" | "digestAt" | "lastOpenedAt">, mark: number | undefined): boolean {
  if (!paper.hasDigest || !paper.digestAt) return false
  if (!paper.lastOpenedAt && mark === undefined) return false
  return paper.digestAt > Math.max(mark ?? 0, paper.lastOpenedAt ?? 0)
}

// Moves the marks forward with a mark made at at; false when it was older than the mark kept, or the
// same, and nothing changed
export function applySeen(marks: SeenMarks, mark: SeenMark, at: number): boolean {
  switch (mark.kind) {
    case "doc": {
      const was = marks.docs[mark.path]
      if (was && (was.at > at || was.hash === mark.hash)) return false
      marks.docs[mark.path] = { hash: mark.hash, at }
      return true
    }
    case "chat": {
      const was = marks.chats[mark.id]
      if (was && (was.at > at || was.message === mark.message)) return false
      marks.chats[mark.id] = { message: mark.message, at }
      return true
    }
    case "thread": {
      const thread = (marks.threads[mark.id] ??= {})
      let moved = false
      // The thread's own id is its first look as a whole; its items on screen are marked one by one
      for (const item of thread[mark.id] === undefined ? [mark.id, ...mark.items] : mark.items) {
        if ((thread[item] ?? -Infinity) >= at) continue
        thread[item] = at
        moved = true
      }
      return moved
    }
    case "comments":
      if ((marks.comments[mark.path] ?? -Infinity) >= at) return false
      marks.comments[mark.path] = at
      return true
    case "digest":
      if ((marks.digests[mark.paper] ?? -Infinity) >= at) return false
      marks.digests[mark.paper] = at
      return true
  }
}

export interface UnseenSources {
  // The log, newest first
  changes: Change[]
  // The chats the person marked that changed after their mark
  chats: Pick<Chat, "id" | "messages">[]
  papers: Pick<Paper, "id" | "hasDigest" | "digestAt" | "lastOpenedAt">[]
  // Only entries from then on
  since?: number
}

// What changed since the person last looked, by anyone but them: a doc's entries after its text was last
// on their screen, a thread's dotted items after their own mark or the thread's first look (none before
// that first look: the whole thread is new), new comments on a doc after its comments were on screen
export function unseenOf(marks: SeenMarks, me: PersonId, { changes, chats, papers, since }: UnseenSources): Unseen {
  const out = changes.filter((c) => {
    if (c.actor === me || (since !== undefined && c.at < since)) return false
    const { kind, path: at, part = "" } = c.target
    if (kind === "doc") return c.at > (marks.docs[at]?.at ?? Infinity)
    if (kind === "comment") return c.action === "create" && !part.includes("/") && c.at > (marks.comments[at] ?? marks.since)
    if (kind !== "thread") return false
    const thread = marks.threads[at]
    return c.at > (thread?.[part] ?? thread?.[at] ?? Infinity) && threadDot(c)
  })
  return {
    changes: out,
    chats: chats.filter((chat) => chatUnseen(chat, marks.chats[chat.id])).map((chat) => chat.id),
    digests: papers.filter((p) => digestUnseen(p, marks.digests[p.id])).map((p) => p.id),
  }
}
