import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range, type Text } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, keymap } from "@codemirror/view"
import type { CommentView } from "../comments/model"

// The words each comment is on, in the doc: a 2px underline in the comment colour, the same whoever wrote
// it, and a wash while its card is open in the column (or while the pointer is on its card there). The
// cards themselves are drawn beside the doc (comments/CommentColumn.tsx); this says where each comment's
// words are, so its card can sit level with them. Nothing here enters the file.
//
// While the doc is open a passage follows the edits: text typed at either end stays outside it, and a
// passage deleted whole is lost until its words come back (an undo). A lost comment sits by the title.
//
// When the page is too narrow for the column, the open card goes into the text instead: a slot under the
// paragraph its words are in, which pushes the lines below down rather than covering them. The slot is an
// empty element here; the column draws the card into it (comments/CommentColumn.tsx).

export interface CommentSpot {
  item: CommentView
  from: number
  to: number
  lost: boolean
}

// The comment being started on selected words: its range, mapped through edits until it is saved
export const NEW_KEY = "new"

export const setComments = StateEffect.define<CommentView[]>()
export const setOpenComment = StateEffect.define<string | null>()
export const setHotComment = StateEffect.define<string | null>()
export const setNewComment = StateEffect.define<{ from: number; to: number } | null>()
// The open card goes in the text, under its paragraph (the column has folded to pins)
export const setInlineCards = StateEffect.define<boolean>()

// Told of the slot for the open card when one is drawn (the element), and when it goes (null with it)
const slotSink = Facet.define<(el: HTMLElement | null, was?: HTMLElement) => void, (el: HTMLElement | null, was?: HTMLElement) => void>({
  combine: (values) => values[0] ?? (() => {}),
})

// What each drawn slot was told to and watched by, kept by its element: a widget that compares equal to
// the one before takes over its element, so the instance that drew it may not be the one destroying it
const slots = new WeakMap<HTMLElement, { sink: (el: HTMLElement | null, was?: HTMLElement) => void; resized: ResizeObserver }>()

class CardSlot extends WidgetType {
  readonly key: string
  constructor(key: string) {
    super()
    this.key = key
  }
  // The same comment keeps its element, so the card drawn into it isn't drawn again on every edit
  eq(other: CardSlot) {
    return other.key === this.key
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div")
    el.className = "cm-comment-slot"
    // The card in it changes height as it is drawn and typed into; the editor measures its lines again
    const resized = new ResizeObserver(() => view.requestMeasure())
    resized.observe(el)
    const sink = view.state.facet(slotSink)
    slots.set(el, { sink, resized })
    sink(el)
    return el
  }
  destroy(el: HTMLElement) {
    const slot = slots.get(el)
    slot?.resized.disconnect()
    // Only the element that went is let go, whichever slot was drawn meanwhile
    slot?.sink(null, el)
  }
  get estimatedHeight() {
    return 160
  }
  // Typing and clicking in the card are the card's own
  ignoreEvent() {
    return true
  }
}

interface MarksState {
  spots: CommentSpot[]
  open: string | null
  hot: string | null
  draft: { from: number; to: number } | null
  inline: boolean
  marks: DecorationSet
}

const lostSpot = (state: EditorState, item: CommentView): CommentSpot => ({ item, from: 0, to: state.doc.line(1).to, lost: true })

function draw(s: Omit<MarksState, "marks">, doc: Text): DecorationSet {
  const marks: Range<Decoration>[] = []
  for (const spot of s.spots) {
    if (spot.lost) continue
    const key = spot.item.key
    const cls = ["cm-comment-mark", key === s.open && "cm-comment-mark-open", key === s.hot && "cm-comment-mark-hot"].filter(Boolean).join(" ")
    marks.push(Decoration.mark({ class: cls, attributes: { "data-comment": key } }).range(spot.from, spot.to))
  }
  if (s.draft && s.draft.to > s.draft.from) marks.push(Decoration.mark({ class: "cm-comment-mark cm-comment-mark-open" }).range(s.draft.from, s.draft.to))
  if (s.inline) {
    // A lost comment's card goes under the title, where its pin is
    const spot = s.spots.find((x) => x.item.key === s.open)
    const openSpot = s.draft ? { key: NEW_KEY, to: s.draft.to } : spot ? { key: spot.item.key, to: spot.to } : null
    // After the line its words end on: a paragraph is one line in the editor, however many it wraps to
    if (openSpot) marks.push(Decoration.widget({ widget: new CardSlot(openSpot.key), block: true, side: 1 }).range(doc.lineAt(openSpot.to).to))
  }
  return Decoration.set(marks, true)
}

const field = StateField.define<MarksState>({
  create: () => ({ spots: [], open: null, hot: null, draft: null, inline: false, marks: Decoration.none }),
  update(value, tr) {
    let { spots, open, hot, draft, inline } = value
    // The doc's text is read once per change, however many passages are looked for in it
    let text: string | undefined
    const locate = (item: CommentView): CommentSpot => {
      const at = item.find((text ??= tr.state.doc.toString()))
      return at ? { item, from: at.from, to: at.to, lost: false } : lostSpot(tr.state, item)
    }
    if (tr.docChanged) {
      spots = spots.map((s) => {
        if (s.lost) return locate(s.item)
        const from = tr.changes.mapPos(s.from, 1)
        const to = tr.changes.mapPos(s.to, -1)
        return to > from ? { ...s, from, to } : lostSpot(tr.state, s.item)
      })
      if (draft) draft = { from: tr.changes.mapPos(draft.from, 1), to: tr.changes.mapPos(draft.to, -1) }
    }
    for (const e of tr.effects) {
      if (e.is(setComments)) {
        const kept = new Map(spots.map((s) => [s.item.key, s]))
        spots = e.value.map((item) => {
          const spot = kept.get(item.key)
          return spot ? { ...spot, item } : locate(item)
        })
      }
      if (e.is(setOpenComment)) open = e.value
      if (e.is(setHotComment)) hot = e.value
      if (e.is(setNewComment)) draft = e.value
      if (e.is(setInlineCards)) inline = e.value
    }
    if (spots === value.spots && open === value.open && hot === value.hot && draft === value.draft && inline === value.inline) return value
    return { spots, open, hot, draft, inline, marks: draw({ spots, open, hot, draft, inline }, tr.state.doc) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.marks),
})

export const commentSpots = (state: EditorState): CommentSpot[] => state.field(field, false)?.spots ?? []
export const newCommentRange = (state: EditorState) => state.field(field, false)?.draft ?? null

// Where each comment's words start, in px below the top of the editor: the first line of its passage, or
// the title's line for a lost one. Also the new comment's, under NEW_KEY.
export type CommentTops = Record<string, { top: number; lost: boolean }>

function measureTops(view: EditorView): CommentTops {
  const { spots, draft } = view.state.field(field)
  // From the editor's own top: the column beside it starts at the same height. A paragraph is one line
  // block however many lines it wraps to, so the words' own screen line is read where it is drawn; outside
  // the drawn part of the doc, its paragraph's top stands in until it scrolls into view.
  const editorTop = view.dom.getBoundingClientRect().top
  const base = view.documentTop - editorTop
  const top = (pos: number) => {
    const drawn = pos >= view.viewport.from && pos <= view.viewport.to ? view.coordsAtPos(pos, 1) : null
    return drawn ? drawn.top - editorTop : base + view.lineBlockAt(pos).top
  }
  const tops: CommentTops = {}
  for (const s of spots) tops[s.item.key] = { top: top(s.from), lost: s.lost }
  if (draft) tops[NEW_KEY] = { top: top(draft.from), lost: false }
  return tops
}

interface Actions {
  onOpen: (key: string | null) => void
  // The slot the open card is drawn into while cards go in the text; null when it goes
  onSlot: (el: HTMLElement | null, was?: HTMLElement) => void
  // Where the words are now, after any edit, wrap or resize
  onLayout: (tops: CommentTops) => void
}

export function commentMarks(actions: Actions): Extension {
  // A click on underlined words opens their comment; a click anywhere else in the text puts the open
  // one away. The caret lands where it was clicked as usual, and moving it by keyboard opens nothing, so a
  // card never springs open while the writer types.
  const clicks = EditorView.domEventHandlers({
    click(e, view) {
      if (e.button !== 0 || !view.state.selection.main.empty) return false
      const clicked = (e.target as HTMLElement).closest?.("[data-comment]")?.getAttribute("data-comment") ?? null
      const { open } = view.state.field(field)
      if (clicked !== open && (clicked || open)) actions.onOpen(clicked)
      return false
    },
  })
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
  // Heights are read in CodeMirror's measure phase, after it has laid out the lines, and only told on when
  // something moved
  const layout = ViewPlugin.fromClass(
    class {
      last = ""
      constructor(view: EditorView) {
        this.schedule(view)
      }
      update(u: { view: EditorView; docChanged: boolean; geometryChanged: boolean; viewportChanged: boolean; startState: EditorState; state: EditorState }) {
        if (u.docChanged || u.geometryChanged || u.viewportChanged || u.startState.field(field) !== u.state.field(field)) this.schedule(u.view)
      }
      schedule(view: EditorView) {
        view.requestMeasure({
          key: this,
          read: (v) => measureTops(v),
          write: (tops) => {
            const sig = JSON.stringify(tops)
            if (sig === this.last) return
            this.last = sig
            actions.onLayout(tops)
          },
        })
      }
    },
  )
  const theme = EditorView.theme({
    // Below and thicker than a link's underline; the comment colour is the same whoever wrote it (index.css
    // --comment-mark). A doc's own ==highlights== are a fill, never an underline, so the two can't pass for
    // each other.
    ".cm-comment-mark": {
      textDecorationLine: "underline",
      textDecorationColor: "var(--comment-mark)",
      textDecorationThickness: "2px",
      textUnderlineOffset: "5px",
      textDecorationSkipInk: "none",
      transition: "background-color var(--t-mark) var(--ease)",
    },
    ".cm-comment-mark-open, .cm-comment-mark-hot": { backgroundColor: "var(--comment-wash)" },
  })
  return [field, clicks, esc, layout, theme, slotSink.of(actions.onSlot)]
}
