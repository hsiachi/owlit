import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import type { Proposal } from "@owlit/protocol"
import { proposalSpots } from "./proposals"

const doc = "# Notes\n\nThe method works, mostly.\n\nMy own line, which Owlit touched.\n\nA closing line.\n"
const proposal = (hunks: Proposal["hunks"], id = "c1"): Proposal => ({ id, at: 1, actor: "o_1234abcd", hunks })

describe("proposalSpots", () => {
  it("finds each passage by its words and the ones either side, in order", () => {
    const spots = proposalSpots(
      EditorState.create({ doc }),
      [proposal([{ insert: ", which Owlit touched", removed: "", before: "My own line", after: ".\n" }]), proposal([{ insert: ", mostly", removed: " well", before: "The method works", after: ".\n" }], "c0")],
      new Set(),
    )
    expect(spots.map((s) => [s.key, doc.slice(s.from, s.to), s.removed])).toEqual([
      ["c0:0", ", mostly", " well"],
      ["c1:0", ", which Owlit touched", ""],
    ])
  })

  it("leaves out a passage edited since, one settled, and one whose words occur twice", () => {
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
      new Set(["c1:0"]),
    )
    expect(spots.map((s) => s.key)).toEqual(["c1:2"])
  })

  it("draws a passage that only removed words as a place, and only one passage at one place", () => {
    const spots = proposalSpots(EditorState.create({ doc }), [proposal([{ insert: "", removed: " well", before: "The method works", after: ", mostly" }]), proposal([{ insert: "", removed: "x", before: "The method works", after: ", mostly" }], "c2")], new Set())
    expect(spots).toEqual([{ key: "c1:0", from: 25, to: 25, removed: " well" }])
  })
})
