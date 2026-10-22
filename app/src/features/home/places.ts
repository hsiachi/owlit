import { plural, t } from "@lingui/core/macro"
import { baseName, displayName, isMarkdown, parentPath, type WorkspaceFile } from "@/features/docs/types"
import { messageText } from "@/features/chat/lib/message-text"
import type { Kind } from "@/lib/kinds"
import { markdownPlain } from "@/lib/markdown-plain"
import { isOwlit, isProjectMark, threadDot, type ActorId, type Change, type Chat, type ChatMessage, type PersonId, type Thread, type Unseen } from "@owlit/protocol"

// "Where was I": everything the user did something in, newest first, across docs, chats, papers and
// threads. A doc counts once the user wrote in it (the trail has a mark for it, or the change log has a
// change of theirs), a chat once they sent something, a paper once opened to read, highlighted or noted,
// a thread once asked.

export interface Place {
  kind: Extract<Kind, "doc" | "chat" | "paper" | "thread">
  key: string
  // The unit's own id: the doc's path, the chat's, paper's or thread's id
  id: string
  title: string
  // Muted text after the title: the doc's folder, the paper's authors and year, the thread's folder
  detail: string
  at: number
  to: string
  // The user's own last words there: the paragraph the cursor was in, their last message, their last
  // highlight or note; for a thread, Owlit's first line about it. Never reading progress.
  words?: string
  // What the time means for this kind ("edited", "Owlit edited", "read"); Home words it, none for a chat
  // or a thread
  did: Did | null
  // Who made the last change, when did is "others-edited"
  by?: ActorId
}

export type Did = "edited" | "owlit-wrote" | "owlit-edited" | "others-edited" | "read"

// The paragraph around an offset: the run of non-blank lines that holds it
function paragraphAt(text: string, head: number) {
  const at = Math.min(Math.max(head, 0), text.length)
  const start = text.lastIndexOf("\n\n", Math.max(at - 1, 0))
  const end = text.indexOf("\n\n", at)
  const words = markdownPlain(text.slice(start < 0 ? 0 : start + 2, end < 0 ? text.length : end))
  return words || undefined
}

export const lastParagraph = (text: string) => markdownPlain(text.trim().split(/\n\s*\n/).at(-1) ?? "") || undefined

// When a change was made; a folded session counts from its last save
const changedAt = (c: Change) => c.until ?? c.at

// The docs the user wrote in. changes: the log's doc entries, newest first. A doc whose last change is
// someone else's, after the user's own last edit, says who made it.
export function docPlaces(files: Iterable<WorkspaceFile>, marks: readonly { path: string; at: number; head: number }[], changes: readonly Change[], me: PersonId | undefined): Place[] {
  const markByPath = new Map(marks.map((m) => [m.path, m]))
  const last = new Map<string, Change>()
  const mine = new Map<string, Change>()
  for (const c of changes) {
    if (!last.has(c.target.path)) last.set(c.target.path, c)
    if (me && c.actor === me && !mine.has(c.target.path)) mine.set(c.target.path, c)
  }
  const out: Place[] = []
  for (const f of files) {
    // A project's mark says what the folder is; writing it is no work on a doc, and the person who just
    // made one would find it as their place to continue
    if (!isMarkdown(f.path) || isProjectMark(f.path)) continue
    const mark = markByPath.get(f.path)
    const own = mine.get(f.path)
    // Any Markdown file in the folder isn't a place: a synced vault or a git pull would fill Home with
    // files the user never wrote in here
    if (!mark && !own) continue
    const wrote = Math.max(mark?.at ?? 0, own ? changedAt(own) : 0)
    const newest = last.get(f.path)
    const other = newest && newest.actor !== me && changedAt(newest) > wrote ? newest : undefined
    out.push({
      kind: "doc",
      key: `doc:${f.id}`,
      id: f.path,
      title: displayName(f.path),
      detail: baseName(parentPath(f.path)),
      at: Math.max(wrote, other ? changedAt(other) : 0),
      to: `/docs/${f.id}`,
      // Without a cursor to go by, the end of the doc: drafts grow at the bottom
      words: f.content ? (mark ? paragraphAt(f.content, mark.head) : lastParagraph(f.content)) : undefined,
      // "Owlit wrote" a doc it made, "Owlit edited" one it changed, "Ruth edited" another person's change
      did: !other ? "edited" : isOwlit(other.actor) ? (other.action === "create" ? "owlit-wrote" : "owlit-edited") : "others-edited",
      ...(other && !isOwlit(other.actor) && { by: other.actor }),
    })
  }
  return out
}

// A chat's place: the same object while its title and the user's last message stay the same, so a
// streamed reply (which leaves both alone) neither requotes the chat nor redraws Home. A chat about
// using owlit itself (Help › Ask Owlit how to…) isn't work, so it is no place.
const chatPlaceCache = new Map<string, { mine: ChatMessage; place: Place }>()
export function chatPlace(c: Chat): Place[] {
  if (c.help) return []
  const mine = c.messages.findLast((m) => m.role === "user")
  if (!mine) return []
  const was = chatPlaceCache.get(c.id)
  if (was && was.mine === mine && was.place.title === c.title) return [was.place]
  const words = markdownPlain(messageText(mine, " ")) || undefined
  const place: Place = { kind: "chat", key: `chat:${c.id}`, id: c.id, title: c.title, detail: "", at: mine.createdAt, to: `/chat/${c.id}`, words, did: null }
  chatPlaceCache.set(c.id, { mine, place })
  return [place]
}

// A thread is a place from the moment it was asked: named by Owlit's short title (the question as typed
// can run to a paragraph, and says less than the name), dated by the person's last question or own change
// to it (mine: their newest entry in its log), quoting Owlit's one line on it. Its detail is its project's
// name (projectName: by the marked folder's path, "" for one no longer marked).
export function threadPlace(c: Pick<Thread, "id" | "title" | "asked" | "alsoAsked" | "project" | "one">, mine?: number, projectName: (path: string) => string = () => ""): Place {
  return {
    kind: "thread",
    key: `thread:${c.id}`,
    id: c.id,
    title: c.title,
    detail: projectName(c.project),
    at: Math.max(c.asked.at, ...(c.alsoAsked ?? []).map((a) => a.at), mine ?? 0),
    to: `/threads/${c.id}`,
    words: markdownPlain(c.one) || undefined,
    did: null,
  }
}

// What came to a place since the user last looked, in words for its row: Owlit's dot, or the warning dot
// for comments, which wait on the user's answer
export interface News {
  words: string
  comment?: boolean
}

// name: how the window names an actor (nameOf)
export function placeNews(place: Place, unseen: Unseen, name: (actor: ActorId) => string): News | null {
  switch (place.kind) {
    case "chat":
      return unseen.chats.includes(place.id) ? { words: t({ message: "Owlit finished", comment: "Home: a chat whose reply ended since the user looked" }) } : null
    case "paper":
      return unseen.digests.includes(place.id) ? { words: t`Digest ready` } : null
    case "thread": {
      const dots = unseen.changes.filter((c) => c.target.kind === "thread" && c.target.path === place.id && threadDot(c))
      if (!dots.length) return null
      const papers = dots.filter((c) => c.action === "create" && c.target.part?.startsWith("row:")).length
      if (papers) return { words: plural(papers, { one: "# new paper", other: "# new papers" }) }
      return { words: edited(dots[0]!.actor, name) }
    }
    case "doc": {
      const comments = new Set(unseen.changes.filter((c) => c.target.kind === "comment" && c.target.path === place.id).map((c) => c.target.part?.split("/")[0] ?? ""))
      if (comments.size) return { words: plural(comments.size, { one: "# comment", other: "# comments" }), comment: true }
      const change = unseen.changes.find((c) => c.target.kind === "doc" && c.target.path === place.id)
      return change ? { words: edited(change.actor, name) } : null
    }
  }
}

// "Owlit edited", "Ruth edited", "Changed outside owlit"
function edited(actor: ActorId, name: (actor: ActorId) => string) {
  if (actor === "other") return t({ message: "Changed outside owlit", comment: "Home: a doc or thread another program changed" })
  const who = name(actor)
  return t({ message: `${who} edited`, comment: "Home: who changed a doc or thread since the user looked (Owlit, or a person's name)" })
}
