import { syntaxTree } from "@codemirror/language"
import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { frontmatterEnd } from "../lib/naming"

// Live preview: the text stays the document, and decorations only change how it is drawn. Markdown marks
// hide while the cursor is away from them and come back when it arrives, so nothing is ever converted.

class MentionWidget extends WidgetType {
  readonly label: string
  readonly uri: string
  readonly title?: string
  constructor(label: string, uri: string, title?: string) {
    super()
    this.label = label
    this.uri = uri
    this.title = title
  }
  eq(other: MentionWidget) {
    return other.label === this.label && other.uri === this.uri && other.title === this.title
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-mention"
    span.textContent = this.label || this.title || this.uri
    span.dataset.uri = this.uri
    if (this.title && this.title !== this.label) span.title = this.title
    return span
  }
  ignoreEvent() {
    return false
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-bullet"
    span.textContent = "•"
    return span
  }
}

class TaskWidget extends WidgetType {
  readonly checked: boolean
  constructor(checked: boolean) {
    super()
    this.checked = checked
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM() {
    const box = document.createElement("span")
    box.className = "cm-task"
    box.setAttribute("role", "checkbox")
    box.setAttribute("aria-checked", String(this.checked))
    if (this.checked) box.dataset.checked = ""
    return box
  }
  ignoreEvent() {
    return false
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() })
const hidden = Decoration.replace({})
const lineDeco = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

interface Built {
  decorations: DecorationSet
  mentions: DecorationSet
}

function build(view: EditorView, describe: (uri: string) => string | undefined): Built {
  const state: EditorState = view.state
  const doc = state.doc
  const decos: Range<Decoration>[] = []
  const mentions: Range<Decoration>[] = []
  // Marks come back only where the user is editing; an unfocused doc reads clean
  const ranges = view.hasFocus ? state.selection.ranges : []

  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos)
    return touches(l.from, l.to)
  }
  const hide = (from: number, to: number) => to > from && decos.push(hidden.range(from, to))
  const lines = (from: number, to: number, cls: (n: number, first: number, last: number) => string) => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    for (let n = first; n <= last; n++) decos.push(lineDeco(cls(n, first, last)).range(doc.line(n).from))
  }
  // A mark plus the space after it ("# ", "> ")
  const withSpace = (node: SyntaxNode) => (doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to)

  // Front matter is drawn quietly and never parsed as Markdown (its "---" would read as a rule or heading)
  const fmEnd = frontmatterEnd(doc.sliceString(0, Math.min(doc.length, 4000)))
  if (fmEnd) lines(0, Math.max(0, fmEnd - 1), () => "cm-frontmatter")
  // The first line after any front matter is the doc's title
  const title = doc.lineAt(Math.min(fmEnd, doc.length))
  decos.push(lineDeco("cm-doc-title").range(title.from))

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.from < fmEnd) return ref.to > fmEnd ? undefined : false
        const node = ref.node
        switch (ref.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6":
            if (doc.lineAt(ref.from).number !== title.number) decos.push(lineDeco(`cm-h${ref.name.slice(-1)}`).range(doc.lineAt(ref.from).from))
            break
          case "HeaderMark":
            if (node.parent?.name.startsWith("ATX") && !lineTouched(ref.from)) hide(ref.from, withSpace(node))
            break
          case "EmphasisMark":
          case "StrikethroughMark":
          case "HighlightMark":
            if (node.parent && !touches(node.parent.from, node.parent.to)) hide(ref.from, ref.to)
            break
          case "Highlight":
            decos.push(mark("cm-highlight").range(ref.from, ref.to))
            break
          case "InlineCode":
            decos.push(mark("cm-inline-code").range(ref.from, ref.to))
            if (!touches(ref.from, ref.to)) for (const m of node.getChildren("CodeMark")) hide(m.from, m.to)
            return false
          case "Link": {
            const marks = node.getChildren("LinkMark")
            const url = node.getChild("URL")
            if (!url || marks.length < 2) break
            const href = doc.sliceString(url.from, url.to)
            const labelFrom = marks[0].to
            const labelTo = marks[1].from
            // A mention is one token, drawn like every other mention and deleted as a unit
            if (href.startsWith("owlit://")) {
              const widget = new MentionWidget(doc.sliceString(labelFrom, labelTo), href, describe(href))
              mentions.push(Decoration.replace({ widget }).range(ref.from, ref.to))
              return false
            }
            if (!touches(ref.from, ref.to)) {
              hide(ref.from, labelFrom)
              hide(labelTo, ref.to)
              if (labelTo > labelFrom) decos.push(mark("cm-link").range(labelFrom, labelTo))
            }
            break
          }
          case "ListMark": {
            const list = node.parent?.parent?.name
            const isTask = !!node.nextSibling && node.nextSibling.name === "Task"
            if (list === "BulletList" && !isTask && !lineTouched(ref.from)) decos.push(bullet.range(ref.from, ref.to))
            else if (list === "BulletList" && isTask && !lineTouched(ref.from)) hide(ref.from, withSpace(node))
            else decos.push(mark("cm-list-mark").range(ref.from, ref.to))
            break
          }
          case "TaskMarker": {
            const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
            if (!touches(ref.from, ref.to)) decos.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(ref.from, ref.to))
            if (checked && node.parent) decos.push(mark("cm-task-done").range(ref.to, node.parent.to))
            break
          }
          case "Blockquote":
            lines(ref.from, ref.to, () => "cm-quote")
            break
          case "QuoteMark":
            if (!lineTouched(ref.from)) hide(ref.from, withSpace(node))
            break
          case "HorizontalRule":
            if (!lineTouched(ref.from)) {
              decos.push(lineDeco("cm-hr").range(doc.lineAt(ref.from).from))
              decos.push(mark("cm-hr-text").range(ref.from, ref.to))
            }
            break
          case "FencedCode":
            lines(ref.from, ref.to, (n, first, last) => `cm-code${n === first ? " cm-code-first" : ""}${n === last ? " cm-code-last" : ""}`)
            break
          case "Table":
            lines(ref.from, ref.to, () => "cm-table")
            break
        }
      },
    })
  }

  return { decorations: Decoration.set(decos, true), mentions: Decoration.set(mentions, true) }
}

export function livePreview({ describe, onOpenMention }: { describe: (uri: string) => string | undefined; onOpenMention: (uri: string) => void }): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      mentions: DecorationSet
      constructor(view: EditorView) {
        ;({ decorations: this.decorations, mentions: this.mentions } = build(view, describe))
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
          ({ decorations: this.decorations, mentions: this.mentions } = build(u.view, describe))
      }
    },
    {
      provide: (p) => [
        EditorView.decorations.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
        EditorView.decorations.of((view) => view.plugin(p)?.mentions ?? Decoration.none),
        EditorView.atomicRanges.of((view) => view.plugin(p)?.mentions ?? Decoration.none),
      ],
    },
  )

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      const target = e.target as HTMLElement
      const mention = target.closest<HTMLElement>(".cm-mention")
      if (mention?.dataset.uri) {
        e.preventDefault()
        onOpenMention(mention.dataset.uri)
        return true
      }
      const task = target.closest<HTMLElement>(".cm-task")
      if (task) {
        e.preventDefault()
        const pos = view.posAtDOM(task)
        const text = view.state.sliceDoc(pos, pos + 3)
        if (/^\[[ xX]\]$/.test(text)) view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === " " ? "x" : " " } })
        return true
      }
      return false
    },
  })

  return [plugin, clicks]
}
