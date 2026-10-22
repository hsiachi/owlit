import { EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { openEditor } from "../editors"

// Where each doc was left, for this session: a doc reopens with the cursor where it was, scrolled as it
// was (Back from a paper a citation opened lands on the citation, not on the cursor)
export const lastSelection = new Map<string, EditorSelection>()
export const lastScroll = new Map<string, number>()

// The doc opens next with the cursor at pos, scrolled to it, instead of where it was left (a citing
// sentence on a paper's page leads to its citation); an editor open on it now goes there at once
export function placeDocAt(id: string, pos: number) {
  const view = openEditor(id)
  if (view) {
    const at = Math.min(pos, view.state.doc.length)
    view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: "center" }) })
    return
  }
  lastSelection.set(id, EditorSelection.single(pos))
  lastScroll.delete(id)
}
