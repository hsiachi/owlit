import { describe, expect, it } from "vitest"
import { guide } from "./guide.ts"

describe("guide", () => {
  it("lists its topics, with how to link to Settings", () => {
    const list = guide()
    expect(list).toMatch(/^How to use owlit\. Ask for one topic:\n- workspace: The workspace\n/)
    expect(list).toMatch(/owlit:\/\/settings\/proxy/)
    expect(list).toMatch(/\nRecipes: .*\n- threads: .*\n- go-through: .*\n- reply: /s)
  })

  it("serves the threads skill whole, by its name alone", () => {
    const skill = guide("threads")
    expect(skill).toBe(guide(" Threads "))
    expect(skill).toMatch(/^# Threads: how to work on one\n/)
    // Every part, to the last
    for (const part of ["## What a thread is", "## 1. Before searching", "## 2. Is there a thread already?", "## 3. Choose the shape", "## 4. Method", "## 5. Rows", "## 6. The report", "## 7. Title", "## 8. Changing a thread"])
      expect(skill).toContain(part)
    expect(skill).toMatch(/owlit records each batch's question in About\)\.$/)
    // One way to name a paper in the report: its short title
    expect(skill).toContain("`[CiteSee](owlit://library/<id>)`")
    expect(skill).not.toMatch(/\[[A-Z][a-z]+ (et al\. )?\d{4}\]\(owlit/)
  })

  it("gives one topic by its id or by a word in it", () => {
    expect(guide("pdfs")).toMatch(/^Getting PDFs \(library proxy\)\n\n.*library proxy once in Settings › Papers/s)
    expect(guide("highlight")).toMatch(/^Reading and highlighting\n/)
    expect(guide("Zotero")).toMatch(/^Adding papers\n/)
  })

  it("says when it has nothing on a topic", () => {
    expect(guide("telepathy")).toMatch(/^There is no topic "telepathy"\. The topics:\n- workspace/)
  })
})
