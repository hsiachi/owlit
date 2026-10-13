import { EditorState } from "@codemirror/state"
import { HUNK_GAP } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { editSpots } from "./suggestions"

const edit = (oldText: string, newText: string) => ({ chatId: "c", requestId: "r", path: "a.md", oldText, newText })
const doc = ["# Title", "", "First paragraph about reminders.", "", "Second paragraph about timing.", "", "Third paragraph about tone.", ""].join("\n")
const state = EditorState.create({ doc })
const at = (text: string) => doc.indexOf(text)

describe("an edit drawn in the doc", () => {
  it("finds a passage the agent quoted", () => {
    expect(editSpots(state, edit("Second paragraph about timing.", "Second paragraph about good timing."))).toEqual([
      { from: at("timing."), to: at("timing."), added: "good " },
    ])
  })

  it("finds each part of an edit in several places, and none when one part is gone", () => {
    const parts = edit(`First paragraph\n${HUNK_GAP}\nabout tone.`, `Opening paragraph\n${HUNK_GAP}\nabout wording.`)
    expect(editSpots(state, parts)).toEqual([
      { from: at("First"), to: at("First") + "First".length, added: "Opening" },
      { from: at("tone"), to: at("tone") + "tone".length, added: "wording" },
    ])
    expect(editSpots(state, edit(`First paragraph\n${HUNK_GAP}\nabout volume.`, `Opening paragraph\n${HUNK_GAP}\nabout loudness.`))).toBeNull()
  })

  it("places a Write of the whole file by what changed in it", () => {
    expect(editSpots(state, edit(doc, doc.replace("tone", "wording")))).toEqual([{ from: at("tone"), to: at("tone") + 4, added: "wording" }])
  })

  it("leaves an edit that replaces most of the doc to the chat", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Line ${i} says something.`).join("\n")
    const rewritten = Array.from({ length: 30 }, (_, i) => `Row ${i} reads otherwise now.`).join("\n")
    expect(editSpots(EditorState.create({ doc: long }), edit(long, rewritten))).toBeNull()
  })
})
