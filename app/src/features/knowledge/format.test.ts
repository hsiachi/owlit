import { describe, expect, it } from "vitest"
import { changeGroups, namedLines, shownChange, wasBefore, wordsAfter } from "./format"
import type { Change, TopicSidecar } from "./types"

const side = (history: Change[]): TopicSidecar => ({ seenAt: 0, history, edits: {}, removed: {}, said: {}, changedAt: {} })
const LINE = "Three prompted judges, Gemini 1.5 Pro, GPT-4o and Claude 3.5 Sonnet, reduce bias."

describe("a line's history", () => {
  it("shows no “Was” when a change left the words as they were", () => {
    // An older history recorded a change of condition as a rewrite, with the same words as before
    const sourceOnly: Change = { id: "c2", at: 20, lineId: "s4", what: "Rewritten", why: "x", by: "owlit", before: `${LINE.replace(", reduce", ",  reduce")}\n` }
    const rewrite: Change = { id: "c1", at: 10, lineId: "s4", what: "Rewritten", why: "x", by: "owlit", before: "Three judges reduce bias." }
    const history = [sourceOnly, rewrite]
    const after = wordsAfter(history, () => LINE)
    expect(shownChange(sourceOnly, after.get("c2"))).toEqual({ what: "Source changed" })
    expect(shownChange(rewrite, after.get("c1"))).toEqual({ what: "Rewritten", was: "Three judges reduce bias." })
    // While unseen, the line shows the words the person last saw, or nothing when they read the same
    expect(wasBefore("s4", side(history), 5, LINE)).toBe("Three judges reduce bias.")
    expect(wasBefore("s4", side(history), 15, LINE)).toBeUndefined()
  })

  it("groups the changes Owlit made together under their reason once", () => {
    const why = "You highlighted two passages of Jacovi et al. 2025, so the judge lines cite them."
    const day = new Date(2026, 9, 13, 12).getTime()
    const history: Change[] = [
      { id: "u", at: day + 9, lineId: "s9", what: "You rewrote it", why: "edited on the topic page", by: "you" },
      { id: "b", at: day + 5, lineId: "s3", what: "Rewritten", why, by: "owlit", before: "Old." },
      { id: "a", at: day + 5, lineId: "s2", what: "Added", why, by: "owlit" },
      { id: "z", at: day - 86_400_000, lineId: "s1", what: "Added", why, by: "owlit" },
    ]
    expect(changeGroups(history).map((g) => g.map((c) => c.id))).toEqual([["u"], ["a", "b"], ["z"]])
  })
})

describe("lines named in prose", () => {
  const has = (id: string) => ["s3", "s6", "s8"].includes(id)

  it("turns ids into lines and leaves out the ones that are gone", () => {
    expect(namedLines("Owlit answered the granularity part (^s3, ^s6); the comparison is open.", has)).toEqual([
      "Owlit answered the granularity part (",
      { id: "s3" },
      ", ",
      { id: "s6" },
      "); the comparison is open.",
    ])
    expect(namedLines("FACTS Grounding, with RAGAs second (^s6, ^s9).", has)).toEqual(["FACTS Grounding, with RAGAs second (", { id: "s6" }, ")."])
    expect(namedLines("The two-phase line (^s5) folded into ^s8.", has)).toEqual(["The two-phase line folded into ", { id: "s8" }, "."])
    expect(namedLines("Nothing to point at.", has)).toEqual(["Nothing to point at."])
  })
})
