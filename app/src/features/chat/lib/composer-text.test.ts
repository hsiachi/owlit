import { getSchema } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { describe, expect, it } from "vitest"
import { composerText } from "./composer-text"

const schema = getSchema([StarterKit])
const p = (text?: string) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) })
const item = (...content: object[]) => ({ type: "listItem", content })
const doc = (...content: object[]) => schema.nodeFromJSON({ type: "doc", content })
const text = (...content: object[]) => composerText(doc(...content), []).text

describe("composerText", () => {
  it("keeps paragraphs and hard breaks as lines", () => {
    expect(text({ type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }, p("three"))).toBe("one\ntwo\nthree")
  })

  it("writes lists as Markdown, nested two spaces in", () => {
    const list = {
      type: "bulletList",
      content: [item(p("Compare the baselines"), { type: "orderedList", attrs: { start: 1 }, content: [item(p("BM25")), item(p("DPR"))] }), item(p("Then summarise"))],
    }
    expect(text(p("Please:"), list, p("Thanks"))).toBe("Please:\n- Compare the baselines\n  1. BM25\n  2. DPR\n- Then summarise\nThanks")
  })

  it("puts an item's further lines under its text", () => {
    const list = { type: "orderedList", attrs: { start: 3 }, content: [item({ type: "paragraph", content: [{ type: "text", text: "first" }, { type: "hardBreak" }, { type: "text", text: "more" }] }), item(p())] }
    expect(text(list)).toBe("3. first\n  more\n4.")
  })
})
