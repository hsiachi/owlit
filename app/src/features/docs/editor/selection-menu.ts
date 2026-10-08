import { StateField, type EditorState, type Extension } from "@codemirror/state"
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view"

export type SelectionAction = "ask" | "rewrite" | "support"

const ACTIONS: { id: SelectionAction; label: string }[] = [
  { id: "ask", label: "Ask" },
  { id: "rewrite", label: "Rewrite" },
  { id: "support", label: "Find support" },
]

// Selecting text brings up Ask · Rewrite · Find support above it; each hands the passage to the agent window
export function selectionMenu(run: (action: SelectionAction, text: string, view: EditorView) => void): Extension {
  const tooltip = (state: EditorState): Tooltip | null => {
    const sel = state.selection.main
    // A stray click-drag of a character or two is not a passage
    if (sel.empty || state.sliceDoc(sel.from, sel.to).trim().length < 3) return null
    return {
      pos: sel.from,
      end: sel.to,
      above: true,
      arrow: false,
      create: (view) => {
        const dom = document.createElement("div")
        dom.className = "cm-selection-menu"
        for (const a of ACTIONS) {
          const button = document.createElement("button")
          button.type = "button"
          button.textContent = a.label
          // Keep the selection and focus in the editor while clicking
          button.onmousedown = (e) => e.preventDefault()
          button.onclick = () => {
            const { from, to } = view.state.selection.main
            run(a.id, view.state.sliceDoc(from, to), view)
          }
          dom.append(button)
        }
        return { dom }
      },
    }
  }

  const field = StateField.define<Tooltip | null>({
    create: tooltip,
    update: (value, tr) => (tr.docChanged || tr.selection ? tooltip(tr.state) : value),
    provide: (f) => showTooltip.from(f),
  })

  // Only while the editor has focus, so a selection left behind doesn't keep a menu floating
  const focusOnly = EditorView.theme({ "&:not(.cm-focused) .cm-selection-menu": { display: "none" } })
  return [field, focusOnly]
}
