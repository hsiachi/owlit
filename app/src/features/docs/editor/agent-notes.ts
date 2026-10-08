import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view"
import type { AgentNote } from "../types"

// Agents' notes on a doc. The words a note is on carry an underline in the note colour; clicking them opens
// the note under the paragraph, pushing the text down rather than covering it, and the words take a wash of
// the same colour while it is open. The note never enters the file. While the doc is open its passage
// follows every edit; when the doc is opened again it finds the passage by the quoted words and the text
// around them, and says so when the passage is gone.

export const setNotes = StateEffect.define<AgentNote[]>()
export const setOpenNote = StateEffect.define<string | null>()

// Where a note sits in the doc now. A lost note has no passage and sits on the title line.
export interface NoteSpot {
  note: AgentNote
  from: number
  to: number
  lost: boolean
}

interface NotesState {
  spots: NoteSpot[]
  open: string | null
  decos: DecorationSet
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

// Where the note's passage starts in this text, or null when the words are no longer there
export function anchor(doc: string, note: AgentNote): number | null {
  if (!note.quote) return null
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

const lostSpot = (state: EditorState, note: AgentNote): NoteSpot => ({ note, from: 0, to: state.doc.line(1).to, lost: true })

function locate(state: EditorState, note: AgentNote): NoteSpot {
  const at = anchor(state.doc.toString(), note)
  return at === null ? lostSpot(state, note) : { note, from: at, to: at + note.quote.length, lost: false }
}

// Reading order: notes whose passage is gone first, as they sit by the title, then by where they start
const byPlace = (a: NoteSpot, b: NoteSpot) => (a.lost ? -1 : a.from) - (b.lost ? -1 : b.from)

interface Actions {
  onOpen: (id: string | null) => void
  onChat: (note: AgentNote) => void
  // `next` is the note to open after this one goes, if any
  onDismiss: (note: AgentNote, next: string | null) => void
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })

const chevron = (d: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`

// The open note, under its paragraph: who wrote it and when (and where it is among the doc's notes), the
// note, then what to do with it
class NoteWidget extends WidgetType {
  readonly spot: NoteSpot
  readonly order: string[]
  readonly actions: Actions
  constructor(spot: NoteSpot, order: string[], actions: Actions) {
    super()
    this.spot = spot
    this.order = order
    this.actions = actions
  }
  eq(other: NoteWidget) {
    return other.spot.note === this.spot.note && other.spot.lost === this.spot.lost && other.order.join() === this.order.join()
  }
  toDOM() {
    const { note, lost } = this.spot
    const i = this.order.indexOf(note.id)
    const n = this.order.length
    const step = (by: number) => this.order[(i + by + n) % n]

    const button = (label: string, run: () => void, className?: string) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = label
      if (className) b.className = className
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = run
      return b
    }

    const box = document.createElement("div")
    box.className = "cm-note"

    // Who said it comes first, so the note never reads as the writer's own text
    const head = document.createElement("div")
    head.className = "cm-note-head"
    const meta = document.createElement("span")
    meta.textContent = `${note.by} · ${day(note.createdAt)}`
    head.append(meta)
    if (n > 1) {
      const nav = document.createElement("span")
      nav.className = "cm-note-nav"
      const count = document.createElement("span")
      count.textContent = `${i + 1} of ${n}`
      const prev = button("", () => this.actions.onOpen(step(-1)))
      prev.innerHTML = chevron("m15 18-6-6 6-6")
      prev.setAttribute("aria-label", "Previous note")
      prev.title = "Previous note"
      const next = button("", () => this.actions.onOpen(step(1)))
      next.innerHTML = chevron("m9 18 6-6-6-6")
      next.setAttribute("aria-label", "Next note")
      next.title = "Next note"
      nav.append(count, prev, next)
      head.append(nav)
    }
    box.append(head)

    if (lost) {
      const gone = document.createElement("p")
      gone.className = "cm-note-lost"
      const q = note.quote
      gone.textContent = `The passage this note was on has changed: “${q.length > 90 ? `${q.slice(0, 90)}…` : q}”`
      box.append(gone)
    }
    const text = document.createElement("p")
    text.className = "cm-note-text"
    text.textContent = note.text

    const actions = document.createElement("div")
    actions.className = "cm-note-actions"
    actions.append(
      button("Dismiss", () => this.actions.onDismiss(note, n > 1 ? step(1) : null)),
      button("Chat about this", () => this.actions.onChat(note)),
    )
    box.append(text, actions)
    return box
  }
  ignoreEvent() {
    return true
  }
}

const noteActions = Facet.define<Actions, Actions>({ combine: (values) => values[0] })

const notesField = StateField.define<NotesState>({
  create: () => ({ spots: [], open: null, decos: Decoration.none }),
  update(value, tr) {
    let { spots, open } = value
    // While the doc is open a passage follows the edits: text typed at either end stays outside it, and a
    // passage deleted whole is lost
    if (tr.docChanged)
      spots = spots.map((s) => {
        if (s.lost) return lostSpot(tr.state, s.note)
        const from = tr.changes.mapPos(s.from, 1)
        const to = tr.changes.mapPos(s.to, -1)
        return to > from ? { ...s, from, to } : lostSpot(tr.state, s.note)
      })
    for (const e of tr.effects) {
      if (e.is(setNotes)) {
        const kept = new Map(spots.map((s) => [s.note.id, s]))
        spots = e.value.map((note) => {
          const spot = kept.get(note.id)
          return spot ? { ...spot, note } : locate(tr.state, note)
        })
      }
      if (e.is(setOpenNote)) open = e.value
    }
    if (open && !spots.some((s) => s.note.id === open)) open = null
    if (spots === value.spots && open === value.open) return value

    const order = [...spots].sort(byPlace).map((s) => s.note.id)
    const decos: Range<Decoration>[] = []
    for (const s of spots) {
      if (s.lost) continue
      const isOpen = s.note.id === open
      decos.push(
        Decoration.mark({ class: isOpen ? "cm-note-mark cm-note-mark-open" : "cm-note-mark", attributes: { "data-note": s.note.id } }).range(s.from, s.to),
      )
    }
    const opened = spots.find((s) => s.note.id === open)
    if (opened)
      decos.push(
        Decoration.widget({ widget: new NoteWidget(opened, order, tr.state.facet(noteActions)), block: true, side: 1 }).range(tr.state.doc.lineAt(opened.to).to),
      )
    return { spots, open, decos: Decoration.set(decos, true) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
})

// The doc's notes as they sit now, for saving their moved passages back to the store
export function noteSpots(state: EditorState): NoteSpot[] {
  return state.field(notesField, false)?.spots ?? []
}

export function agentNotes(actions: Actions): Extension {
  // A click on underlined words opens their note, and the caret lands where it was clicked as usual; a
  // click anywhere else in the text puts the open note away. Moving the caret in by keyboard opens nothing,
  // so a note never springs open while the writer types.
  const clicks = EditorView.domEventHandlers({
    click(e, view) {
      if (e.button !== 0 || !view.state.selection.main.empty) return false
      const id = (e.target as HTMLElement).closest?.("[data-note]")?.getAttribute("data-note") ?? null
      const { open } = view.state.field(notesField)
      if (id !== open && (id || open)) actions.onOpen(id)
      return false
    },
  })

  // Esc puts an open note away
  const esc = keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!view.state.field(notesField).open) return false
        actions.onOpen(null)
        return true
      },
    },
  ])

  const theme = EditorView.theme({
    // The passage: a 2px underline in the note colour, and a wash of it while the note is open. A doc's own
    // ==highlights== are a different, lemon yellow, so the two never pass for each other.
    ".cm-note-mark": {
      textDecorationLine: "underline",
      textDecorationColor: "var(--note)",
      textDecorationThickness: "2px",
      textUnderlineOffset: "5px",
      textDecorationSkipInk: "none",
    },
    ".cm-note-mark-open": { backgroundColor: "color-mix(in oklch, var(--note) 24%, transparent)" },
    // The open note is plainly not the doc: a raised card under the paragraph with a rule in the note
    // colour at its left edge. Who wrote it comes first, the actions sit at the bottom right.
    ".cm-note": {
      margin: "4px 0 14px -16px",
      padding: "8px 12px 6px 13px",
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderLeft: "3px solid var(--note)",
      borderRadius: "4px 10px 10px 4px",
      fontSize: "14px",
      lineHeight: "1.55",
      cursor: "default",
    },
    ".cm-note p": { margin: "0" },
    ".cm-note-head": { display: "flex", alignItems: "center", gap: "8px", minHeight: "20px", marginBottom: "2px", fontSize: "12px", color: "var(--muted-foreground)" },
    ".cm-note-head > span:first-child": { flex: "1" },
    ".cm-note-nav": { display: "flex", alignItems: "center", gap: "2px", marginRight: "-6px" },
    ".cm-note-nav > span": { marginRight: "4px" },
    ".cm-note-nav button": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "24px",
      height: "24px",
      borderRadius: "6px",
      background: "none",
      border: "none",
      color: "var(--muted-foreground)",
      cursor: "pointer",
    },
    ".cm-note-nav button:hover": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
    ".cm-note-lost": { fontSize: "13px", color: "var(--muted-foreground)", marginBottom: "4px !important" },
    ".cm-note-actions": { display: "flex", justifyContent: "flex-end", gap: "2px", marginTop: "4px", marginRight: "-6px" },
    ".cm-note-actions button": {
      height: "26px",
      padding: "0 8px",
      borderRadius: "8px",
      fontSize: "13px",
      background: "none",
      border: "none",
      color: "var(--muted-foreground)",
      cursor: "pointer",
    },
    ".cm-note-actions button:hover": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
    ".cm-note-actions button:last-child": { color: "var(--foreground)" },
  })

  return [noteActions.of(actions), notesField, clicks, esc, theme]
}
