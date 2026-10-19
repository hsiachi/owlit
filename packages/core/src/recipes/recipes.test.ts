import { describe, expect, it } from "vitest"
import type { DocComment } from "@owlit/protocol"
import { guide } from "../agents/guide.ts"
import { correctionOf } from "../docs/comments.ts"
import { goThroughRecipe } from "./go-through.ts"
import { replyRecipe } from "./reply.ts"
import { RECIPES } from "./index.ts"

const input = {
  path: "Meetings/P5 周会.md",
  record: "Meetings/P5 周会 · 解读.md",
  recordLabel: "P5 周会 · 解读",
  materialLink: "owlit://docs/Meetings/P5%20%E5%91%A8%E4%BC%9A.md",
  chinese: true,
  docs: ["story.md"],
  today: "2026-10-16",
}

describe("the Go through recipe", () => {
  it("has the record written first with docs_write, the material below a link, then the points as comments pointing back to it", () => {
    const recipe = goThroughRecipe(input)
    expect(recipe).toContain("as a new doc of your own with docs_write at Meetings/P5 周会 · 解读.md")
    expect(recipe).toContain("## 原文\n\n- [P5 周会](owlit://docs/Meetings/P5%20%E5%91%A8%E4%BC%9A.md)")
    expect(recipe).toContain("## Owlit 的解读")
    expect(recipe).toContain("the workspace's docs are story.md")
    expect(recipe).toContain("[P5 周会 · 解读](owlit://docs/Meetings/P5%20%E5%91%A8%E4%BC%9A%20%C2%B7%20%E8%A7%A3%E8%AF%BB.md)")
    expect(recipe.indexOf("docs_write")).toBeLessThan(recipe.indexOf("docs_add_comment"))
    // Kept apart, never guessed
    expect(recipe).toContain("Most things that sound like a decision are this")
    expect(recipe).toContain("never guess a name from context")
  })

  it("says how to find the material, the docs and the record's place when served to a chat", () => {
    const recipe = goThroughRecipe()
    expect(recipe).toContain("read it whole with docs_read")
    expect(recipe).toContain("docs_list lists the workspace's docs")
    expect(recipe).toContain('" · reading"')
    expect(RECIPES["go-through"].text(undefined)).toBe(recipe)
    expect(guide()).toMatch(/- go-through: go through material from people/)
  })
})

const comment = (by: string, source?: DocComment["source"]): DocComment => ({
  id: "c1",
  quote: "Replay ratings track the live ones.",
  prefix: "",
  suffix: "",
  entries: [
    { id: "e1", by: by as DocComment["entries"][0]["by"], text: "They drift apart after a week.", at: 1 },
    { id: "e2", by: "p_1234abcd", text: "Where does it say so?", at: 2 },
  ],
  createdAt: 1,
  ...(source ? { source } : {}),
})

describe("the reply recipe", () => {
  it("answers with comments_reply on that comment, with the thread so far, and corrects only Owlit's own words", () => {
    const recipe = replyRecipe({ path: "story.md", content: "# Story\n\nReplay ratings track the live ones.\n", comment: comment("o_1234abcd") })
    expect(recipe).toContain('comments_reply (path "story.md", id "c1")')
    expect(recipe).toContain("Owlit: They drift apart after a week.\n\nThe user: Where does it say so?")
    expect(recipe).toContain("CORRECT:")
    const carried = replyRecipe({ path: "story.md", content: "", comment: comment("o_1234abcd", { path: "m · reading.md", label: "m · reading" }) })
    expect(carried).not.toContain("CORRECT:")
    expect(RECIPES.reply.text(undefined)).toContain("comments_reply")
  })

  it("reads a correction as the rewritten entry after CORRECT:, and nothing else as one", () => {
    expect(correctionOf("CORRECT:  The right words.")).toBe("The right words.")
    expect(correctionOf("Still holds.")).toBeNull()
    expect(correctionOf("CORRECT:")).toBeNull()
  })
})
