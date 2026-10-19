import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"

// A paragraph someone else wrote since the user last had the doc on screen, and who and when, as its hover
// says it
export interface ChangedLine {
  text: string
  title: string
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

function draw(state: EditorState, changed: ChangedLine[]): DecorationSet {
  if (!changed.length) return Decoration.none
  const byText = new Map(changed.map((c) => [c.text, c.title]))
  const decos: Range<Decoration>[] = []
  for (const p of paragraphs(state)) {
    const title = byText.get(p.text)
    if (title === undefined) continue
    for (let n = p.from; n <= p.to; n++) decos.push(Decoration.line({ class: "changed-line", attributes: { title } }).range(state.doc.line(n).from))
  }
  return Decoration.set(decos)
}

// A thin line in the margin beside each such paragraph (index.css › .changed-line). A paragraph edited
// since no longer reads as one of them, and loses its line.
export const changedSince = StateField.define<{ changed: ChangedLine[]; decos: DecorationSet }>({
  create: () => ({ changed: [], decos: Decoration.none }),
  update(value, tr) {
    const next = tr.effects.find((e) => e.is(setChanged))?.value
    if (next) return { changed: next, decos: draw(tr.state, next) }
    return tr.docChanged && value.changed.length ? { changed: value.changed, decos: draw(tr.state, value.changed) } : value
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decos),
})
