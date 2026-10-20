import { createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Prec, type Extension } from "@codemirror/state"
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { MentionList, type MentionListHandle } from "@/components/mention/mention-list"
import { mentionAtEnd } from "@/components/mention/trigger"
import { filterMentions, type DocMention } from "../lib/mentions"
import { mentionInsertion } from "../lib/mention-insert"

// "@" opens the composer's own mention popup, so a mention is picked the same way everywhere. On pick the
// typed "@query" becomes a Markdown link to the item's owlit:// address.


interface Open {
  from: number
  to: number
  query: string
  // What @ can reach, read once when the popup opens; typing only narrows it
  all: DocMention[]
  items: DocMention[]
}

export function mentionPopup(reachable: () => DocMention[]): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      open: Open | null = null
      // Esc closes the popup until the "@" it belongs to goes away
      dismissedAt = -1
      list = createRef<MentionListHandle>()
      dom: HTMLDivElement
      root: Root

      view: EditorView

      constructor(view: EditorView) {
        this.view = view
        this.dom = document.createElement("div")
        this.dom.style.cssText = "position:fixed;z-index:50;display:none"
        document.body.appendChild(this.dom)
        this.root = createRoot(this.dom)
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged || u.geometryChanged) this.refresh()
      }

      refresh() {
        const { state } = this.view
        const sel = state.selection.main
        const line = state.doc.lineAt(sel.head)
        const m = sel.empty && this.view.hasFocus ? mentionAtEnd(state.sliceDoc(line.from, sel.head), { words: true }) : null
        const from = m ? sel.head - m.length : -1
        if (from !== this.dismissedAt) this.dismissedAt = -1
        if (!m || from === this.dismissedAt) return this.close()
        const all = this.open?.from === from ? this.open.all : reachable()
        const items = filterMentions(all, m.query)
        // Words typed on after a mention that matches nothing are prose: the list goes
        if (!items.length && /\s/.test(m.query)) return this.close()
        this.open = { from, to: sel.head, query: m.query, all, items }
        this.render()
        this.view.requestMeasure({
          read: (v) => v.coordsAtPos(from),
          write: (coords) => {
            if (!coords) return
            const below = coords.bottom + 6
            const fitsBelow = below + 380 < window.innerHeight
            this.dom.style.left = `${Math.max(8, Math.min(coords.left - 10, window.innerWidth - 424))}px`
            this.dom.style.top = fitsBelow ? `${below}px` : ""
            this.dom.style.bottom = fitsBelow ? "" : `${window.innerHeight - coords.top + 6}px`
            this.dom.style.display = "block"
          },
        })
      }

      render() {
        this.root.render(<MentionList ref={this.list} items={this.open?.items ?? []} command={({ id, kind }) => this.pick(id, kind)} />)
      }

      pick(id: string, kind: string) {
        const open = this.open
        const item = open?.items.find((i) => i.id === id && i.kind === kind)
        if (!open || !item) return
        const text = mentionInsertion(item.label, item.uri, this.view.state.sliceDoc(open.to, open.to + 1))
        this.view.dispatch({ changes: { from: open.from, to: open.to, insert: text }, selection: { anchor: open.from + text.length } })
        this.close()
        this.view.focus()
      }

      dismiss() {
        if (this.open) this.dismissedAt = this.open.from
        this.close()
      }

      close() {
        if (!this.open) return
        this.open = null
        this.dom.style.display = "none"
      }

      destroy() {
        const { root, dom } = this
        // Unmounting during React's own render would warn; let the current pass finish first
        setTimeout(() => {
          root.unmount()
          dom.remove()
        })
      }
    },
  )

  const forward = (key: string, shiftKey = false) => (view: EditorView) => {
    const p = view.plugin(plugin)
    if (!p?.open) return false
    if (key === "Escape") {
      p.dismiss()
      return true
    }
    return p.list.current?.onKeyDown({ event: { key, shiftKey } }) ?? false
  }

  return [
    plugin,
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: forward("ArrowDown") },
        { key: "ArrowUp", run: forward("ArrowUp") },
        { key: "Enter", run: forward("Enter") },
        { key: "Tab", run: forward("Tab") },
        { key: "Shift-Tab", run: forward("Tab", true) },
        { key: "Escape", run: forward("Escape") },
      ]),
    ),
  ]
}
