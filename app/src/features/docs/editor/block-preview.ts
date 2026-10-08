import { syntaxTree } from "@codemirror/language"
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state"
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
    div.textContent = fields.join(" · ") || "Front matter"
    return div
  }
}

// Whether the editor has focus: an unfocused doc reads clean, wherever its cursor was left
const setFocused = StateEffect.define<boolean>()

function build(state: EditorState, focused: boolean): DecorationSet {
  const decos: Range<Decoration>[] = []
  const ranges = focused ? state.selection.ranges : []
  const fmEnd = frontmatterEnd(state.sliceDoc(0, Math.min(state.doc.length, 4000)))
  if (fmEnd) {
    const to = state.doc.lineAt(fmEnd - 1).to
    if (!ranges.some((r) => r.from <= to)) decos.push(Decoration.replace({ widget: new FrontMatterWidget(state.sliceDoc(0, to)), block: true }).range(0, to))
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table" && node.name !== "BlockMath") return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      if (!ranges.some((r) => r.from <= to && r.to >= from)) {
        const source = state.sliceDoc(from, to)
        const widget = node.name === "Table" ? new TableWidget(source) : new MathBlockWidget(source)
        decos.push(Decoration.replace({ widget, block: true }).range(from, to))
      }
      return false
    },
  })
  return Decoration.set(decos)
}

export const blockPreview: Extension = [
  StateField.define<{ focused: boolean; decos: DecorationSet }>({
    create: (state) => ({ focused: false, decos: build(state, false) }),
    update: (value, tr) => {
      const focused = tr.effects.reduce((f, e) => (e.is(setFocused) ? e.value : f), value.focused)
      const changed = focused !== value.focused || tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)
      return changed ? { focused, decos: build(tr.state, focused) } : value
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  }),
  EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
]
