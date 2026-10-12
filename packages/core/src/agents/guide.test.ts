import { describe, expect, it } from "vitest"
import { guide } from "./guide.ts"

describe("guide", () => {
  it("lists its topics, with how to link to Settings", () => {
    const list = guide()
    expect(list).toMatch(/^How to use owlit\. Ask for one topic:\n- workspace: The workspace\n/)
    expect(list).toMatch(/owlit:\/\/settings\/proxy/)
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
