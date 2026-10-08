import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view"
import type { AgentNote } from "../types"

// Agents' notes on a doc. A thin rule in the left margin runs beside the passage a note is on; clicking it
// opens the note in the text flow under the paragraph, pushing the text down rather than covering it. The
// note never enters the file: it finds its passage by the quoted words and the text around them, and says
// so when the passage is gone.

export const setNotes = StateEffect.define<AgentNote[]>()
export const setOpenNote = StateEffect.define<string | null>()

interface NotesState {
  notes: AgentNote[]
  open: string | null
}

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
export function anchor(doc: string, note: AgentNote): number | null {
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

// Each note's passage as it sits in the doc now; a lost note sits on the title line
function place(state: EditorState, notes: AgentNote[]) {
  const doc = state.doc.toString()
  return notes.map((note) => {
    const at = anchor(doc, note)
    return at === null ? { note, from: 0, to: state.doc.line(1).to, lost: true } : { note, from: at, to: at + note.quote.length, lost: false }
  })
}

interface Actions {
  onOpen: (id: string | null) => void
  onChat: (note: AgentNote) => void
  onDismiss: (note: AgentNote) => void
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })

// The open note, under its paragraph: the note, then one muted line with who, when and what to do
class NoteWidget extends WidgetType {
  readonly note: AgentNote
  readonly lost: boolean
  readonly actions: Actions
  constructor(note: AgentNote, lost: boolean, actions: Actions) {
    super()
    this.note = note
    this.lost = lost
    this.actions = actions
  }
  eq(other: NoteWidget) {
    return other.note === this.note && other.lost === this.lost
  }
  toDOM() {
    const box = document.createElement("div")
    box.className = "cm-note"
    if (this.lost) {
      const gone = document.createElement("p")
      gone.className = "cm-note-lost"
      const q = this.note.quote
      gone.textContent = `The passage this note was on has changed: “${q.length > 90 ? `${q.slice(0, 90)}…` : q}”`
      box.append(gone)
    }
    const text = document.createElement("p")
    text.className = "cm-note-text"
    text.textContent = this.note.text
    const meta = document.createElement("p")
    meta.className = "cm-note-meta"
    const action = (label: string, run: () => void) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = label
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = run
      return b
    }
    meta.append(
      `${this.note.by} · ${day(this.note.createdAt)} · `,
      action("Chat about this", () => this.actions.onChat(this.note)),
      " · ",
      action("Dismiss", () => this.actions.onDismiss(this.note)),
    )
    box.append(text, meta)
    return box
  }
  ignoreEvent() {
    return true
  }
}

export function marginNotes(actions: Actions): Extension {
  const field = StateField.define<NotesState & { decos: DecorationSet }>({
    create: () => ({ notes: [], open: null, decos: Decoration.none }),
    update(value, tr) {
      let { notes, open } = value
      for (const e of tr.effects) {
        if (e.is(setNotes)) notes = e.value
        if (e.is(setOpenNote)) open = e.value
      }
      if (open && !notes.some((n) => n.id === open)) open = null
      if (notes === value.notes && open === value.open && !tr.docChanged) return value
      const decos: Range<Decoration>[] = []
      const opened = place(tr.state, notes).find((p) => p.note.id === open)
      if (opened) decos.push(Decoration.widget({ widget: new NoteWidget(opened.note, opened.lost, actions), block: true, side: 1 }).range(tr.state.doc.lineAt(opened.to).to))
      return { notes, open, decos: Decoration.set(decos) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })

  // The rules in the left margin, drawn over the editor rather than in the text
  const bars = ViewPlugin.fromClass(
    class {
      dom: HTMLDivElement
      view: EditorView
      constructor(view: EditorView) {
        this.view = view
        this.dom = document.createElement("div")
        this.dom.className = "cm-note-bars"
        view.dom.appendChild(this.dom)
        this.measure()
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.geometryChanged || u.viewportChanged || u.startState.field(field) !== u.state.field(field)) this.measure()
      }
      measure() {
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const { notes, open } = view.state.field(field)
            const base = view.documentTop - view.dom.getBoundingClientRect().top
            // The visual lines the passage covers, from the block structure (works outside the viewport too)
            const span = (from: number, to: number) => {
              const a = view.coordsAtPos(from, 1)
              const b = view.coordsAtPos(to, -1)
              const top = a ? a.top - view.documentTop : view.lineBlockAt(from).top
              const bottom = b ? b.bottom - view.documentTop : view.lineBlockAt(to).bottom
              return { top: base + top + 2, height: Math.max(12, bottom - top - 4) }
            }
            return place(view.state, notes).map((p) => ({ id: p.note.id, by: p.note.by, open: p.note.id === open, ...span(p.from, p.to) }))
          },
          write: (placed) => {
            this.dom.replaceChildren(
              ...placed.map((p) => {
                const hit = document.createElement("button")
                hit.type = "button"
                hit.className = `cm-note-bar${p.open ? " cm-note-bar-open" : ""}`
                hit.style.top = `${p.top}px`
                hit.style.height = `${p.height}px`
                hit.setAttribute("aria-label", `Note from ${p.by}`)
                hit.setAttribute("aria-expanded", String(p.open))
                hit.title = `Note from ${p.by}`
                hit.onmousedown = (e) => e.preventDefault()
                hit.onclick = () => actions.onOpen(p.open ? null : p.id)
                return hit
              }),
            )
          },
        })
      }
      destroy() {
        this.dom.remove()
      }
    },
  )

  // Esc puts an open note away
  const esc = keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(field).open) return false
        actions.onOpen(null)
        return true
      },
    },
  ])

  const theme = EditorView.theme({
    // The gutter rule: 2px, quiet until hovered or open; the button around it is the click target
    ".cm-note-bars": { position: "absolute", top: "0", left: "-19px", width: "12px" },
    ".cm-note-bar": { position: "absolute", left: "0", width: "12px", padding: "0", background: "none", border: "none", cursor: "pointer" },
    ".cm-note-bar::before": {
      content: '""',
      position: "absolute",
      left: "5px",
      top: "0",
      bottom: "0",
      width: "2px",
      borderRadius: "1px",
      backgroundColor: "color-mix(in oklch, var(--foreground) 32%, transparent)",
      transition: "background-color 0.15s",
    },
    ".cm-note-bar:hover::before, .cm-note-bar-open::before": { backgroundColor: "color-mix(in oklch, var(--foreground) 60%, transparent)" },
    // The open note reads as the margin rule running on from the passage into it: no box, no shadow, a 14px
    // note and one muted line, the text lined up with the body
    ".cm-note": {
      margin: "2px 0 14px -14px",
      padding: "2px 0 2px 12px",
      borderLeft: "2px solid color-mix(in oklch, var(--foreground) 60%, transparent)",
      fontSize: "14px",
      lineHeight: "1.55",
      cursor: "default",
    },
    ".cm-note p": { margin: "0" },
    ".cm-note-lost": { fontSize: "13px", color: "var(--muted-foreground)", marginBottom: "4px !important" },
    ".cm-note-meta": { marginTop: "4px !important", fontSize: "13px", color: "var(--muted-foreground)" },
    ".cm-note-meta button": { padding: "0", background: "none", border: "none", color: "inherit", cursor: "pointer" },
    ".cm-note-meta button:hover": { color: "var(--foreground)" },
  })

  return [field, bars, esc, theme]
}
