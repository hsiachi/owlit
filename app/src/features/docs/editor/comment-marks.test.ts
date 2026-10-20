import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import type { DocComment } from "@owlit/protocol"
import { commentViews } from "../comments/model"
import { hunkChanges } from "../editors"
import { commentMarks, commentSpots, setComments } from "./comment-marks"

const TEXT = "The first claim holds.\n\nReplay ratings run lower than live ones.\n\nThe last claim holds.\n"
const comment: DocComment = {
  id: "c1",
  quote: "run lower than live ones",
  prefix: "Replay ratings ",
  suffix: ".",
  entries: [{ id: "e1", by: "p_1", text: "By how much?", at: 1 }],
  createdAt: 1,
}

function withComment() {
  const state = EditorState.create({ doc: TEXT, extensions: commentMarks({ onOpen: () => {}, onLayout: () => {}, onSlot: () => {} }) })
  return state.update({ effects: setComments.of(commentViews([comment], [])) }).state
}
const words = (state: EditorState) => commentSpots(state).map((s) => (s.lost ? null : state.sliceDoc(s.from, s.to)))

describe("comment marks under an agent's edit", () => {
  it("keep a comment between the places an edit changed, taken in as core's hunks", () => {
    const content = "The first claim holds, mostly.\n\nReplay ratings run lower than live ones.\n\nThe last claim holds, too.\n"
    // As core's hunks give the edit: two places, around the commented paragraph
    const hunks = [
      { from: 21, to: 21, insert: ", mostly" },
      { from: TEXT.length - 2, to: TEXT.length - 2, insert: ", too" },
    ]
    const changes = hunkChanges(TEXT, hunks, content)!
    expect(changes).not.toBeNull()
    const state = withComment().update({ changes }).state
    expect(state.doc.toString()).toBe(content)
    expect(words(state)).toEqual(["run lower than live ones"])
  })

  it("look again at once for words an edit replaced whole, and find them where they now are", () => {
    const state = withComment()
    const at = TEXT.indexOf("run lower than live ones")
    const end = at + "run lower than live ones".length
    // Rewritten in one change over the comment's words that puts the same words back
    const next = state.update({ changes: { from: at - 1, to: end, insert: " run lower than live ones" } }).state
    expect(words(next)).toEqual(["run lower than live ones"])
  })

  it("take no hunks that don't fit the editor's text", () => {
    expect(hunkChanges(TEXT, [{ from: 0, to: 3, insert: "A" }], "Something else")).toBeNull()
  })
})
