import { Extension } from "@tiptap/core"
import type { Node as PmNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { PendingEdit } from "@/features/docs/editor/suggestions"

// An edit Owlit proposed to the paper's note, drawn in the note before anything changes, as Docs draws
// one: the words it removes struck through in the muted tone, the new words on a faint green, and one
// "Suggested by Owlit" line with Discard and Apply under the paragraph. The proposal is a diff of the
// note's Markdown; the note is shown rich, so the changed span is found by its text.

export const noteSuggestionsKey = new PluginKey<DecorationSet>("note-suggestions")

// Markdown to the text the editor shows: marks, link targets and line markers go
function plain(md: string) {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\n{2,}/g, "\n")
}

// The one span an edit changes, between what it shares with the old text at both ends
function hunk(oldText: string, newText: string) {
  let p = 0
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++
  let s = 0
  while (s < oldText.length - p && s < newText.length - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++
  return { before: oldText.slice(0, p), removed: oldText.slice(p, oldText.length - s), added: newText.slice(p, newText.length - s) }
}

// The note's text block by block, joined with "\n", and the document position of each character
function flatten(doc: PmNode) {
  let text = ""
  const at: number[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (text) {
      text += "\n"
      at.push(-1)
    }
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return
      for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + offset + i)
      text += child.text
    })
    return false
  })
  return { text, at }
}

interface Spot {
  from: number
  to: number
  added: string
}

function locate(doc: PmNode, edit: PendingEdit): Spot | null {
  const { text, at } = flatten(doc)
  const h = hunk(edit.oldText, edit.newText)
  const removed = plain(h.removed).trim()
  const added = plain(h.added).trim()
  if (removed) {
    const i = text.indexOf(removed)
    // Found once, or the change can't be shown honestly
    if (i < 0 || text.indexOf(removed, i + 1) >= 0) return null
    const end = i + removed.length - 1
    return { from: at[i], to: at[end] + 1, added }
  }
  // Only new words: they go after the text that comes before them
  const lead = plain(h.before).trimEnd().slice(-40)
  const i = lead ? text.lastIndexOf(lead) : -1
  if (i < 0) return null
  const pos = at[i + lead.length - 1] + 1
  return { from: pos, to: pos, added }
}

function addedWidget(text: string) {
  const span = document.createElement("span")
  span.className = "note-suggest-ins"
  span.textContent = text
  return span
}

function barWidget(edit: PendingEdit, respond: (edit: PendingEdit, apply: boolean) => void) {
  const bar = document.createElement("div")
  bar.className = "note-suggest-bar"
  bar.contentEditable = "false"
  const label = document.createElement("span")
  label.textContent = "Suggested by Owlit"
  const discard = document.createElement("button")
  discard.type = "button"
  discard.className = "note-suggest-discard"
  discard.textContent = "Discard"
  discard.onclick = () => respond(edit, false)
  const apply = document.createElement("button")
  apply.type = "button"
  apply.className = "note-suggest-apply"
  apply.textContent = "Apply"
  apply.onclick = () => respond(edit, true)
  bar.append(label, discard, apply)
  return bar
}

function build(state: EditorState, edits: PendingEdit[], respond: (edit: PendingEdit, apply: boolean) => void) {
  const decos: Decoration[] = []
  for (const edit of edits) {
    const spot = locate(state.doc, edit)
    const bar = (pos: number, side: number) =>
      Decoration.widget(pos, () => barWidget(edit, respond), { side, key: `bar:${edit.requestId}`, stopEvent: () => true, ignoreSelection: true })
    if (!spot) {
      // Where it lands can't be found in what the note shows now: the new words and the bar go at the end
      const end = state.doc.content.size
      decos.push(Decoration.widget(end, () => addedWidget(plain(hunk(edit.oldText, edit.newText).added).trim()), { side: 1, key: `ins:${edit.requestId}` }))
      decos.push(bar(end, 2))
      continue
    }
    if (spot.to > spot.from) decos.push(Decoration.inline(spot.from, spot.to, { class: "note-suggest-del" }))
    if (spot.added) decos.push(Decoration.widget(spot.to, () => addedWidget(spot.added), { side: 1, key: `ins:${edit.requestId}:${spot.added}` }))
    // Under the paragraph the change ends in
    const $end = state.doc.resolve(spot.to)
    const blockEnd = $end.depth > 0 ? $end.after($end.depth) : spot.to
    decos.push(bar(blockEnd, 1))
  }
  return DecorationSet.create(state.doc, decos)
}

export interface NoteSuggestionsOptions {
  respond: (edit: PendingEdit, apply: boolean) => void
}

// The edits shown are set from outside with tr.setMeta(noteSuggestionsKey, edits)
export const NoteSuggestions = Extension.create<NoteSuggestionsOptions>({
  name: "noteSuggestions",
  addOptions: () => ({ respond: () => {} }),
  addProseMirrorPlugins() {
    const respond = (edit: PendingEdit, apply: boolean) => this.options.respond(edit, apply)
    let edits: PendingEdit[] = []
    return [
      new Plugin<DecorationSet>({
        key: noteSuggestionsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value, _old, state) {
            const next = tr.getMeta(noteSuggestionsKey) as PendingEdit[] | undefined
            if (next) edits = next
            if (!next && !tr.docChanged) return value
            return edits.length ? build(state, edits, respond) : DecorationSet.empty
          },
        },
        props: { decorations: (state) => noteSuggestionsKey.getState(state) },
      }),
    ]
  },
})
