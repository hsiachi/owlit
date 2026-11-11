import { plural, t } from "@lingui/core/macro"
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view"
import type { Proposal, ProposalHunk } from "@owlit/protocol"

// Owlit's edits that landed in the doc since the user last had it on screen (changes.proposals), each
// passage marked as its edit would have been drawn before it landed: the new words underlined in Owlit's
// colour, the words they replaced struck before them, a rule beside the lines. Undo on each passage floats
// at its end while the pointer is near it (⌘⌫ there); a line above the first says how many, that the
// marks clear when the person leaves the doc, and offers Clear marks and Undo all. Undo goes through core's
// change log, the same Undo as the chat's card: a whole edit by its entry, one passage of a larger edit by
// its index. Nothing is kept or accepted: the marks are this visit's, and once the doc has been seen the
// next visit shows none. Clear marks counts the doc as seen now (options.clear) and drops the marks; the
// edits stay, and the log's Undo (chat card, Versions) is untouched.
// A doc Owlit wrote whole has no marks, only a line above it saying so, with Undo and a close button that
// clears it as Clear marks does: every
// word of it is Owlit's, and a page underlined throughout reads as nothing marked at all.

export const setProposals = StateEffect.define<Proposal[]>()

export interface ProposalSpot {
  key: string
  // The proposal's entry, and the passage's index among its hunks
  id: string
  index: number
  from: number
  to: number
  removed: string
}

// What one Undo asks of the log: a whole entry, or one passage of it
export interface UndoStep {
  id: string
  index?: number
}

// Where text occurs exactly once in the doc, or -1
function only(doc: string, text: string) {
  const i = doc.indexOf(text)
  return i >= 0 && doc.indexOf(text, i + 1) < 0 ? i : -1
}

// Where a passage sits in the doc as it reads now: its words with the ones either side, found once. A
// passage edited since isn't found and shows nothing, as it is no longer only Owlit's.
function locate(doc: string, h: ProposalHunk): { from: number; to: number } | null {
  const needle = h.before + h.insert + h.after
  if (!needle.trim()) return null
  const i = only(doc, needle)
  if (i < 0) return null
  return { from: i + h.before.length, to: i + h.before.length + h.insert.length }
}

// The passages drawn: none in a doc Owlit wrote whole, which has its line instead
export function proposalSpots(state: EditorState, proposals: Proposal[]): ProposalSpot[] {
  if (proposals.some((p) => p.whole)) return []
  const doc = state.doc.toString()
  const spots: ProposalSpot[] = []
  for (const p of proposals) {
    p.hunks.forEach((h, index) => {
      const at = locate(doc, h)
      if (at) spots.push({ key: `${p.id}:${index}`, id: p.id, index, ...at, removed: h.removed })
    })
  }
  spots.sort((a, b) => a.from - b.from)
  // Two passages in one place can't both be drawn; the later one waits for the first to be undone. Each is
  // weighed against the last one kept, so one inside a long passage stays out though a short one between
  // them was dropped.
  const kept: ProposalSpot[] = []
  for (const s of spots) {
    const last = kept.at(-1)
    if (!last || (s.from >= last.to && s.from !== last.from)) kept.push(s)
  }
  return kept
}

// A passage's words as its marks draw them: the blank lines a landed paragraph brings with it are part of
// the passage, not of its marks, and its Undo sits at the end of these
function drawnRange(state: EditorState, s: ProposalSpot) {
  const text = state.sliceDoc(s.from, s.to)
  const from = s.from + (text.length - text.trimStart().length)
  return { from, to: Math.max(from, s.to - (text.length - text.trimEnd().length)) }
}

// The words a passage replaced, struck before it
class RemovedWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  eq(other: RemovedWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "suggest-del"
    span.textContent = this.text
    return span
  }
  ignoreEvent() {
    return false
  }
}

// Undo at the passage's end. The widget itself is an empty inline span, so the line wraps as if it weren't
// there; the button floats from it (index.css .proposal-acts) and shows for the passage nearest the
// pointer (showActs) or on keyboard focus. The left margin can't hold it: the column's padding leaves
// about 14px beside the rule, and "Undo" needs more.
class ActsWidget extends WidgetType {
  readonly key: string
  readonly act: (key: string) => void
  constructor(key: string, act: (key: string) => void) {
    super()
    this.key = key
    this.act = act
  }
  eq(other: ActsWidget) {
    return other.key === this.key
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "proposal-acts"
    span.contentEditable = "false"
    span.dataset.key = this.key
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = t({ message: "Undo", comment: "verb: undo a passage Owlit changed" })
    b.title = t`Undo this passage (⌘⌫ at its end)`
    b.onmousedown = (e) => e.preventDefault()
    b.onclick = () => this.act(this.key)
    span.append(b)
    return span
  }
  ignoreEvent() {
    return true
  }
}

// The first landed proposal teaches the rule, once on this machine: the sentence rides on the first
// header line drawn, for that visit
const EXPLAINED = "owlit.proposals.explained"
const explained = () => {
  try {
    return localStorage.getItem(EXPLAINED) === "1"
  } catch {
    return true
  }
}
const setExplained = () => {
  try {
    localStorage.setItem(EXPLAINED, "1")
  } catch {
    // Nowhere to keep it: the sentence shows again, which is no harm
  }
}

// "Clear marks", on the line above the marks
function clearButton(clear: () => void) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "suggest-discard"
  b.textContent = t({ message: "Clear marks", comment: "verb: stop showing Owlit's marks in this doc, keeping its edits" })
  b.title = t`Keep the edits and stop marking them`
  b.onclick = clear
  return b
}

// The line above the first passage: how many, that the marks end with the visit, Clear marks and Undo all
class HeadWidget extends WidgetType {
  readonly count: number
  readonly all: () => void
  readonly clear: () => void
  readonly first: boolean
  constructor(count: number, all: () => void, clear: () => void, first: boolean) {
    super()
    this.count = count
    this.all = all
    this.clear = clear
    this.first = first
  }
  eq(other: HeadWidget) {
    return other.count === this.count && other.first === this.first
  }
  toDOM() {
    const bar = document.createElement("div")
    bar.className = "suggest-bar proposal-head"
    bar.contentEditable = "false"
    const label = document.createElement("span")
    const count = plural(this.count, { one: "Owlit changed # passage", other: "Owlit changed # passages" })
    const ends = t`the marks clear when you leave this doc`
    label.textContent = this.first ? `${count} · ${t`Owlit's edits land like this; undo any part, or tell Owlit in the chat what to change`} · ${ends}` : `${count} · ${ends}`
    const b = document.createElement("button")
    b.type = "button"
    b.className = "suggest-discard"
    b.textContent = t({ message: "Undo all", comment: "verb: undo every passage Owlit changed" })
    b.onclick = () => this.all()
    bar.append(label, clearButton(this.clear), b)
    return bar
  }
  ignoreEvent() {
    return true
  }
}

// A lucide icon drawn outside React, for a widget's DOM. Its paths are copied from lucide-react: change
// them with the icon they name.
function icon(paths: string[]) {
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  for (const d of paths) {
    const path = document.createElementNS(ns, "path")
    path.setAttribute("d", d)
    svg.append(path)
  }
  return svg
}
// MessageSquare, a chat's icon everywhere (KIND_ICON.chat), and X
const CHAT_ICON = ["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"]
const X_ICON = ["M18 6 6 18", "m6 6 12 12"]

// The line above a doc Owlit wrote: Owlit's dot, "Owlit wrote this doc", the chat it came from as a chip,
// then Undo and a close button. Closing is Clear marks: the line is the only mark such a doc has.
class WholeWidget extends WidgetType {
  readonly proposal: Proposal
  readonly options: ProposalOptions
  readonly clear: () => void
  constructor(proposal: Proposal, options: ProposalOptions, clear: () => void) {
    super()
    this.proposal = proposal
    this.options = options
    this.clear = clear
  }
  eq(other: WholeWidget) {
    return other.proposal.id === this.proposal.id && other.proposal.whole?.also.length === this.proposal.whole?.also.length
  }
  toDOM() {
    const bar = document.createElement("div")
    bar.className = "suggest-bar proposal-head proposal-whole"
    bar.contentEditable = "false"
    const dot = document.createElement("i")
    dot.className = "proposal-dot"
    const label = document.createElement("span")
    label.className = "proposal-label"
    label.textContent = t`Owlit wrote this doc`
    bar.append(dot, label)
    const { chatId } = this.proposal
    if (chatId) {
      const title = this.options.chatTitle(chatId)
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "proposal-chat"
      // The chat's title can be a whole question: the chip cuts it to one line and the tooltip has it all
      const name = document.createElement("span")
      name.textContent = title ?? t`a chat`
      chip.title = title ? t`Open the chat “${title}”` : t`Open the chat`
      chip.append(icon(CHAT_ICON), name)
      chip.onclick = () => this.options.openChat(chatId)
      bar.append(chip)
    }
    const undo = document.createElement("button")
    undo.type = "button"
    undo.className = "suggest-discard proposal-undo"
    undo.textContent = t({ message: "Undo", comment: "verb: take back the doc Owlit wrote" })
    undo.onclick = () => this.options.undoWhole(this.proposal)
    const close = document.createElement("button")
    close.type = "button"
    close.className = "suggest-discard proposal-close"
    close.ariaLabel = t({ message: "Hide this line", comment: "the line saying Owlit wrote this doc; it also goes when you leave the doc" })
    close.title = t`Hide this line (it also goes when you leave the doc)`
    close.append(icon(X_ICON))
    close.onclick = this.clear
    bar.append(undo, close)
    return bar
  }
  ignoreEvent() {
    return true
  }
}

export interface ProposalOptions {
  // Undo of passages, as the log takes them back
  undo: (steps: UndoStep[]) => void
  // A chat's title, when this window knows it
  chatTitle: (chatId: string) => string | undefined
  openChat: (chatId: string) => void
  // Undo on a doc Owlit wrote whole
  undoWhole: (proposal: Proposal) => void
  // Clear marks: count the doc as seen as it reads now, so the next visit shows none either; the marks
  // drawn here go by themselves
  clear: () => void
}

interface Value {
  proposals: Proposal[]
  spots: ProposalSpot[]
  decos: DecorationSet
}

// The steps that undo these passages: a proposal all of whose standing passages are among them is its
// whole entry, any other passage its own step
export function undoSteps(proposals: Proposal[], spots: ProposalSpot[]): UndoStep[] {
  const steps: UndoStep[] = []
  for (const p of proposals) {
    const mine = spots.filter((s) => s.id === p.id)
    if (!mine.length) continue
    const standing = p.hunks.filter((h) => h.insert || h.removed).length
    if (mine.length === standing) steps.push({ id: p.id })
    else steps.push(...mine.map((s) => ({ id: p.id, index: s.index })))
  }
  return steps
}

// The passage whose drawn end (where its Undo sits) the cursor is at, with nothing selected: ⌘⌫ undoes it
// there and only there, so anywhere else it keeps its usual meaning (delete to the line's start)
export function spotAt(state: EditorState, spots: ProposalSpot[]) {
  const { head, empty } = state.selection.main
  if (!empty) return undefined
  return spots.find((s) => drawnRange(state, s).to === head)
}

// The passage whose Undo shows with the pointer at pos: of those on pos's line, the nearest. One at a time,
// since a paragraph Owlit rewrote in many passages would otherwise float an Undo over every few words.
export function actsNear(state: EditorState, spots: ProposalSpot[], pos: number) {
  const line = state.doc.lineAt(pos)
  let best: ProposalSpot | undefined
  let distance = Infinity
  for (const s of spots) {
    const { from, to } = drawnRange(state, s)
    if (to < line.from || from > line.to) continue
    const d = pos < from ? from - pos : pos > to ? pos - to : 0
    if (d < distance) {
      best = s
      distance = d
    }
  }
  return best
}

// Marks the one passage's Undo shown (none for undefined)
function showActs(view: EditorView, key: string | undefined) {
  for (const el of view.dom.querySelectorAll<HTMLElement>(".proposal-acts")) el.toggleAttribute("data-shown", el.dataset.key === key)
}

export function proposalMarks(options: ProposalOptions): Extension {
  let view: EditorView | undefined
  // Whether this visit's header carries the one-time sentence (read once, when its first header draws)
  let first: boolean | undefined
  const undo = (spots: ProposalSpot[]) => {
    if (!view || !spots.length) return
    options.undo(undoSteps(view.state.field(field).proposals, spots))
  }
  const act = (key: string) => {
    const spot = view?.state.field(field).spots.find((s) => s.key === key)
    if (spot) undo([spot])
  }
  const all = () => undo(view?.state.field(field).spots ?? [])
  const clear = () => {
    options.clear()
    view?.dispatch({ effects: setProposals.of([]) })
  }
  const build = (state: EditorState, proposals: Proposal[]): Pick<Value, "spots" | "decos"> => {
    const whole = proposals.find((p) => p.whole)
    if (whole) return { spots: [], decos: Decoration.set([Decoration.widget({ widget: new WholeWidget(whole, options, clear), block: true, side: -1 }).range(0)]) }
    const spots = proposalSpots(state, proposals)
    const decos: Range<Decoration>[] = []
    if (spots.length) {
      if (first === undefined) {
        first = !explained()
        setExplained()
      }
      const head = spots[0]!
      const start = head.from + (state.sliceDoc(head.from, head.to).length - state.sliceDoc(head.from, head.to).trimStart().length)
      decos.push(Decoration.widget({ widget: new HeadWidget(spots.length, all, clear, first), block: true, side: -1 }).range(state.doc.lineAt(start).from))
    }
    for (const s of spots) {
      const { from, to } = drawnRange(state, s)
      for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) decos.push(Decoration.line({ class: "suggest-line" }).range(state.doc.line(n).from))
      if (s.removed) decos.push(Decoration.widget({ widget: new RemovedWidget(s.removed.trim()), side: -1 }).range(from))
      if (to > from) decos.push(Decoration.mark({ class: s.removed ? "suggest-ins suggest-ins-after" : "suggest-ins" }).range(from, to))
      decos.push(Decoration.widget({ widget: new ActsWidget(s.key, act), side: 1 }).range(to))
    }
    return { spots, decos: Decoration.set(decos, true) }
  }
  const field = StateField.define<Value>({
    create: () => ({ proposals: [], spots: [], decos: Decoration.none }),
    update(value, tr) {
      let { proposals } = value
      for (const e of tr.effects) if (e.is(setProposals)) proposals = e.value
      if (proposals === value.proposals && !tr.docChanged) return value
      return { proposals, ...build(tr.state, proposals) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })
  return [
    field,
    EditorView.updateListener.of((u) => {
      view = u.view
    }),
    EditorView.domEventHandlers({
      mousemove: (e, v) => {
        // Over a shown Undo, it stays: the pointer is on its way to it
        if (e.target instanceof Element && e.target.closest(".proposal-acts")) return
        const { spots } = v.state.field(field)
        if (!spots.length) return
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false)
        showActs(v, actsNear(v.state, spots, pos)?.key)
      },
      mouseleave: (_e, v) => showActs(v, undefined),
    }),
    // Before the editor's own ⌘⌫ (delete to the line's start); only at a passage's end (spotAt)
    Prec.high(
      keymap.of([
        {
          key: "Mod-Backspace",
          run: (v) => {
            const spot = spotAt(v.state, v.state.field(field).spots)
            if (!spot) return false
            view = v
            undo([spot])
            return true
          },
        },
      ]),
    ),
  ]
}
