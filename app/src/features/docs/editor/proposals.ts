import { plural, t } from "@lingui/core/macro"
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view"
import type { Proposal, ProposalHunk } from "@owlit/protocol"

// Owlit's edits that landed in the doc since the user last had it on screen (changes.proposals), each
// passage marked as its edit would have been drawn before it landed: the new words underlined in Owlit's
// colour, the words they replaced struck before them, a rule beside the lines. Undo on each passage shows
// on hover (⌘⌫ at its end); a line above the first says how many and offers Undo all. Undo goes through
// core's change log, the same Undo as the chat's card: a whole edit by its entry, one passage of a larger
// edit by its index. Nothing is kept or accepted: the marks are this visit's, and once the doc has been
// seen the next visit shows none.
// A doc Owlit wrote whole has no marks, only a line above it saying so, with Undo: every word of it is
// Owlit's, and a page underlined throughout reads as nothing marked at all.

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

// Undo after the passage, seen on hover of its lines
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

// The line above the first passage: how many, and Undo all
class HeadWidget extends WidgetType {
  readonly count: number
  readonly all: () => void
  readonly first: boolean
  constructor(count: number, all: () => void, first: boolean) {
    super()
    this.count = count
    this.all = all
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
    label.textContent = this.first ? `${count} · ${t`Owlit's edits land like this; undo any part, or tell Owlit in the chat what to change`}` : count
    const b = document.createElement("button")
    b.type = "button"
    b.className = "suggest-discard"
    b.textContent = t({ message: "Undo all", comment: "verb: undo every passage Owlit changed" })
    b.onclick = () => this.all()
    bar.append(label, b)
    return bar
  }
  ignoreEvent() {
    return true
  }
}

// The line above a doc Owlit wrote: "Owlit wrote this doc · from <chat> · Undo"
class WholeWidget extends WidgetType {
  readonly proposal: Proposal
  readonly options: ProposalOptions
  constructor(proposal: Proposal, options: ProposalOptions) {
    super()
    this.proposal = proposal
    this.options = options
  }
  eq(other: WholeWidget) {
    return other.proposal.id === this.proposal.id && other.proposal.whole?.also.length === this.proposal.whole?.also.length
  }
  toDOM() {
    const bar = document.createElement("div")
    bar.className = "suggest-bar proposal-head proposal-whole"
    bar.contentEditable = "false"
    const label = document.createElement("span")
    label.append(t`Owlit wrote this doc`)
    const { chatId } = this.proposal
    if (chatId) {
      const title = this.options.chatTitle(chatId)
      const link = document.createElement("button")
      link.type = "button"
      link.className = "proposal-chat"
      link.textContent = title ? t`from “${title}”` : t`from a chat`
      link.onclick = () => this.options.openChat(chatId)
      label.append(" · ", link)
    }
    const undo = document.createElement("button")
    undo.type = "button"
    undo.className = "suggest-discard"
    undo.textContent = t({ message: "Undo", comment: "verb: take back the doc Owlit wrote" })
    undo.onclick = () => this.options.undoWhole(this.proposal)
    bar.append(label, undo)
    return bar
  }
  ignoreEvent() {
    return true
  }
}

export interface ProposalOptions {
  // Undo of passages, as the log takes them back (spots: where they are, for a window without core)
  undo: (steps: UndoStep[], spots: ProposalSpot[]) => void
  // A chat's title, when this window knows it
  chatTitle: (chatId: string) => string | undefined
  openChat: (chatId: string) => void
  // Undo on a doc Owlit wrote whole
  undoWhole: (proposal: Proposal) => void
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

export function proposalMarks(options: ProposalOptions): Extension {
  let view: EditorView | undefined
  // Whether this visit's header carries the one-time sentence (read once, when its first header draws)
  let first: boolean | undefined
  const undo = (spots: ProposalSpot[]) => {
    if (!view || !spots.length) return
    options.undo(undoSteps(view.state.field(field).proposals, spots), spots)
  }
  const act = (key: string) => {
    const spot = view?.state.field(field).spots.find((s) => s.key === key)
    if (spot) undo([spot])
  }
  const all = () => undo(view?.state.field(field).spots ?? [])
  const build = (state: EditorState, proposals: Proposal[]): Pick<Value, "spots" | "decos"> => {
    const whole = proposals.find((p) => p.whole)
    if (whole) return { spots: [], decos: Decoration.set([Decoration.widget({ widget: new WholeWidget(whole, options), block: true, side: -1 }).range(0)]) }
    const spots = proposalSpots(state, proposals)
    const decos: Range<Decoration>[] = []
    if (spots.length) {
      if (first === undefined) {
        first = !explained()
        setExplained()
      }
      const head = spots[0]!
      const start = head.from + (state.sliceDoc(head.from, head.to).length - state.sliceDoc(head.from, head.to).trimStart().length)
      decos.push(Decoration.widget({ widget: new HeadWidget(spots.length, all, first), block: true, side: -1 }).range(state.doc.lineAt(start).from))
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
