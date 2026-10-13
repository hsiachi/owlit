import { t } from "@lingui/core/macro"
import { syntaxTree } from "@codemirror/language"
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import katex from "katex"
import { frontmatterEnd } from "../lib/naming"
import { renderInline } from "./render-inline"

// Live preview for whole blocks: a table, a $$ math block or the front matter is drawn in place of its lines
// while the cursor is outside it. Clicking the drawing puts the cursor in, which brings the Markdown back.

abstract class BlockWidget extends WidgetType {
  readonly source: string
  constructor(source: string) {
    super()
    this.source = source
  }
  eq(other: BlockWidget) {
    return other.constructor === this.constructor && other.source === this.source
  }
  abstract draw(): HTMLElement
  toDOM(view: EditorView) {
    const dom = this.draw()
    dom.addEventListener("mousedown", (e) => {
      // A mention inside still opens its item; anywhere else goes into the source
      if ((e.target as HTMLElement).closest(".cm-mention")) return
      e.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(dom) } })
      view.focus()
    })
    return dom
  }
  ignoreEvent(e: Event) {
    return e.type !== "mousedown" || !(e.target as HTMLElement).closest(".cm-mention")
  }
}

// GFM cells: split on pipes that aren't escaped, without the outer ones
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"))

class TableWidget extends BlockWidget {
  draw() {
    const [head = "", rule = "", ...body] = this.source.split("\n")
    const align = cells(rule).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"))
    // Drawn with the same ruled look as tables in answers
    const wrap = document.createElement("div")
    wrap.className = "markdown cm-block-table"
    const table = document.createElement("table")
    const row = (line: string, tag: "th" | "td") => {
      const tr = document.createElement("tr")
      cells(line).forEach((text, i) => {
        const cell = document.createElement(tag)
        cell.style.textAlign = align[i] ?? "left"
        renderInline(text, cell)
        tr.append(cell)
      })
      return tr
    }
    const thead = document.createElement("thead")
    thead.append(row(head, "th"))
    const tbody = document.createElement("tbody")
    for (const line of body) if (line.trim()) tbody.append(row(line, "td"))
    table.append(thead, tbody)
    wrap.append(table)
    return wrap
  }
}

class MathBlockWidget extends BlockWidget {
  draw() {
    const div = document.createElement("div")
    div.className = "cm-block-math"
    const tex = this.source.trim().replace(/^\$\$/, "").replace(/\$\$$/, "")
    katex.render(tex, div, { displayMode: true, throwOnError: false })
    return div
  }
}

// Front matter as one quiet line of its fields, "tags: log · started: 2026-09-14"
class FrontMatterWidget extends BlockWidget {
  draw() {
    const div = document.createElement("div")
    div.className = "cm-frontmatter-folded"
    const fields = this.source
      .split("\n")
      .slice(1, -1)
      .map((line) => /^([\w-]+):\s*(.*)$/.exec(line))
      .filter((m) => m !== null)
      .map(([, key, value]) => {
        const shown = value.replace(/^\[(.*)\]$/, "$1").replace(/["']/g, "").trim()
        return shown ? `${key}: ${shown}` : key
      })
    div.textContent = fields.join(" · ") || t`Front matter`
    return div
  }
}

// Whether the editor has focus: an unfocused doc reads clean, wherever its cursor was left
const setFocused = StateEffect.define<boolean>()

interface Block {
  from: number
  to: number
  widget: BlockWidget
}

// The doc's drawable blocks, whole lines each. Tables and math blocks sit at the top level or inside a
// quote or a list, so the walk only goes into those.
function blocksOf(state: EditorState): Block[] {
  const blocks: Block[] = []
  const fmEnd = frontmatterEnd(state.sliceDoc(0, Math.min(state.doc.length, 4000)))
  if (fmEnd) {
    const to = state.doc.lineAt(fmEnd - 1).to
    blocks.push({ from: 0, to, widget: new FrontMatterWidget(state.sliceDoc(0, to)) })
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table" || node.name === "BlockMath") {
        const from = state.doc.lineAt(node.from).from
        const to = state.doc.lineAt(node.to).to
        const source = state.sliceDoc(from, to)
        blocks.push({ from, to, widget: node.name === "Table" ? new TableWidget(source) : new MathBlockWidget(source) })
        return false
      }
      return node.type.isTop || node.type.is("BlockContext")
    },
  })
  return blocks
}

// Which blocks hold a cursor or touch the selection; those show their Markdown
const entered = (blocks: Block[], state: EditorState, focused: boolean) =>
  blocks.map((b) => focused && state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from))

function decorate(blocks: Block[], open: boolean[]): DecorationSet {
  return Decoration.set(blocks.flatMap((b, i) => (open[i] ? [] : [Decoration.replace({ widget: b.widget, block: true }).range(b.from, b.to)])))
}

interface Preview {
  focused: boolean
  blocks: Block[]
  open: boolean[]
  decos: DecorationSet
}

function preview(state: EditorState, focused: boolean, blocks = blocksOf(state)): Preview {
  const open = entered(blocks, state, focused)
  return { focused, blocks, open, decos: decorate(blocks, open) }
}

export const blockPreview: Extension = [
  StateField.define<Preview>({
    create: (state) => preview(state, false),
    update: (value, tr) => {
      const focused = tr.effects.reduce((f, e) => (e.is(setFocused) ? e.value : f), value.focused)
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return preview(tr.state, focused)
      if (focused === value.focused && !tr.selection) return value
      // A cursor moving within a block, or between blocks of plain text, changes nothing drawn
      const open = entered(value.blocks, tr.state, focused)
      if (open.every((o, i) => o === value.open[i])) return focused === value.focused ? value : { ...value, focused }
      return { focused, blocks: value.blocks, open, decos: decorate(value.blocks, open) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  }),
  EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
]
