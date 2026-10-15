import { Facet, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, type WidgetType, keymap } from "@codemirror/view"
import { transitionMs } from "@/lib/motion"

// The card that opens under a paragraph for something said about its words: Owlit's note (agent-notes)
// and a reader's comment (reader-comments). One shape, so the two can't drift; only the rule's colour
// says whose it is (owlit-mark or person-mark). Who and when come first, the actions sit at the bottom
// right as text buttons. The card's overhang into the margin is on the fold, so the fold's clip never
// cuts it.
export function sideCardTheme(prefix: string, rule: string) {
  const textButton = {
    height: "26px",
    padding: "0 8px",
    borderRadius: "8px",
    fontSize: "13px",
    background: "none",
    border: "none",
    color: "var(--muted-foreground)",
    cursor: "pointer",
  }
  return {
    [`.${prefix}-fold`]: { marginLeft: "-16px" },
    [`.${prefix}`]: {
      margin: "4px 0 14px",
      padding: "8px 12px 6px 13px",
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${rule}`,
      borderRadius: "4px 10px 10px 4px",
      fontSize: "14px",
      lineHeight: "1.55",
      cursor: "default",
    },
    [`.${prefix} p`]: { margin: "0" },
    [`.${prefix}-head`]: { display: "flex", alignItems: "center", gap: "8px", minHeight: "20px", marginBottom: "2px", fontSize: "12px", color: "var(--muted-foreground)" },
    [`.${prefix}-lost`]: { fontSize: "13px", color: "var(--muted-foreground)", marginBottom: "6px !important" },
    [`.${prefix}-actions`]: { display: "flex", justifyContent: "flex-end", gap: "2px", marginTop: "4px", marginRight: "-6px" },
    [`.${prefix}-actions[hidden]`]: { display: "none" },
    [`.${prefix}-actions button`]: textButton,
    [`.${prefix}-actions button:hover`]: { backgroundColor: "var(--accent)", color: "var(--foreground)" },
    // A field inside the card (a reply) is drawn as every field is: the input border, darker on focus
    [`.${prefix} textarea`]: {
      resize: "none",
      font: "inherit",
      fontSize: "14px",
      padding: "6px 10px",
      borderRadius: "10px",
      border: "1px solid var(--input)",
      background: "transparent",
      color: "var(--foreground)",
      outline: "none",
    },
    [`.${prefix} textarea:focus`]: { borderColor: "color-mix(in oklch, var(--foreground) 30%, transparent)" },
    // The words it is about: a 2px underline below and thicker than a link's, a wash while it is open that
    // fades in over --t-mark (the words are redrawn when the card opens, so a keyframe, in index.css)
    [`.${prefix}-mark`]: {
      textDecorationLine: "underline",
      textDecorationColor: rule,
      textDecorationThickness: "2px",
      textUnderlineOffset: "5px",
      textDecorationSkipInk: "none",
    },
  }
}

// The wash's own keyframe rule, shared by both
export const washOpen = "note-wash var(--t-mark) var(--ease)"

// A text button in the card. Pressing it leaves the editor's focus and selection where they were.
export function cardButton(label: string, run: () => void, className?: string) {
  const b = document.createElement("button")
  b.type = "button"
  b.textContent = label
  if (className) b.className = className
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = run
  return b
}

// The card opens under its paragraph the way a peek does (index.css, Unfold): the fold is laid out closed
// once the widget is in the doc, then opens, pushing the text below it over --t-layout. CodeMirror measures
// block heights itself, so it is told once the height has stopped moving. Reduced motion ends no
// transition, so a timer settles the fold when the transition does not.
export function sideCardFold(view: EditorView, card: HTMLElement, className: string): HTMLElement {
  const fold = document.createElement("div")
  fold.className = `unfold ${className}`
  const inner = document.createElement("div")
  inner.className = "unfold-inner"
  inner.append(card)
  fold.append(inner)
  const settle = () => {
    if ("settled" in fold.dataset || !fold.isConnected) return
    fold.dataset.settled = ""
    view.requestMeasure()
  }
  requestAnimationFrame(() => {
    fold.dataset.state = "open"
    setTimeout(settle, transitionMs(fold) + 50)
  })
  fold.addEventListener("transitionend", (e) => {
    if (e.target === fold && e.propertyName === "grid-template-rows") settle()
  })
  return fold
}

// Something said about a passage, where it sits in the doc now. A lost one's words are gone, and it sits
// on the title line.
export interface Spot<T> {
  item: T
  from: number
  to: number
  lost: boolean
}

interface CardsState<T> {
  spots: Spot<T>[]
  open: string | null
  // The underlined words, and the open card under its paragraph
  marks: DecorationSet
  card: DecorationSet
}

// Things said about passages of a doc (Owlit's notes, readers' comments), drawn and opened the same way:
// their words underlined (class `mark`, and `mark`-open while the card is open, the words carrying
// data-`attr`), a click on them opening the card under the paragraph, Esc putting it away. While the doc
// is open a passage follows the edits: text typed at either end stays outside it, and a passage deleted
// whole is lost until its words come back (an undo). `find` looks for a passage by its words in the doc's
// text, for a new item and for a lost one after each edit.
export function anchoredCards<T, A extends { onOpen: (id: string | null) => void }>(spec: {
  attr: string
  mark: string
  id: (item: T) => string
  find: (text: string, item: T) => { from: number; to: number } | null
  card: (opened: Spot<T>, spots: Spot<T>[], actions: A) => WidgetType
}) {
  const { attr, mark, id } = spec
  const setItems = StateEffect.define<T[]>()
  const setOpen = StateEffect.define<string | null>()
  const actionsFacet = Facet.define<A, A>({ combine: (values) => values[0] })

  const lostSpot = (state: EditorState, item: T): Spot<T> => ({ item, from: 0, to: state.doc.line(1).to, lost: true })
  const drawMarks = (spots: Spot<T>[], open: string | null) => {
    const marks: Range<Decoration>[] = []
    for (const s of spots) {
      if (s.lost) continue
      const key = id(s.item)
      marks.push(Decoration.mark({ class: key === open ? `${mark} ${mark}-open` : mark, attributes: { [`data-${attr}`]: key } }).range(s.from, s.to))
    }
    return Decoration.set(marks, true)
  }

  const field = StateField.define<CardsState<T>>({
    create: () => ({ spots: [], open: null, marks: Decoration.none, card: Decoration.none }),
    update(value, tr) {
      let { spots, open } = value
      // The doc's text is read once per change, however many passages are looked for in it
      let text: string | undefined
      const locate = (item: T): Spot<T> => {
        const at = spec.find((text ??= tr.state.doc.toString()), item)
        return at ? { item, from: at.from, to: at.to, lost: false } : lostSpot(tr.state, item)
      }
      // Whether an underline came or went, which mapping the old ones through the change can't follow
      let redraw = false
      if (tr.docChanged)
        spots = spots.map((s) => {
          if (s.lost) {
            const found = locate(s.item)
            redraw ||= !found.lost
            return found
          }
          const from = tr.changes.mapPos(s.from, 1)
          const to = tr.changes.mapPos(s.to, -1)
          if (to > from) return { ...s, from, to }
          redraw = true
          return lostSpot(tr.state, s.item)
        })
      for (const e of tr.effects) {
        if (e.is(setItems)) {
          const kept = new Map(spots.map((s) => [id(s.item), s]))
          spots = e.value.map((item) => {
            const spot = kept.get(id(item))
            return spot ? { ...spot, item } : locate(item)
          })
          redraw = true
        }
        if (e.is(setOpen)) open = e.value
      }
      if (open && !spots.some((s) => id(s.item) === open)) open = null
      if (spots === value.spots && open === value.open) return value

      // Underlines that only moved with the text are mapped as they are (a mark's ends map as a spot's do)
      const marks = redraw || open !== value.open ? drawMarks(spots, open) : value.marks.map(tr.changes)
      const opened = spots.find((s) => id(s.item) === open)
      const card = opened
        ? Decoration.set(Decoration.widget({ widget: spec.card(opened, spots, tr.state.facet(actionsFacet)), block: true, side: 1 }).range(tr.state.doc.lineAt(opened.to).to))
        : Decoration.none
      return { spots, open, marks, card }
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.marks), EditorView.decorations.from(f, (v) => v.card)],
  })

  const spotsOf = (state: EditorState): Spot<T>[] => state.field(field, false)?.spots ?? []

  function extension(actions: A): Extension {
    // A click on underlined words opens their card, and the caret lands where it was clicked as usual; a
    // click anywhere else in the text puts the open card away. Moving the caret in by keyboard opens
    // nothing, so a card never springs open while the writer types.
    const clicks = EditorView.domEventHandlers({
      click(e, view) {
        if (e.button !== 0 || !view.state.selection.main.empty) return false
        const clicked = (e.target as HTMLElement).closest?.(`[data-${attr}]`)?.getAttribute(`data-${attr}`) ?? null
        const { open } = view.state.field(field)
        if (clicked !== open && (clicked || open)) actions.onOpen(clicked)
        return false
      },
    })
    // Esc puts an open card away
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
    return [actionsFacet.of(actions), field, clicks, esc]
  }

  return { setItems, setOpen, spotsOf, extension }
}
