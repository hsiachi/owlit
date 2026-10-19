import { plural, t } from "@lingui/core/macro"
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view"
import type { Proposal, ProposalHunk } from "@owlit/protocol"

// Owlit's edits that landed in the doc since the user last had it on screen (changes.proposals), each
// passage marked as its edit would have been drawn before it landed: the new words underlined in Owlit's
// colour, the words they replaced struck before them, a rule beside the lines. Keep and Undo on each
// passage show on hover (⌘⏎ and ⌘⌫ on the one at the cursor); a line above the first says how many and
// offers Keep all and Undo all. Keep only takes the marks away; Undo puts the passage back as the
// user's own edit. The marks are this visit's: once the doc has been seen, the next visit shows none.

export const setProposals = StateEffect.define<Proposal[]>()
// Passages kept or undone, by key: their marks go
const settle = StateEffect.define<string[]>()

export interface ProposalSpot {
  key: string
  from: number
  to: number
  removed: string
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

export function proposalSpots(state: EditorState, proposals: Proposal[], settled: Set<string>): ProposalSpot[] {
  const doc = state.doc.toString()
  const spots: ProposalSpot[] = []
  for (const p of proposals) {
    p.hunks.forEach((h, i) => {
      const key = `${p.id}:${i}`
      if (settled.has(key)) return
      const at = locate(doc, h)
      if (at) spots.push({ key, ...at, removed: h.removed })
    })
  }
  spots.sort((a, b) => a.from - b.from)
  // Two passages in one place can't both be drawn; the later one waits for the first to be settled
  return spots.filter((s, i) => i === 0 || (s.from >= spots[i - 1]!.to && s.from !== spots[i - 1]!.from))
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

// Keep · Undo after the passage, seen on hover of its lines
class ActsWidget extends WidgetType {
  readonly key: string
  readonly act: (key: string, keep: boolean) => void
  constructor(key: string, act: (key: string, keep: boolean) => void) {
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
    const button = (text: string, keep: boolean) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = text
      b.title = keep ? t`Keep this passage (⌘⏎)` : t`Undo this passage (⌘⌫)`
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = () => this.act(this.key, keep)
      return b
    }
    span.append(button(t({ message: "Keep", comment: "verb: keep a passage Owlit changed" }), true), button(t({ message: "Undo", comment: "verb: undo a passage Owlit changed" }), false))
    return span
  }
  ignoreEvent() {
    return true
  }
}

// The first landed proposal teaches the rule, once on this machine: the sentence rides on the header
// line until a Keep or Undo has been clicked anywhere
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

// The line above the first passage: how many, Keep all, Undo all
class HeadWidget extends WidgetType {
  readonly count: number
  readonly all: (keep: boolean) => void
  readonly first: boolean
  constructor(count: number, all: (keep: boolean) => void) {
    super()
    this.count = count
    this.all = all
    this.first = !explained()
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
    label.textContent = this.first ? `${count} · ${t`Owlit's edits land like this; undo any part, or keep Owlit out of this doc from its menu`}` : count
    const button = (text: string, keep: boolean) => {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "suggest-discard"
      b.textContent = text
      b.onclick = () => this.all(keep)
      return b
    }
    bar.append(label, button(t({ message: "Keep all", comment: "verb: keep every passage Owlit changed" }), true), button(t({ message: "Undo all", comment: "verb: undo every passage Owlit changed" }), false))
    return bar
  }
  ignoreEvent() {
    return true
  }
}

interface Value {
  proposals: Proposal[]
  settled: Set<string>
  spots: ProposalSpot[]
  decos: DecorationSet
}

// The passage at the cursor: the one its position is in, else the one on its line
function spotAt(state: EditorState, spots: ProposalSpot[]) {
  const { head } = state.selection.main
  const line = state.doc.lineAt(head)
  return spots.find((s) => s.from <= head && head <= s.to) ?? spots.find((s) => s.from >= line.from && s.from <= line.to)
}

// `onKeepAll` hears Keep all, so the doc as it reads can be marked seen
export function proposalMarks(onKeepAll: () => void): Extension {
  let view: EditorView | undefined
  const act = (key: string, keep: boolean) => {
    if (!view) return
    setExplained()
    const spot = view.state.field(field).spots.find((s) => s.key === key)
    if (!spot) return
    view.dispatch({ effects: settle.of([key]), ...(keep ? {} : { changes: { from: spot.from, to: spot.to, insert: spot.removed }, userEvent: "input.proposal" }) })
  }
  const all = (keep: boolean) => {
    if (!view) return
    setExplained()
    const spots = view.state.field(field).spots
    view.dispatch({ effects: settle.of(spots.map((s) => s.key)), ...(keep ? {} : { changes: spots.map((s) => ({ from: s.from, to: s.to, insert: s.removed })), userEvent: "input.proposal" }) })
    if (keep) onKeepAll()
  }
  const build = (state: EditorState, proposals: Proposal[], settled: Set<string>): Pick<Value, "spots" | "decos"> => {
    const spots = proposalSpots(state, proposals, settled)
    const decos: Range<Decoration>[] = []
    if (spots.length) {
      const first = spots[0]!
      const start = first.from + (state.sliceDoc(first.from, first.to).length - state.sliceDoc(first.from, first.to).trimStart().length)
      decos.push(Decoration.widget({ widget: new HeadWidget(spots.length, all), block: true, side: -1 }).range(state.doc.lineAt(start).from))
    }
    for (const s of spots) {
      // The blank lines a landed paragraph brings with it are part of the passage, not of its marks
      const text = state.sliceDoc(s.from, s.to)
      const from = s.from + (text.length - text.trimStart().length)
      const to = Math.max(from, s.to - (text.length - text.trimEnd().length))
      for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) decos.push(Decoration.line({ class: "suggest-line" }).range(state.doc.line(n).from))
      if (s.removed) decos.push(Decoration.widget({ widget: new RemovedWidget(s.removed.trim()), side: -1 }).range(from))
      if (to > from) decos.push(Decoration.mark({ class: s.removed ? "suggest-ins suggest-ins-after" : "suggest-ins" }).range(from, to))
      decos.push(Decoration.widget({ widget: new ActsWidget(s.key, act), side: 1 }).range(to))
    }
    return { spots, decos: Decoration.set(decos, true) }
  }
  const field = StateField.define<Value>({
    create: () => ({ proposals: [], settled: new Set(), spots: [], decos: Decoration.none }),
    update(value, tr) {
      let { proposals, settled } = value
      for (const e of tr.effects) {
        if (e.is(setProposals)) proposals = e.value
        if (e.is(settle)) settled = new Set([...settled, ...e.value])
      }
      if (proposals === value.proposals && settled === value.settled && !tr.docChanged) return value
      return { proposals, settled, ...build(tr.state, proposals, settled) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  })
  return [
    field,
    EditorView.updateListener.of((u) => {
      view = u.view
    }),
    // Before the editor's own keys, which also have ⌘⌫ (delete to the line's start); only when a passage
    // is at the cursor, so the keys mean what they always do elsewhere
    Prec.high(
      keymap.of([
        { key: "Mod-Enter", run: (v) => keyAct(v, true) },
        { key: "Mod-Backspace", run: (v) => keyAct(v, false) },
      ]),
    ),
  ]
  function keyAct(v: EditorView, keep: boolean) {
    const spot = spotAt(v.state, v.state.field(field).spots)
    if (!spot) return false
    view = v
    act(spot.key, keep)
    return true
  }
}
