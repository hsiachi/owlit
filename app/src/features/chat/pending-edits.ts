import { useChatStore } from "./store"
import type { Chat } from "./types"

// An edit an agent has proposed to a file and is waiting on: an ACP edit tool call with a diff, plus its
// permission request. Docs and paper notes draw it in place; Apply and Discard answer the request.
export interface PendingEdit {
  chatId: string
  requestId: string
  path: string
  oldText: string
  newText: string
}

// The edits a chat's reply is waiting on, for any file
function waitingIn(chat: Chat): PendingEdit[] {
  const last = chat.messages[chat.messages.length - 1]
  if (last?.role !== "assistant" || last.status !== "streaming") return []
  const out: PendingEdit[] = []
  for (const part of last.parts) {
    if (part.type !== "permission" || part.outcome) continue
    const call = last.parts.find((p) => p.type === "tool_call" && p.toolCallId === part.toolCallId)
    if (call?.type === "tool_call" && call.diff)
      out.push({ chatId: chat.id, requestId: part.requestId, path: call.diff.path, oldText: call.diff.oldText, newText: call.diff.newText })
  }
  return out
}

const sameEdits = (a: PendingEdit[], b: PendingEdit[]) => a.length === b.length && a.every((e, i) => e.requestId === b[i].requestId && e.path === b[i].path)

// What each chat waits on, kept up to date by one watcher of the chat store. A streamed token changes only
// its own chat, so only that chat is looked at again, and listeners hear only about the files whose
// edits changed.
const byChat = new Map<string, PendingEdit[]>()
const listeners = new Set<{ path: () => string | undefined; changed: () => void }>()
let watching = false

function watch() {
  if (watching) return
  watching = true
  for (const chat of Object.values(useChatStore.getState().chats)) byChat.set(chat.id, waitingIn(chat))
  useChatStore.subscribe((state, prev) => {
    if (state.chats === prev.chats) return
    const touched = new Set<string>()
    for (const chat of Object.values(state.chats)) {
      if (prev.chats[chat.id] === chat) continue
      const before = byChat.get(chat.id) ?? []
      const now = waitingIn(chat)
      if (sameEdits(before, now)) continue
      byChat.set(chat.id, now)
      for (const e of [...before, ...now]) touched.add(e.path)
    }
    for (const [id, edits] of byChat) {
      if (state.chats[id]) continue
      byChat.delete(id)
      for (const e of edits) touched.add(e.path)
    }
    if (!touched.size) return
    for (const l of listeners) {
      const path = l.path()
      if (path && touched.has(path)) l.changed()
    }
  })
}

const editsFor = (path: string | undefined) => (path ? [...byChat.values()].flat().filter((e) => e.path === path) : [])

// Calls `show` now and whenever the edits waiting for the file at `path` change (the path is asked each
// time, so a doc renamed meanwhile is followed). Returns an unsubscribe.
export function subscribePendingEdits(path: () => string | undefined, show: (edits: PendingEdit[]) => void) {
  watch()
  let shown = editsFor(path())
  show(shown)
  const listener = {
    path,
    changed: () => {
      const edits = editsFor(path())
      if (sameEdits(edits, shown)) return
      shown = edits
      show(edits)
    },
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The line under a proposed edit that answers it: "Suggested by Owlit", Discard and Apply. Styled by the
// suggest-* classes in index.css, the same in a doc and in a note.
export function suggestionBar(answer: (apply: boolean) => void) {
  const bar = document.createElement("div")
  bar.className = "suggest-bar"
  bar.contentEditable = "false"
  const label = document.createElement("span")
  label.textContent = "Suggested by Owlit"
  const button = (text: string, className: string, apply: boolean) => {
    const b = document.createElement("button")
    b.type = "button"
    b.className = className
    b.textContent = text
    b.onclick = () => answer(apply)
    return b
  }
  bar.append(label, button("Discard", "suggest-discard", false), button("Apply", "suggest-apply", true))
  return bar
}
