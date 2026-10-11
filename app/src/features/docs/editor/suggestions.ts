import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import { suggestionBar, type PendingEdit } from "@/features/chat/pending-edits"
import { hunk } from "@/lib/text-diff"
import { renderInline } from "./render-inline"

// An agent's proposed edit to the doc (a PendingEdit), drawn in place

// Where text occurs exactly once in the doc, or -1
function only(doc: string, text: string) {
  const i = doc.indexOf(text)
  return i >= 0 && doc.indexOf(text, i + 1) < 0 ? i : -1
}

// Where the edit sits in the doc as it is now; null once the passage has changed. The whole passage the
// agent quoted pins the edit down first: a pure insertion removes nothing, so it has nothing else to go by.
function locate(state: EditorState, edit: PendingEdit) {
  const doc = state.doc.toString()
  const h = hunk(edit.oldText, edit.newText)
  const base = doc === edit.oldText ? 0 : edit.oldText ? only(doc, edit.oldText) : -1
  if (base >= 0) return { from: base + h.at, to: base + h.at + h.removed.length, added: h.added }
  if (!h.removed) return null
  const i = only(doc, h.removed)
  if (i < 0) return null
  return { from: i, to: i + h.removed.length, added: h.added }
}

// New words, drawn as they will read: a [label](owlit://…) as the mention it will become. Spaces at either
// end stay outside the underline. After struck words they keep a small gap, so the old and new don't run
// together.
class AddedWidget extends WidgetType {
  readonly text: string
  readonly replaces: boolean
  constructor(text: string, replaces: boolean) {
    super()
    this.text = text
    this.replaces = replaces
  }
  eq(other: AddedWidget) {
    return other.text === this.text && other.replaces === this.replaces
  }
  toDOM() {
    const [, lead, words, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(this.text)!
    const outer = document.createElement("span")
    const span = document.createElement("span")
    span.className = this.replaces ? "suggest-ins suggest-ins-after" : "suggest-ins"
    outer.append(lead, span, trail)
    renderInline(words, span)
    return outer
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
    return suggestionBar((apply) => this.respond(this.edit, apply))
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
    if (at.to > at.from) decos.push(Decoration.mark({ class: "suggest-del" }).range(at.from, at.to))
    // Every line the edit touches carries the rule that joins it to the bar
    for (let n = state.doc.lineAt(at.from).number; n <= state.doc.lineAt(at.to).number; n++)
      decos.push(Decoration.line({ class: "suggest-line" }).range(state.doc.line(n).from))
    if (at.added) decos.push(Decoration.widget({ widget: new AddedWidget(at.added, at.to > at.from), side: 1 }).range(at.to))
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
