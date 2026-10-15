import { t } from "@lingui/core/macro"
import { ago } from "@/lib/time"
import { findAnchor } from "@owlit/protocol"
import type { Extension } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"
import { shorten } from "@/lib/words"
import type { AgentNote } from "../types"
import { renderInline } from "./render-inline"
import { anchoredCards, cardButton, sideCardFold, sideCardTheme, washOpen, type Spot } from "./side-card"

// Agents' notes on a doc. The words a note is on carry an underline in the note colour; clicking them opens
// the note under the paragraph, pushing the text down rather than covering it, and the words take a wash of
// the same colour while it is open. The note never enters the file. While the doc is open its passage
// follows every edit; when the doc is opened again it finds the passage by the quoted words and the text
// around them, and says so when the passage is gone.

type NoteSpot = Spot<AgentNote>

// Reading order: notes whose passage is gone first, as they sit by the title, then by where they start
const byPlace = (a: NoteSpot, b: NoteSpot) => (a.lost ? -1 : a.from) - (b.lost ? -1 : b.from)

interface Actions {
  onOpen: (id: string | null) => void
  onChat: (note: AgentNote) => void
  // `next` is the note to open after this one goes, if any
  onDismiss: (note: AgentNote, next: string | null) => void
  // Workspace links in the note's text: their short name, and opening one
  mentionLabel: (uri: string) => string | undefined
  onOpenMention: (uri: string) => void
}

// A bare owlit:// address an agent left in its words, not already a Markdown link's target
const BARE_URI = /(?<!\]\()owlit:\/\/[^\s)）\]]+/g

// The note's text as the rest of the doc draws Markdown: links, mentions, bold and code. A bare address
// becomes a mention under its short name ("Chan et al. 2026, p. 13"), never the raw owlit:// text.
function noteText(text: string, actions: Actions): HTMLElement {
  const p = document.createElement("p")
  p.className = "cm-note-text"
  renderInline(
    text.replace(BARE_URI, (uri) => {
      const label = actions.mentionLabel(uri)
      return label ? `[${label.replace(/[[\]]/g, "")}](${uri})` : uri
    }),
    p,
  )
  // The note is a widget CodeMirror leaves alone, so its mentions take their own clicks
  for (const el of p.querySelectorAll<HTMLElement>(".cm-mention[data-uri]")) {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault()
      actions.onOpenMention(el.dataset.uri!)
    })
  }
  return p
}

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
    return other.spot.item === this.spot.item && other.spot.lost === this.spot.lost && other.order.join() === this.order.join()
  }
  toDOM(view: EditorView) {
    const { item: note, lost } = this.spot
    const i = this.order.indexOf(note.id)
    const n = this.order.length
    const step = (by: number) => this.order[(i + by + n) % n]

    const box = document.createElement("div")
    box.className = "cm-note"

    // Who said it comes first, so the note never reads as the writer's own text
    const head = document.createElement("div")
    head.className = "cm-note-head"
    const meta = document.createElement("span")
    // Recent times relative, older ones a short date, as a reader's comment says it
    meta.textContent = `${note.by} · ${ago(note.createdAt)}`
    head.append(meta)
    if (n > 1) {
      const nav = document.createElement("span")
      nav.className = "cm-note-nav"
      const count = document.createElement("span")
      const at = i + 1
      count.textContent = t({ message: `${at} of ${n}`, comment: "which note of the doc's notes is open: 2 of 5" })
      const prev = cardButton("", () => this.actions.onOpen(step(-1)))
      prev.innerHTML = chevron("m15 18-6-6 6-6")
      prev.setAttribute("aria-label", t`Previous note`)
      prev.title = t`Previous note`
      const next = cardButton("", () => this.actions.onOpen(step(1)))
      next.innerHTML = chevron("m9 18 6-6-6-6")
      next.setAttribute("aria-label", t`Next note`)
      next.title = t`Next note`
      nav.append(count, prev, next)
      head.append(nav)
    }
    box.append(head)

    if (lost) {
      const gone = document.createElement("p")
      gone.className = "cm-note-lost"
      const passage = shorten(note.quote, 90)
      gone.textContent = t`The passage this note was on has changed: “${passage}”`
      box.append(gone)
    }
    const text = noteText(note.text, this.actions)

    const actions = document.createElement("div")
    actions.className = "cm-note-actions"
    actions.append(
      cardButton(t`Dismiss`, () => this.actions.onDismiss(note, n > 1 ? step(1) : null)),
      cardButton(t`Chat about this`, () => this.actions.onChat(note)),
    )
    box.append(text, actions)

    return sideCardFold(view, box, "cm-note-fold")
  }
  ignoreEvent() {
    return true
  }
}

const notes = anchoredCards<AgentNote, Actions>({
  attr: "note",
  mark: "cm-note-mark",
  id: (note) => note.id,
  // A note opened again finds its passage by the quoted words and the text around them
  find: (text, note) => {
    const at = findAnchor(text, note)
    return at === null ? null : { from: at, to: at + note.quote.length }
  },
  card: (opened, spots, actions) => new NoteWidget(opened, [...spots].sort(byPlace).map((s) => s.item.id), actions),
})

export const { setItems: setNotes, setOpen: setOpenNote } = notes

// The doc's notes as they sit now, for saving their moved passages back to the store
export const noteSpots = notes.spotsOf

export function agentNotes(actions: Actions): Extension {
  const theme = EditorView.theme({
    // The passage underlined and the open note's card in Owlit's mark green (side-card.ts). A doc's own
    // ==highlights== are a different, lemon yellow, so the two never pass for each other.
    ...sideCardTheme("cm-note", "var(--owlit-mark)"),
    ".cm-note-mark-open": { backgroundColor: "color-mix(in oklch, var(--owlit-mark) 22%, transparent)", animation: washOpen },
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
    ".cm-note-actions button:last-child": { color: "var(--foreground)" },
  })

  return [notes.extension(actions), theme]
}
