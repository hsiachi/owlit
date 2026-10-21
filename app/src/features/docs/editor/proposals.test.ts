import { EditorSelection, EditorState } from "@codemirror/state"
import { type DecorationSet, EditorView } from "@codemirror/view"
import { describe, expect, it, vi } from "vitest"
import type { Proposal } from "@owlit/protocol"
import { actsNear, proposalMarks, proposalSpots, setProposals, spotAt, undoSteps } from "./proposals"

const doc = "# Notes\n\nThe method works, mostly.\n\nMy own line, which Owlit touched.\n\nA closing line.\n"
const proposal = (hunks: Proposal["hunks"], id = "c1"): Proposal => ({ id, at: 1, actor: "o_1234abcd", hunks })

describe("proposalSpots", () => {
  it("finds each passage by its words and the ones either side, in order", () => {
    const spots = proposalSpots(
      EditorState.create({ doc }),
      [proposal([{ insert: ", which Owlit touched", removed: "", before: "My own line", after: ".\n" }]), proposal([{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }], "c0")],
    )
    expect(spots.map((s) => [s.key, doc.slice(s.from, s.to), s.removed])).toEqual([
      ["c0:0", ", mostly", " well"],
      ["c1:0", ", which Owlit touched", ""],
    ])
  })

  it("leaves out a passage edited since and one whose words occur twice", () => {
    const spots = proposalSpots(
      EditorState.create({ doc }),
      [
        proposal([
          { insert: ", mostly", removed: " well", before: "The method works", after: ".\n" },
          { insert: "gone", removed: "", before: "was ", after: " here" },
          { insert: " line", removed: "", before: "closing", after: ".\n" },
        ]),
        proposal([{ insert: "line", removed: "", before: " ", after: "" }], "c2"),
      ],
    )
    expect(spots.map((s) => s.key)).toEqual(["c1:0", "c1:2"])
  })

  it("draws a passage that only removed words as a place, and only one passage at one place", () => {
    const spots = proposalSpots(EditorState.create({ doc }), [proposal([{ insert: "", removed: " well", before: "The method works", after: ", mostly" }]), proposal([{ insert: "", removed: "x", before: "The method works", after: ", mostly" }], "c2")])
    expect(spots).toEqual([{ key: "c1:0", id: "c1", index: 0, from: 25, to: 25, removed: " well" }])
  })

  it("keeps out a passage inside a long one, though a short one between them was kept out too", () => {
    const spots = proposalSpots(EditorState.create({ doc }), [
      proposal([{ insert: "\n\nMy own line, which Owlit touched.\n\nA closing line", removed: "", before: "mostly.", after: ".\n" }], "long"),
      proposal([{ insert: "", removed: "x", before: "mostly.", after: "\n\nMy own line" }], "short"),
      proposal([{ insert: " closing", removed: "", before: "A", after: " line." }], "inside"),
    ])
    expect(spots.map((s) => s.key)).toEqual(["long:0"])
  })

  it("draws no passage in a doc Owlit wrote whole", () => {
    const made: Proposal = { id: "c0", at: 1, actor: "o_1234abcd", hunks: [], whole: { also: [] } }
    expect(proposalSpots(EditorState.create({ doc }), [made, proposal([{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }])])).toEqual([])
  })
})

describe("spotAt", () => {
  const at = (selection: EditorSelection) => {
    const state = EditorState.create({ doc, selection })
    return spotAt(state, proposalSpots(state, [proposal([{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }])]))?.key
  }
  const end = doc.indexOf(", mostly") + ", mostly".length

  it("is the passage whose end the cursor is at, with nothing selected", () => {
    expect(at(EditorSelection.single(end))).toBe("c1:0")
  })

  it("is a landed paragraph at the end of its words, where its Undo sits, not after its blank lines", () => {
    const state = (head: number) => EditorState.create({ doc, selection: EditorSelection.single(head) })
    const landed = [proposal([{ insert: "My own line, which Owlit touched.\n\n", removed: "", before: "mostly.\n\n", after: "A closing" }])]
    const words = doc.indexOf("touched.") + "touched.".length
    expect(spotAt(state(words), proposalSpots(state(words), landed))?.key).toBe("c1:0")
    expect(spotAt(state(words + 2), proposalSpots(state(words + 2), landed))).toBeUndefined()
  })

  it("is none inside a passage, on its line, or with a selection, so ⌘⌫ deletes as it always does", () => {
    expect(at(EditorSelection.single(end - 2))).toBeUndefined()
    expect(at(EditorSelection.single(doc.indexOf("The method")))).toBeUndefined()
    expect(at(EditorSelection.single(end - 3, end))).toBeUndefined()
  })
})

describe("undoSteps", () => {
  const two = proposal([
    { insert: ", mostly", removed: " well", before: "The method works", after: ".\n" },
    { insert: ", which Owlit touched", removed: "", before: "My own line", after: ".\n" },
  ])
  const spots = proposalSpots(EditorState.create({ doc }), [two])

  it("undoes a whole edit by its entry, and one passage of a larger edit by its index", () => {
    expect(undoSteps([two], spots)).toEqual([{ id: "c1" }])
    expect(undoSteps([two], spots.slice(1))).toEqual([{ id: "c1", index: 1 }])
  })

  it("counts a passage undone before as no longer standing", () => {
    const rest = { ...two, hunks: [{ insert: "", removed: "", before: "", after: "" }, two.hunks[1]!] }
    expect(undoSteps([rest], proposalSpots(EditorState.create({ doc }), [rest]))).toEqual([{ id: "c1" }])
  })
})

describe("actsNear", () => {
  const two = [proposal([{ insert: " quickly", removed: "", before: "The method", after: " works" }, { insert: ", mostly", removed: " well", before: "The method quickly works", after: ".\n" }])]
  const text = doc.replace("The method works", "The method quickly works")
  const state = EditorState.create({ doc: text })
  const spots = proposalSpots(state, two)

  it("is one passage on the pointer's line, the nearest, so a paragraph of many passages floats one Undo", () => {
    expect(actsNear(state, spots, text.indexOf("The"))?.key).toBe("c1:0")
    expect(actsNear(state, spots, text.indexOf("works"))?.key).toBe("c1:0")
    expect(actsNear(state, spots, text.indexOf("works") + 4)?.key).toBe("c1:1")
  })

  it("is none on a line without a passage", () => {
    expect(actsNear(state, spots, text.indexOf("A closing"))).toBeUndefined()
  })
})

describe("proposalMarks", () => {
  const marks = (state: EditorState) =>
    state
      .facet(EditorView.decorations)
      .filter((d): d is DecorationSet => typeof d !== "function")
      .reduce((n, set) => n + set.size, 0)
  const options = { undo: vi.fn(), chatTitle: () => undefined, openChat: vi.fn(), undoWhole: vi.fn(), clear: vi.fn() }
  const landed = [proposal([{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }])]

  it("draws a landed passage, and nothing once its proposals are cleared, leaving the text as it is", () => {
    const state = EditorState.create({ doc, extensions: proposalMarks(options) })
    const drawn = state.update({ effects: setProposals.of(landed) }).state
    // The head line, the passage's line, the struck words, the new words and the Undo
    expect(marks(drawn)).toBe(5)
    const cleared = drawn.update({ effects: setProposals.of([]) }).state
    expect(marks(cleared)).toBe(0)
    expect(cleared.doc.toString()).toBe(doc)
  })
})
