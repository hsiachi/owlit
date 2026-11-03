import { describe, expect, it } from "vitest"
import type { Screen } from "./adapter.ts"
import { invariantErrors } from "./invariants.ts"

// The invariants catch what they are for, on screens made by hand

const browser = { tabs: [], going: [], allowAsked: [] }
const science = { kind: "check", host: "science.org", papers: 1, what: "", askedFor: true }

describe("the bench's invariants", () => {
  it("hold on a screen that agrees with itself", () => {
    const screen: Screen = {
      block: { batch: true, total: 2, saved: 1, things: 1, running: false, outside: [], rows: [{ kind: "check", papers: 1, host: "science.org", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: false, title: "", heldAt: { kind: "check", host: "science.org" }, foundUnder: { kind: "check", host: "science.org" } }, b: { hasPdf: true, title: "" } },
      browser,
    }
    expect(invariantErrors(screen)).toEqual([])
  })

  it("catch a paper core holds at a publisher that the window looks for under the proxy's host", () => {
    const screen: Screen = {
      block: { batch: true, total: 1, saved: 0, things: 1, running: false, outside: [], rows: [{ kind: "check", papers: 1, host: "tlink.lib.tsinghua.edu.cn", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: false, title: "", heldAt: { kind: "check", host: "science.org" } } },
      browser,
    }
    expect(invariantErrors(screen)).toEqual([
      "a is held at check:science.org, but the window finds it under no wait",
      "the wait check:science.org says 1 papers, and the window finds 0 under it",
      "the row check:tlink.lib.tsinghua.edu.cn has no wait to act on",
      "a is in the row check:tlink.lib.tsinghua.edu.cn, but its own card is under no wait",
    ])
  })

  it("catch a batch whose rows don't add up, and a saved paper still waiting", () => {
    const screen: Screen = {
      block: { batch: true, total: 3, saved: 1, things: 1, running: false, outside: [], rows: [{ kind: "check", papers: 1, host: "science.org", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: true, title: "", heldAt: { kind: "check", host: "science.org" }, foundUnder: { kind: "check", host: "science.org" } } },
      browser,
    }
    expect(invariantErrors(screen)).toEqual(["a has its PDF and still waits at check:science.org", "a has its PDF and is in the row check:science.org", "the batch counts 2 papers in its rows and saved, of 3"])
  })
})
