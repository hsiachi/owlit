import { Extension } from "@tiptap/core"
import type { Node as PmNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { suggestionBar, type PendingEdit } from "@/features/chat/pending-edits"
import { markdownPlain } from "@/lib/markdown-plain"
import { hunk } from "@/lib/text-diff"

// An edit Owlit proposed to the paper's note, drawn in the note before anything changes, as Docs draws
// one: the words it removes struck through, the new words in Owlit's colour, a rule beside the paragraphs
// it touches, and one "Suggested by Owlit" line with Discard and Apply under them. The proposal is a diff of the
// note's Markdown; the note is shown rich, so the changed span is found by its text.

export const noteSuggestionsKey = new PluginKey<DecorationSet>("note-suggestions")

// Markdown to the text the editor shows
const plain = (md: string) => markdownPlain(md, { lines: true })

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
  const lead = plain(edit.oldText.slice(0, h.at)).trimEnd().slice(-40)
  const i = lead ? text.lastIndexOf(lead) : -1
  if (i < 0) return null
  const pos = at[i + lead.length - 1] + 1
  return { from: pos, to: pos, added }
}

function addedWidget(text: string) {
  const span = document.createElement("span")
  span.className = "suggest-ins suggest-ins-after"
  span.textContent = text
  return span
}

function build(state: EditorState, edits: PendingEdit[], respond: (edit: PendingEdit, apply: boolean) => void) {
  const decos: Decoration[] = []
  for (const edit of edits) {
    const spot = locate(state.doc, edit)
    const bar = (pos: number, side: number) =>
      Decoration.widget(pos, () => suggestionBar((apply) => respond(edit, apply)), { side, key: `bar:${edit.requestId}`, stopEvent: () => true, ignoreSelection: true })
    if (!spot) {
      // Where it lands can't be found in what the note shows now: the new words and the bar go at the end
      const end = state.doc.content.size
      decos.push(Decoration.widget(end, () => addedWidget(plain(hunk(edit.oldText, edit.newText).added).trim()), { side: 1, key: `ins:${edit.requestId}` }))
      decos.push(bar(end, 2))
      continue
    }
    if (spot.to > spot.from) decos.push(Decoration.inline(spot.from, spot.to, { class: "suggest-del" }))
    const $from = state.doc.resolve(spot.from)
    if (spot.to > spot.from)
      state.doc.nodesBetween(spot.from, spot.to, (node, pos) => {
        if (!node.isTextblock) return true
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "suggest-block" }))
        return false
      })
    else if ($from.parent.isTextblock && $from.depth > 0)
      decos.push(Decoration.node($from.before(), $from.after(), { class: "suggest-block" }))
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
