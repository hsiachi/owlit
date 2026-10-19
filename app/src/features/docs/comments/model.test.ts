import { describe, expect, it } from "vitest"
import type { DocComment, PersonId, ShareComment } from "@owlit/protocol"
import { commentViews } from "./model"

const doc = (id: string, createdAt: number, extra: Partial<DocComment> = {}): DocComment => ({
  id,
  quote: "the words",
  prefix: "",
  suffix: "",
  entries: [{ id: `${id}-1`, by: "o_1", text: "a remark", at: createdAt }],
  createdAt,
  ...extra,
})

const me: PersonId = "p_1"

describe("commentViews", () => {
  it("draws Owlit's, yours and readers' comments as one list, in the order they were started", () => {
    const readers: ShareComment[] = [
      { id: "r1", anchor: { quote: "q", prefix: "", suffix: "" }, name: "Dang", by: "reader", text: "Too strong?", at: 2 },
      { id: "r2", anchor: null, parent: "r1", name: "Xia", by: "author", text: "Agreed.", at: 4 },
    ]
    const views = commentViews([doc("c3", 3), doc("c1", 1, { entries: [{ id: "y", by: me, text: "mine", at: 1 }] })], readers, me)
    expect(views.map((v) => v.key)).toEqual(["c:c1", "r:r1", "c:c3"])
    expect(views[0].entries[0]).toMatchObject({ who: "you", editable: true })
    // A reader's thread: the reader by name, your reply as yours, neither editable (the share server keeps them)
    expect(views[1].entries.map((e) => [e.who, e.name, e.editable])).toEqual([
      ["person", "Dang", false],
      ["you", "You", false],
    ])
    expect(views[2].entries[0]).toMatchObject({ who: "owlit", name: "Owlit", editable: false })
  })

  it("leaves out resolved comments and resolved reader threads", () => {
    const readers: ShareComment[] = [{ id: "r1", anchor: { quote: "q", prefix: "", suffix: "" }, name: "Dang", by: "reader", text: "x", at: 2, resolved: true }]
    expect(commentViews([doc("c1", 1, { resolvedAt: 5 })], readers, me)).toEqual([])
  })

  it("finds a comment's passage by its words and the text around them", () => {
    const [view] = commentViews([doc("c1", 1, { quote: "words", prefix: "the ", suffix: " again" })], [])
    expect(view.find("words, and the words again")).toEqual({ from: 15, to: 20 })
  })
})
