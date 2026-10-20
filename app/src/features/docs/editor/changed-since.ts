import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"

// A paragraph someone else wrote since the user last had the doc on screen, and who and when, as its hover
// says it; or one they removed, after the paragraph it followed (null: at the top)
export interface ChangedLine {
  text: string
  title: string
  removed?: { after: string | null }
}

// Where a removed paragraph was: an empty mark in the margin between the paragraphs either side
class RemovedMark extends WidgetType {
  readonly title: string
  constructor(title: string) {
    super()
    this.title = title
  }
  eq(other: RemovedMark) {
    return other.title === this.title
  }
  toDOM() {
    const el = document.createElement("div")
    el.className = "changed-removed"
    el.title = this.title
    el.setAttribute("aria-label", this.title)
    return el
  }
}

export const setChanged = StateEffect.define<ChangedLine[]>()

// The paragraphs of the doc: runs of non-blank lines, with their text trimmed as core compares them
// (changes/passages.ts)
function paragraphs(state: EditorState) {
  const out: { from: number; to: number; text: string }[] = []
  let start: number | null = null
  for (let n = 1; n <= state.doc.lines + 1; n++) {
    const blank = n > state.doc.lines || !state.doc.line(n).text.trim()
    if (blank && start !== null) {
      const from = state.doc.line(start).from
      const to = state.doc.line(n - 1).to
      out.push({ from: start, to: n - 1, text: state.sliceDoc(from, to).trim() })
      start = null
    } else if (!blank && start === null) start = n
  }
  return out
}

// Where each marked paragraph is in the doc now (lines, as positions), and where each removed one was
// (from = to). A paragraph that no longer reads as it did has no place, nor does what followed it.
export interface ChangedPlace {
  key: string
  from: number
  to: number
  line: ChangedLine
  // Before or after the position, for a removed paragraph's mark
  side?: number
}

export function changedPlaces(state: EditorState, changed: ChangedLine[]): ChangedPlace[] {
  if (!changed.length) return []
  const written = new Map(changed.flatMap((c) => (c.removed ? [] : [[c.text, c] as const])))
  const removed = changed.filter((c) => c.removed)
  const out: ChangedPlace[] = removed.filter((c) => c.removed!.after === null).map((c) => ({ key: `removed:${c.text}`, from: 0, to: 0, line: c, side: -1 }))
  for (const p of paragraphs(state)) {
    const line = written.get(p.text)
    if (line) out.push({ key: `written:${p.text}`, from: state.doc.line(p.from).from, to: state.doc.line(p.to).to, line })
    const end = state.doc.line(p.to).to
    for (const c of removed) if (c.removed!.after === p.text) out.push({ key: `removed:${c.text}`, from: end, to: end, line: c, side: 1 })
  }
  return out
}

function draw(state: EditorState, changed: ChangedLine[]): DecorationSet {
  const decos: Range<Decoration>[] = []
  for (const place of changedPlaces(state, changed)) {
    if (place.line.removed) decos.push(Decoration.widget({ widget: new RemovedMark(place.line.title), block: true, side: place.side ?? 1 }).range(place.from))
    else
      for (let n = state.doc.lineAt(place.from).number; n <= state.doc.lineAt(place.to).number; n++)
        decos.push(Decoration.line({ class: "changed-line", attributes: { title: place.line.title } }).range(state.doc.line(n).from))
  }
  return Decoration.set(decos, true)
}

// A thin line in the margin beside each such paragraph (index.css › .changed-line), and a short empty
// one where a paragraph was removed (.changed-removed). A paragraph edited since no longer reads as one
// of them, and loses its line.
export const changedSince = StateField.define<{ changed: ChangedLine[]; decos: DecorationSet }>({
  create: () => ({ changed: [], decos: Decoration.none }),
  update(value, tr) {
    const next = tr.effects.find((e) => e.is(setChanged))?.value
    if (next) return { changed: next, decos: draw(tr.state, next) }
    return tr.docChanged && value.changed.length ? { changed: value.changed, decos: draw(tr.state, value.changed) } : value
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decos),
})
