import { syntaxTree } from "@codemirror/language"
import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import katex from "katex"
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

class MathWidget extends WidgetType {
  readonly tex: string
  constructor(tex: string) {
    super()
    this.tex = tex
  }
  eq(other: MathWidget) {
    return other.tex === this.tex
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-math"
    katex.render(this.tex, span, { throwOnError: false })
    return span
  }
}

// [[Note]] or [[Note|shown text]]: drawn like a mention when it names a doc in the workspace, quietly otherwise
class WikilinkWidget extends WidgetType {
  readonly label: string
  readonly route: string | null
  constructor(label: string, route: string | null) {
    super()
    this.label = label
    this.route = route
  }
  eq(other: WikilinkWidget) {
    return other.label === this.label && other.route === this.route
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = this.route ? "cm-mention" : "cm-wikilink"
    if (this.route) span.dataset.route = this.route
    else span.title = "No doc with this name"
    span.textContent = this.label
    return span
  }
  ignoreEvent() {
    return false
  }
}

// ![[file]]: the embedded file named in a small chip; the file itself isn't drawn yet
class EmbedWidget extends WidgetType {
  readonly name: string
  constructor(name: string) {
    super()
    this.name = name
  }
  eq(other: EmbedWidget) {
    return other.name === this.name
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-embed"
    span.textContent = this.name
    return span
  }
}

class LabelWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  eq(other: LabelWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-callout-label"
    span.textContent = this.text
    return span
  }
}

// A code block's language, quietly in its top right corner while the fences are hidden
class CodeLangWidget extends WidgetType {
  readonly lang: string
  constructor(lang: string) {
    super()
    this.lang = lang
  }
  eq(other: CodeLangWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-code-lang"
    span.textContent = this.lang
    return span
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

// A callout's first line: "> [!note] Title", folded with "-" or "+" after the type
const CALLOUT = /^(\s*>\s*)(\[!(\w+)\][+-]?\s*)(.*)$/

interface Resolvers {
  describe: (uri: string) => string | undefined
  // The route of the doc a [[wikilink]] names, if there is one
  wikilink: (name: string) => string | null
}

function build(view: EditorView, { describe, wikilink }: Resolvers): Built {
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

  // Front matter is drawn quietly and never parsed as Markdown (its "---" would read as a rule or heading).
  // Away from the cursor it folds into one line (see block-preview); this is how it reads while edited.
  const fmEnd = frontmatterEnd(doc.sliceString(0, Math.min(doc.length, 4000)))
  if (fmEnd) lines(0, Math.max(0, fmEnd - 1), (n, _, last) => (n === last ? "cm-frontmatter cm-frontmatter-last" : "cm-frontmatter"))
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
          case "ATXHeading6": {
            const line = doc.lineAt(ref.from)
            // Markdown counts a lone "#" as an empty heading, but it is usually a heading half typed: it stays
            // body text, marks and all, until the space after the #s
            if (/^\s*#+$/.test(line.text)) return false
            // Sized by the number of #s, so editing one heading never restyles another: # and ## are 18px, deeper 16px
            if (line.number !== title.number) decos.push(lineDeco(Number(ref.name.slice(-1)) <= 2 ? "cm-h1" : "cm-h2").range(line.from))
            // The blank line Markdown wants under a heading shrinks, so the heading sits with the text it
            // heads rather than halfway between two paragraphs. Not while the cursor is on it.
            if (line.number < doc.lines) {
              const below = doc.line(line.number + 1)
              if (!below.text.trim() && !lineTouched(below.from)) decos.push(lineDeco("cm-heading-gap").range(below.from))
            }
            break
          }
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
            // Each item hangs: its marker sits in a fixed box and wrapped lines line up with the text, not the
            // marker. Nesting steps in by the same box, whatever spaces the file uses.
            const line = doc.lineAt(ref.from)
            const list = node.parent?.parent?.name
            const isTask = !!node.nextSibling && node.nextSibling.name === "Task"
            const touched = lineTouched(ref.from)
            const end = withSpace(node)
            let depth = 0
            let quoted = false
            for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
              if (p.name === "ListItem") depth++
              else if (p.name === "Blockquote") quoted = true
            }
            decos.push(Decoration.line({ class: "cm-li", attributes: { style: `--li-depth: ${Math.max(1, depth)}` } }).range(line.from))
            if (!touched) hide(line.from, ref.from)
            // In a quote, the "> " shown while editing shares the marker's box, so it doesn't push the text out
            const markFrom = touched && quoted ? line.from : ref.from
            if (list === "BulletList" && !isTask && !touched) decos.push(bullet.range(ref.from, end))
            else if (list === "BulletList" && isTask && !touched) hide(ref.from, end)
            else if (list === "BulletList" && !isTask && !quoted) decos.push(mark("cm-list-mark cm-list-dash").range(ref.from, end))
            else decos.push(mark("cm-list-mark").range(markFrom, end))
            break
          }
          case "TaskMarker": {
            const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
            const end = doc.sliceString(ref.to, ref.to + 1) === " " ? ref.to + 1 : ref.to
            if (!touches(ref.from, ref.to)) decos.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(ref.from, end))
            if (checked && node.parent) decos.push(mark("cm-task-done").range(ref.to, node.parent.to))
            break
          }
          case "Blockquote": {
            const first = doc.lineAt(ref.from)
            const callout = CALLOUT.exec(first.text)
            if (!callout) {
              lines(ref.from, ref.to, () => "cm-quote")
              break
            }
            // A callout is a quiet tinted box; its type marker gives way to a plain label
            lines(ref.from, ref.to, (n, a, b) => `cm-callout${n === a ? " cm-callout-first" : ""}${n === b ? " cm-callout-last" : ""}`)
            if (!lineTouched(first.from)) {
              const at = first.from + callout[1].length
              const type = callout[3]
              const label = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
              decos.push(Decoration.replace({ widget: new LabelWidget(label) }).range(at, at + callout[2].length))
              if (callout[4].trim()) decos.push(mark("cm-callout-title").range(at + callout[2].length, first.to))
            }
            break
          }
          case "InlineMath":
            if (!touches(ref.from, ref.to)) {
              decos.push(Decoration.replace({ widget: new MathWidget(doc.sliceString(ref.from + 1, ref.to - 1)) }).range(ref.from, ref.to))
              return false
            }
            break
          case "Wikilink":
          case "Embed": {
            if (touches(ref.from, ref.to)) break
            const inner = doc.sliceString(ref.from + (ref.name === "Embed" ? 3 : 2), ref.to - 2)
            const [target, shown] = inner.split("|")
            const name = target.split("#")[0].trim()
            const widget = ref.name === "Embed" ? new EmbedWidget(name) : new WikilinkWidget((shown ?? target).trim(), wikilink(name))
            decos.push(Decoration.replace({ widget }).range(ref.from, ref.to))
            return false
          }
          case "QuoteMark":
            if (!lineTouched(ref.from)) hide(ref.from, withSpace(node))
            break
          case "HorizontalRule":
            if (!lineTouched(ref.from)) {
              decos.push(lineDeco("cm-hr").range(doc.lineAt(ref.from).from))
              decos.push(mark("cm-hr-text").range(ref.from, ref.to))
            }
            break
          case "FencedCode": {
            // The fences hide while the cursor is outside the block, leaving the language in the corner
            const open = doc.lineAt(ref.from)
            const close = doc.lineAt(ref.to)
            const closed = close.number > open.number && /^\s*(`{3,}|~{3,})\s*$/.test(close.text)
            const folded = !touches(ref.from, ref.to)
            lines(ref.from, ref.to, (n, first, last) => {
              let cls = "cm-code"
              if (n === first) cls += folded ? " cm-code-first cm-code-fence" : " cm-code-first"
              if (n === last) cls += folded && closed ? " cm-code-last cm-code-fence" : " cm-code-last"
              return cls
            })
            if (folded) {
              const info = node.getChild("CodeInfo")
              const lang = info ? doc.sliceString(info.from, info.to) : ""
              decos.push(Decoration.replace({ widget: new CodeLangWidget(lang) }).range(open.from, open.to))
              if (closed) hide(close.from, close.to)
            }
            break
          }
          case "Table":
            lines(ref.from, ref.to, () => "cm-table")
            break
        }
      },
    })
  }

  return { decorations: Decoration.set(decos, true), mentions: Decoration.set(mentions, true) }
}

export function livePreview({ describe, wikilink, onOpenMention, onOpenRoute }: Resolvers & { onOpenMention: (uri: string) => void; onOpenRoute: (route: string) => void }): Extension {
  const resolvers = { describe, wikilink }
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      mentions: DecorationSet
      constructor(view: EditorView) {
        ;({ decorations: this.decorations, mentions: this.mentions } = build(view, resolvers))
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
          ({ decorations: this.decorations, mentions: this.mentions } = build(u.view, resolvers))
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
      const linked = target.closest<HTMLElement>("[data-route]")
      if (linked?.dataset.route) {
        e.preventDefault()
        onOpenRoute(linked.dataset.route)
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
