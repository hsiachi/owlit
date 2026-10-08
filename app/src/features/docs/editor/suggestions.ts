import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import type { Chat } from "@/features/chat/types"

// An edit an agent has proposed to a doc and is waiting on: an ACP edit tool call with a diff, plus its
// permission request. It is drawn in place; Apply and Discard answer the request.
export interface PendingEdit {
  chatId: string
  requestId: string
  path: string
  oldText: string
  newText: string
}

export function pendingEdits(chats: Record<string, Chat>, path: string): PendingEdit[] {
  const out: PendingEdit[] = []
  for (const chat of Object.values(chats)) {
    const last = chat.messages[chat.messages.length - 1]
    if (last?.role !== "assistant" || last.status !== "streaming") continue
    for (const part of last.parts) {
      if (part.type !== "permission" || part.outcome) continue
      const call = last.parts.find((p) => p.type === "tool_call" && p.toolCallId === part.toolCallId)
      if (call?.type === "tool_call" && call.diff?.path === path)
        out.push({ chatId: chat.id, requestId: part.requestId, path, oldText: call.diff.oldText, newText: call.diff.newText })
    }
  }
  return out
}

// The one span an edit changes, between the text it shares with the old file at both ends
function hunk(oldText: string, newText: string) {
  let p = 0
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++
  let s = 0
  while (s < oldText.length - p && s < newText.length - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++
  return { at: p, removed: oldText.slice(p, oldText.length - s), added: newText.slice(p, newText.length - s) }
}

// Where the edit sits in the doc as it is now; null once the passage has changed
function locate(state: EditorState, edit: PendingEdit) {
  const doc = state.doc.toString()
  const h = hunk(edit.oldText, edit.newText)
  if (doc === edit.oldText) return { from: h.at, to: h.at + h.removed.length, added: h.added }
  if (!h.removed) return null
  const i = doc.indexOf(h.removed)
  if (i < 0 || doc.indexOf(h.removed, i + 1) >= 0) return null
  return { from: i, to: i + h.removed.length, added: h.added }
}

// New words, with any [label](owlit://…) drawn as the mention it will become
class AddedWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  eq(other: AddedWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-suggest-ins"
    for (const piece of this.text.split(/(\[[^\]]*\]\(owlit:\/\/[^)]+\))/g)) {
      const m = /^\[([^\]]*)\]\(owlit:\/\/[^)]+\)$/.exec(piece)
      if (!m) {
        span.append(piece)
        continue
      }
      const mention = document.createElement("span")
      mention.className = "cm-mention"
      mention.textContent = m[1]
      span.append(mention)
    }
    return span
  }
}

class BarWidget extends WidgetType {
  readonly edit: PendingEdit
  readonly respond: (edit: PendingEdit, apply: boolean) => void
  constructor(edit: PendingEdit, respond: (edit: PendingEdit, apply: boolean) => void) {
    super()
    this.edit = edit
    this.respond = respond
  }
  eq(other: BarWidget) {
    return other.edit.requestId === this.edit.requestId
  }
  toDOM() {
    const bar = document.createElement("div")
    bar.className = "cm-suggest-bar"
    const label = document.createElement("span")
    label.textContent = "Suggested by the agent"
    const discard = document.createElement("button")
    discard.type = "button"
    discard.className = "cm-suggest-discard"
    discard.textContent = "Discard"
    discard.onclick = () => this.respond(this.edit, false)
    const apply = document.createElement("button")
    apply.type = "button"
    apply.className = "cm-suggest-apply"
    apply.textContent = "Apply"
    apply.onclick = () => this.respond(this.edit, true)
    bar.append(label, discard, apply)
    return bar
  }
  ignoreEvent() {
    return true
  }
}

export const setPendingEdits = StateEffect.define<PendingEdit[]>()

function build(state: EditorState, edits: PendingEdit[], respond: (edit: PendingEdit, apply: boolean) => void): DecorationSet {
  const decos: Range<Decoration>[] = []
  for (const edit of edits) {
    const at = locate(state, edit)
    if (!at) continue
    if (at.to > at.from) decos.push(Decoration.mark({ class: "cm-suggest-del" }).range(at.from, at.to))
    if (at.added) decos.push(Decoration.widget({ widget: new AddedWidget(at.added), side: 1 }).range(at.to))
    decos.push(Decoration.widget({ widget: new BarWidget(edit, respond), block: true, side: 1 }).range(state.doc.lineAt(at.to).to))
  }
  return Decoration.set(decos, true)
}

export function agentSuggestions(respond: (edit: PendingEdit, apply: boolean) => void): Extension {
  return StateField.define<{ edits: PendingEdit[]; decos: DecorationSet }>({
    create: () => ({ edits: [], decos: Decoration.none }),
    update(value, tr) {
      let edits = value.edits
      for (const e of tr.effects) if (e.is(setPendingEdits)) edits = e.value
      if (edits === value.edits && !tr.docChanged) return value
      return { edits, decos: build(tr.state, edits, respond) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })
}
