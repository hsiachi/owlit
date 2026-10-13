import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import { suggestionBar, type PendingEdit } from "@/features/chat/pending-edits"
import { diffParts, editStats } from "@owlit/protocol"
import { hunk } from "@/lib/text-diff"
import { renderInline } from "./render-inline"

// An agent's proposed edit to the doc (a PendingEdit), drawn in place

// Where text occurs exactly once in the doc, or -1
function only(doc: string, text: string) {
  const i = doc.indexOf(text)
  return i >= 0 && doc.indexOf(text, i + 1) < 0 ? i : -1
}

export interface Spot {
  from: number
  to: number
  added: string
}

// Where one part of the edit sits in the doc as it is now; null once the passage has changed. The whole
// passage the agent quoted pins the part down first: a pure insertion removes nothing, so it has nothing
// else to go by.
function locatePart(doc: string, oldText: string, newText: string): Spot | null {
  const h = hunk(oldText, newText)
  const base = doc === oldText ? 0 : oldText ? only(doc, oldText) : -1
  if (base >= 0) return { from: base + h.at, to: base + h.at + h.removed.length, added: h.added }
  if (!h.removed) return null
  const i = only(doc, h.removed)
  if (i < 0) return null
  return { from: i, to: i + h.removed.length, added: h.added }
}

// Where each part of the edit sits (an agent may change several places in one go); null when any part
// can't be found, or when the edit would replace most of the doc: struck through in place, a rewrite
// can't be read, so the chat's card shows it instead
export function editSpots(state: EditorState, edit: PendingEdit): Spot[] | null {
  const doc = state.doc.toString()
  const spots: Spot[] = []
  for (const part of diffParts(edit.oldText, edit.newText)) {
    const spot = locatePart(doc, part.oldText, part.newText)
    if (!spot) return null
    spots.push(spot)
  }
  spots.sort((a, b) => a.from - b.from)
  if (spots.some((s, i) => i > 0 && s.from < spots[i - 1].to)) return null
  let after = ""
  let last = 0
  for (const s of spots) {
    after += doc.slice(last, s.from) + s.added
    last = s.to
  }
  after += doc.slice(last)
  return editStats(edit.path, doc, after).rewritten ? null : spots
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

function build(state: EditorState, edits: PendingEdit[], respond: (edit: PendingEdit, apply: boolean) => void) {
  const decos: Range<Decoration>[] = []
  const drawn: string[] = []
  for (const edit of edits) {
    const spots = editSpots(state, edit)
    if (!spots?.length) continue
    drawn.push(edit.requestId)
    for (const at of spots) {
      if (at.to > at.from) decos.push(Decoration.mark({ class: "suggest-del" }).range(at.from, at.to))
      // Every line the edit touches carries the rule that joins it to the bar
      for (let n = state.doc.lineAt(at.from).number; n <= state.doc.lineAt(at.to).number; n++)
        decos.push(Decoration.line({ class: "suggest-line" }).range(state.doc.line(n).from))
      if (at.added) decos.push(Decoration.widget({ widget: new AddedWidget(at.added, at.to > at.from), side: 1 }).range(at.to))
    }
    // One bar for the whole edit, under the last place it changes
    decos.push(Decoration.widget({ widget: new BarWidget(edit, respond), block: true, side: 1 }).range(state.doc.lineAt(spots[spots.length - 1].to).to))
  }
  return { decos: Decoration.set(decos, true), drawn }
}

// `onDrawn` hears which edits are drawn (by request) whenever that changes, as the edits come and go and
// the doc is typed in
export function agentSuggestions(respond: (edit: PendingEdit, apply: boolean) => void, onDrawn: (requestIds: string[]) => void): Extension {
  const field = StateField.define<{ edits: PendingEdit[]; decos: DecorationSet; drawn: string[] }>({
    create: () => ({ edits: [], decos: Decoration.none, drawn: [] }),
    update(value, tr) {
      let edits = value.edits
      for (const e of tr.effects) if (e.is(setPendingEdits)) edits = e.value
      if (edits === value.edits && !tr.docChanged) return value
      return { edits, ...build(tr.state, edits, respond) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })
  return [
    field,
    EditorView.updateListener.of((u) => {
      const drawn = u.state.field(field).drawn
      if (drawn !== u.startState.field(field).drawn) onDrawn(drawn)
    }),
  ]
}
