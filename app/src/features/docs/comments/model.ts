import { t } from "@lingui/core/macro"
import { type CommentAnchor, type DocComment, findAnchor, isOpenComment, locateInMarkdown, type QuotedSelection } from "@owlit/protocol"
import { newId } from "@/lib/id"
import { rpc } from "@/lib/rpc"
import { toastError, toastUndo } from "@/lib/toast"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { docMentionable } from "../lib/mentions"
import { shares, commentThreadsOf, type CommentThread } from "../share/store"
import { useDocsStore } from "../store"
import { useDocsUiStore } from "../ui-store"

// One comment as the doc's column draws it, whoever it comes from: Owlit's and yours (DocComment, kept
// beside the file) and a share reader's (CommentThread, kept on the share server) are the same thing to
// the person reading. Each is the entry that started it, then replies, flat, as in Google Docs and Feishu.
export interface CommentView {
  // "c:<id>" for a DocComment, "r:<root id>" for a reader's thread
  key: string
  quote: string
  entries: EntryView[]
  createdAt: number
  // Where its passage is in the doc's Markdown now
  find: (text: string) => { from: number; to: number } | null
  doc?: DocComment
  thread?: CommentThread
  // Put away (the doc's own) or marked resolved (a reader's): only in the Resolved comments list
  resolved?: boolean
}

export interface EntryView {
  id: string
  who: "owlit" | "you" | "person"
  // As signed: "Owlit", "You", a reader's name
  name: string
  text: string
  at: number
  editedAt?: number
  // Yours, in a comment kept beside the file: it has Edit and Delete
  editable: boolean
}

export const docKey = (id: string) => `c:${id}`
export const threadKey = (rootId: string) => `r:${rootId}`

function fromDoc(c: DocComment): CommentView {
  return {
    key: docKey(c.id),
    quote: c.quote,
    resolved: !!(c.resolvedAt || c.foldedAt),
    createdAt: c.createdAt,
    doc: c,
    find: (text) => {
      const at = findAnchor(text, c)
      return at === null ? null : { from: at, to: at + c.quote.length }
    },
    entries: c.entries.map((e) => ({
      id: e.id,
      who: e.by,
      name: e.by === "owlit" ? "Owlit" : t({ message: "You", comment: "who wrote a comment or reply: the user" }),
      text: e.text,
      at: e.at,
      editedAt: e.editedAt,
      editable: e.by === "you",
    })),
  }
}

function fromThread(th: CommentThread): CommentView {
  const entry = (c: CommentThread["replies"][number]): EntryView => ({
    id: c.id,
    who: c.by === "author" ? "you" : "person",
    name: c.by === "author" ? t({ message: "You", comment: "who wrote a comment or reply: the user" }) : c.name,
    text: c.text,
    at: c.at,
    // The share server has no edit or delete
    editable: false,
  })
  return {
    key: threadKey(th.root.id),
    quote: th.root.anchor.quote,
    createdAt: th.root.at,
    thread: th,
    resolved: !!th.root.resolved,
    // A reader quoted the doc as drawn, so the passage is found again in the Markdown
    find: (text) => locateInMarkdown(text, th.root.anchor),
    entries: [entry(th.root), ...th.replies.map(entry)],
  }
}

// The open comments on a doc, Owlit's, yours and readers', in the order they were started
export function commentViews(docComments: DocComment[] | undefined, readerComments: Parameters<typeof commentThreadsOf>[0]): CommentView[] {
  const own = (docComments ?? []).filter(isOpenComment).map(fromDoc)
  return [...own, ...commentThreadsOf(readerComments).map(fromThread)].sort((a, b) => a.createdAt - b.createdAt)
}

// The ones put away, newest first, for the Resolved comments list
export function resolvedViews(docComments: DocComment[] | undefined, readerComments: Parameters<typeof commentThreadsOf>[0]): CommentView[] {
  // Dismissed ones are Owlit's memory of what not to say, not something to open again. Ones Owlit folded
  // away (their words changed, nobody answered) are history like resolved ones.
  const own = (docComments ?? []).filter((c) => (c.resolvedAt || c.foldedAt) && !c.dismissedAt && c.entries.length).map(fromDoc)
  const at = (v: CommentView) => v.doc?.resolvedAt ?? v.doc?.foldedAt ?? v.createdAt
  return [...own, ...commentThreadsOf(readerComments, { resolved: true }).map(fromThread)].sort((a, b) => at(b) - at(a))
}

// ---- What can be done with a comment ----

const pathOf = (fileId: string) => useDocsStore.getState().files[fileId]?.path
const docComment = (fileId: string, id: string) => useDocsStore.getState().comments[fileId]?.find((c) => c.id === id)

export function startComment(fileId: string, anchor: CommentAnchor, text: string) {
  const at = Date.now()
  const comment: DocComment = { id: newId(), ...anchor, entries: [{ id: newId(), by: "you", text, at }], createdAt: at }
  useDocsStore.getState().addComment(fileId, comment)
  return comment
}

// A reply goes to the whole comment. On a reader's thread it goes to the reader, through the share link.
export async function reply(fileId: string, view: CommentView, text: string) {
  if (view.doc) {
    const now = docComment(fileId, view.doc.id)
    if (now) useDocsStore.getState().putComment(fileId, { ...now, entries: [...now.entries, { id: newId(), by: "you", text, at: Date.now() }] })
    return
  }
  const path = pathOf(fileId)
  if (!view.thread || !path) return
  await shares.reply(path, view.thread.root.id, text).catch((error: unknown) => {
    toastError(error)
    throw error
  })
}

export function editEntry(fileId: string, commentId: string, entryId: string, text: string) {
  const now = docComment(fileId, commentId)
  if (!now) return
  useDocsStore.getState().putComment(fileId, { ...now, entries: now.entries.map((e) => (e.id === entryId ? { ...e, text, editedAt: Date.now() } : e)) })
}

// Deleting the first entry deletes the whole comment, replies too, as Google Docs does
export function deleteEntry(fileId: string, commentId: string, entryId: string) {
  const store = useDocsStore.getState()
  const now = docComment(fileId, commentId)
  if (!now) return
  if (now.entries[0]?.id === entryId) {
    const removed = store.removeComment(fileId, commentId)
    if (removed) toastUndo(t`Comment deleted`, () => useDocsStore.getState().addComment(fileId, removed))
    return
  }
  const before = store.putComment(fileId, { ...now, entries: now.entries.filter((e) => e.id !== entryId) })
  if (before) toastUndo(t`Reply deleted`, () => useDocsStore.getState().putComment(fileId, before))
}

// Puts a comment away; it is kept, and Undo opens it again
export function resolve(fileId: string, view: CommentView) {
  const ui = useDocsUiStore.getState()
  if (ui.openComment?.key === view.key) ui.setOpenComment(fileId, null)
  if (view.doc) {
    const now = docComment(fileId, view.doc.id)
    if (!now) return
    const before = useDocsStore.getState().putComment(fileId, { ...now, resolvedAt: Date.now() })
    if (before) toastUndo(t`Comment resolved`, () => useDocsStore.getState().putComment(fileId, before))
    return
  }
  const path = pathOf(fileId)
  if (!view.thread || !path) return
  const id = view.thread.root.id
  void shares
    .resolve(path, id, true)
    .then(() => toastUndo(t`Comment resolved`, () => shares.resolve(path, id, false)))
    .catch(toastError)
}

// One of Owlit's comments the user doesn't want: gone for good, and Owlit is told not to say it again.
// Unlike Resolve there is no Undo: it is a judgement on what Owlit said, not a place to come back to.
export function dismiss(fileId: string, view: CommentView) {
  const path = pathOf(fileId)
  if (!view.doc || !path) return
  const ui = useDocsUiStore.getState()
  if (ui.openComment?.key === view.key) ui.setOpenComment(fileId, null)
  void rpc.comments.dismiss({ path, id: view.doc.id }).catch(toastError)
}

// Opens a resolved comment again, or one Owlit folded away
export function reopen(fileId: string, view: CommentView) {
  if (view.doc) {
    const now = docComment(fileId, view.doc.id)
    if (now) useDocsStore.getState().putComment(fileId, { ...now, resolvedAt: undefined, foldedAt: undefined })
    return
  }
  const path = pathOf(fileId)
  if (view.thread && path) void shares.resolve(path, view.thread.root.id, false).catch(toastError)
}

// The chat a comment was last asked about in, while that chat still exists
export function askedChat(key: string) {
  const asked = useDocsUiStore.getState().askedChats[key]
  return asked && useChatStore.getState().chats[asked.chatId] ? asked.chatId : null
}

// Ask Owlit on a comment: the docked panel opens on its passage with the whole comment along, so Owlit
// knows what was said there. It goes on in the chat this comment was asked about before, else in a new
// one: the chat docked at the time is usually about something else. Once the question is sent, the comment
// remembers that chat, so its card can lead to the answer.
export function askAbout(fileId: string, view: CommentView, from?: number) {
  const file = useDocsStore.getState().files[fileId]
  if (!file) return
  const selection: QuotedSelection = {
    text: view.quote,
    source: docMentionable(file),
    from,
    comment: { entries: view.entries.map((e) => ({ who: e.name, text: e.text })) },
  }
  const agent = useAgentWindow.getState()
  const before = askedChat(view.key)
  agent.askIn(before, selection)
  if (!before) {
    // Sending takes the passage and puts the new chat in the panel; taking the chip off, or asking about
    // something else, leaves the selection without a new chat, and nothing is remembered
    const stop = useAgentWindow.subscribe((s) => {
      if (s.selection === selection) return
      stop()
      if (s.chatId) useDocsUiStore.getState().setAsked(view.key, s.chatId)
    })
  }
}
