import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"

// A slot under the doc's title for the line its citations get (DocEditor draws it there): after the first
// line when that is a heading, else before the text. Drawn only while there is a line to show.
export const showCitationsSlot = StateEffect.define<boolean>()

class Slot extends WidgetType {
  readonly sink: (el: HTMLElement | null) => void
  constructor(sink: (el: HTMLElement | null) => void) {
    super()
    this.sink = sink
  }
  // One slot for the doc's life, so the line drawn into it isn't drawn again on every edit
  eq() {
    return true
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = "cm-citations-slot"
    const resized = new ResizeObserver(() => view.requestMeasure())
    resized.observe(el)
    observers.set(el, resized)
    this.sink(el)
    return el
  }
  destroy(el: HTMLElement) {
    observers.get(el)?.disconnect()
    this.sink(null)
  }
  // Its buttons are the line's own
  ignoreEvent() {
    return true
  }
}
const observers = new WeakMap<HTMLElement, ResizeObserver>()

function placed(state: EditorState, widget: Slot): DecorationSet {
  const first = state.doc.line(1)
  const title = /^#{1,6}\s/.test(first.text)
  return Decoration.set([Decoration.widget({ widget, block: true, side: title ? 1 : -1 }).range(title ? first.to : 0)])
}

// sink: told of the slot's element when it is drawn, and null when it goes
export function citationsSlot(sink: (el: HTMLElement | null) => void): Extension {
  const widget = new Slot(sink)
  const field = StateField.define<{ shown: boolean; decos: DecorationSet }>({
    create: () => ({ shown: false, decos: Decoration.none }),
    update(value, tr) {
      let shown = value.shown
      for (const e of tr.effects) if (e.is(showCitationsSlot)) shown = e.value
      if (shown === value.shown && !tr.docChanged) return value
      return { shown, decos: shown ? placed(tr.state, widget) : Decoration.none }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })
  return field
}
