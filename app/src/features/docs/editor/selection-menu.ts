import { t } from "@lingui/core/macro"
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view"
import { isPassage } from "@/app/text-menu"

// While the mouse is held down the user is still choosing; the menu waits for the release
const setDragging = StateEffect.define<boolean>()
const dragging = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setDragging) ? e.value : v), value),
})

// A comment icon (lucide message-square-plus), drawn here because the menu is built outside React
const COMMENT_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>`

// A selected passage offers two actions above it: "Ask Owlit", which hands it to the agent window, and,
// where comments can go (a doc), a comment icon that starts a comment on it
export function selectionMenu(chat: (text: string, view: EditorView) => void, comment?: { start: (view: EditorView) => void; label: string }): Extension {
  const tooltip = (state: EditorState): Tooltip | null => {
    const sel = state.selection.main
    // A stray click-drag of a character or two is not a passage
    if (state.field(dragging) || sel.empty || !isPassage(state.sliceDoc(sel.from, sel.to))) return null
    return {
      pos: sel.from,
      end: sel.to,
      above: true,
      arrow: false,
      create: (view) => {
        // CodeMirror makes the returned element the tooltip itself, and the doc theme clears .cm-tooltip's
        // fill and border (it outranks a plain class), so the menu is drawn on an element inside it
        const dom = document.createElement("div")
        const menu = document.createElement("div")
        menu.className = "selection-menu"
        dom.append(menu)
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = t`Ask Owlit`
        // Keep the selection and focus in the editor while clicking
        button.onmousedown = (e) => e.preventDefault()
        button.onclick = () => {
          const { from, to } = view.state.selection.main
          chat(view.state.sliceDoc(from, to), view)
        }
        menu.append(button)
        if (comment) {
          const icon = document.createElement("button")
          icon.type = "button"
          icon.className = "selection-menu-icon"
          icon.innerHTML = COMMENT_ICON
          icon.title = comment.label
          icon.setAttribute("aria-label", comment.label)
          icon.onmousedown = (e) => e.preventDefault()
          icon.onclick = () => comment.start(view)
          menu.append(icon)
        }
        // Lifted clear of the selected line, so it never sits on the words being chosen
        return { dom, offset: { x: 0, y: 8 } }
      },
    }
  }

  const field = StateField.define<Tooltip | null>({
    create: tooltip,
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setDragging)) ? tooltip(tr.state) : value),
    provide: (f) => showTooltip.from(f),
  })

  const mouse = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false
      view.dispatch({ effects: setDragging.of(true) })
      // The release may happen outside the editor
      document.addEventListener("mouseup", () => view.dispatch({ effects: setDragging.of(false) }), { once: true })
      return false
    },
  })

  // Only while the editor has focus, so a selection left behind doesn't keep a menu floating
  const focusOnly = EditorView.theme({ "&:not(.cm-focused) .selection-menu": { display: "none" } })
  return [dragging, field, mouse, focusOnly]
}
