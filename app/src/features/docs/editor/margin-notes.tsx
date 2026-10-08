import { createRoot, type Root } from "react-dom/client"
import { StateEffect, StateField, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import type { AgentNote } from "../types"
import { NotesLayer, type Actions, type Placed } from "./NotesLayer"

// Agents' notes on a doc: a small marker in the right margin beside each passage's paragraph, opening a card.
// The note never enters the text; it finds its passage by the quoted words, using the text around them to
// choose between repeats, and says so when the passage is gone.

export const setNotes = StateEffect.define<AgentNote[]>()
const setOpen = StateEffect.define<string | null>()

const notesField = StateField.define<{ notes: AgentNote[]; open: string | null }>({
  create: () => ({ notes: [], open: null }),
  update(value, tr) {
    let { notes, open } = value
    for (const e of tr.effects) {
      if (e.is(setNotes)) notes = e.value
      if (e.is(setOpen)) open = e.value
    }
    if (open && !notes.some((n) => n.id === open)) open = null
    return notes === value.notes && open === value.open ? value : { notes, open }
  },
})

const sharedEnd = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
const sharedStart = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// Where the note's passage starts now, or null when the words are no longer there
function anchor(doc: string, note: AgentNote): number | null {
  let best: number | null = null
  let bestScore = -1
  for (let i = doc.indexOf(note.quote); i >= 0; i = doc.indexOf(note.quote, i + 1)) {
    const score =
      sharedEnd(doc.slice(Math.max(0, i - note.prefix.length), i), note.prefix) +
      sharedStart(doc.slice(i + note.quote.length, i + note.quote.length + note.suffix.length), note.suffix)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

// The open note's passage is tinted, so it's clear what the card is about
const passage = EditorView.decorations.compute([notesField, "doc"], (state) => {
  const { notes, open } = state.field(notesField)
  const note = notes.find((n) => n.id === open)
  const at = note ? anchor(state.doc.toString(), note) : null
  return note && at !== null ? Decoration.set([Decoration.mark({ class: "cm-note-passage" }).range(at, at + note.quote.length)]) : Decoration.none
})

export function marginNotes(actions: Actions): Extension {
  const layer = ViewPlugin.fromClass(
    class {
      dom: HTMLDivElement
      root: Root
      view: EditorView
      placed: Placed[] = []

      constructor(view: EditorView) {
        this.view = view
        this.dom = document.createElement("div")
        // Sits in the column's right gutter, just outside the text
        this.dom.className = "cm-notes-layer"
        view.dom.appendChild(this.dom)
        this.root = createRoot(this.dom)
        this.measure()
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.geometryChanged || u.viewportChanged || u.startState.field(notesField) !== u.state.field(notesField)) this.measure()
      }

      measure() {
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const { notes } = view.state.field(notesField)
            const doc = view.state.doc.toString()
            const base = view.documentTop - view.dom.getBoundingClientRect().top
            const used: number[] = []
            return notes.map((note) => {
              const at = anchor(doc, note)
              // A note whose passage is gone waits beside the title
              let top = base + view.lineBlockAt(at ?? 0).top + 2
              while (used.some((u) => Math.abs(u - top) < 24)) top += 26
              used.push(top)
              return { note, top, lost: at === null }
            })
          },
          write: (placed) => {
            this.placed = placed
            this.render()
          },
        })
      }

      render() {
        const { open } = this.view.state.field(notesField)
        const set = (id: string | null) => this.view.dispatch({ effects: setOpen.of(id) })
        this.root.render(
          <NotesLayer
            placed={this.placed}
            open={open}
            onToggle={(id) => set(open === id ? null : id)}
            onClose={() => set(null)}
            onChat={(note) => {
              set(null)
              actions.onChat(note)
            }}
            onDismiss={(note) => {
              set(null)
              actions.onDismiss(note)
            }}
          />,
        )
      }

      destroy() {
        const { root, dom } = this
        setTimeout(() => {
          root.unmount()
          dom.remove()
        })
      }
    },
  )

  const theme = EditorView.theme({
    ".cm-notes-layer": { position: "absolute", top: "0", right: "-26px", width: "22px" },
    ".cm-note-passage": { backgroundColor: "color-mix(in oklch, var(--foreground) 8%, transparent)", borderRadius: "3px" },
  })

  return [notesField, passage, layer, theme]
}
