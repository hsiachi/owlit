import { describe, expect, it } from "vitest"
import type { DocComment } from "@owlit/protocol"
import { guide } from "../agents/guide.ts"
import { correctionOf } from "../docs/comments.ts"
import { goThroughRecipe } from "./go-through.ts"
import { replyRecipe } from "./reply.ts"
import { reviewRecipe } from "./review.ts"
import { reviseRecipe } from "./revise.ts"
import { RECIPES } from "./index.ts"

describe("the Go through recipe", () => {
  it("has the reading written first with docs_write, then the points as comments pointing back to it", () => {
    const recipe = goThroughRecipe()
    expect(recipe).toContain("read it whole with docs_read")
    expect(recipe).toContain("docs_list lists the workspace's docs")
    expect(recipe).toContain('" · reading"')
    expect(recipe).toContain("with docs_add_comment and record set to the record's path")
    expect(recipe.indexOf("docs_write")).toBeLessThan(recipe.indexOf("docs_add_comment"))
    // Kept apart, never guessed
    expect(recipe).toContain("Most things that sound like a decision are this")
    expect(recipe).toContain("never guess a name from context")
    expect(RECIPES["go-through"].text(undefined)).toBe(recipe)
    expect(guide()).toMatch(/- go-through: go through material from people/)
  })
})

describe("the review and revise recipes", () => {
  it("reviews without changing anything, starting from earlier comments, and answers a point that stands under its old comment", () => {
    const recipe = reviewRecipe()
    expect(recipe).toContain("You change nothing in the doc")
    expect(recipe.indexOf("docs_comments")).toBeLessThan(recipe.indexOf("docs_add_comment"))
    expect(recipe).toContain("reply under that comment with comments_reply")
    expect(recipe).toContain('"Your call:"')
    expect(RECIPES.review.text(undefined)).toBe(recipe)
    expect(guide()).toMatch(/- review: read the user's doc as a reader would/)
  })

  it("works through a paragraph at a time and resolves with what happened, leaving the person's calls to them", () => {
    const recipe = reviseRecipe()
    for (const reply of ['"Done: …"', '"Partly: …"', '"Not taken (Owlit): …"', '"Not taken (you): …"']) expect(recipe).toContain(reply)
    expect(recipe).toContain("put the choice to them in the chat")
    expect(recipe).toContain('"Moved to <file>"')
    expect(RECIPES.revise.text(undefined)).toBe(recipe)
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
