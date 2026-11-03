import { describe, expect, it } from "vitest"
import type { Screen } from "./adapter.ts"
import { invariantErrors } from "./invariants.ts"

// The invariants catch what they are for, on screens made by hand

const browser = { tabs: [], going: [], allowAsked: [] }
const science = { id: "pub:science", kind: "check", host: "science.org", papers: 1, what: "", askedFor: true }

describe("the bench's invariants", () => {
  it("hold on a screen that agrees with itself", () => {
    const screen: Screen = {
      block: { batch: true, total: 2, saved: 1, byYou: 0, things: 1, running: false, ended: false, outside: [], rows: [{ kind: "check", papers: 1, wait: "pub:science", host: "science.org", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: false, title: "", heldAt: "pub:science", foundUnder: "pub:science" }, b: { hasPdf: true, title: "" } },
      silent: [],
      inLine: 0,
      browser,
    }
    expect(invariantErrors(screen)).toEqual([])
  })

  it("catch a paper core holds under a wait the window doesn't list, and a row for it", () => {
    const screen: Screen = {
      block: { batch: true, total: 1, saved: 0, byYou: 0, things: 1, running: false, ended: false, outside: [], rows: [{ kind: "check", papers: 1, wait: "proxy:tlink.lib.tsinghua.edu.cn", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: false, title: "", heldAt: "proxy:tlink.lib.tsinghua.edu.cn" } },
      silent: [],
      inLine: 0,
      browser,
    }
    expect(invariantErrors(screen)).toEqual([
      "a is held at proxy:tlink.lib.tsinghua.edu.cn, but the window finds it under no wait",
      "the wait pub:science says 1 papers, and the window finds 0 under it",
      "the row wait proxy:tlink.lib.tsinghua.edu.cn has no wait to act on",
      "a is in the row wait proxy:tlink.lib.tsinghua.edu.cn, but its own card is under no wait",
    ])
  })

  it("catch a batch whose rows don't add up, and a saved paper still waiting", () => {
    const screen: Screen = {
      block: { batch: true, total: 3, saved: 1, byYou: 0, things: 1, running: false, ended: false, outside: [], rows: [{ kind: "check", papers: 1, wait: "pub:science", host: "science.org", ids: ["a"] }] },
      waits: [science],
      papers: { a: { hasPdf: true, title: "", heldAt: "pub:science", foundUnder: "pub:science" } },
      silent: [],
      inLine: 0,
      browser,
    }
    expect(invariantErrors(screen)).toEqual(["a has its PDF and still waits at pub:science", "a has its PDF and is in the row wait pub:science", "the batch counts 2 papers in its rows and saved, of 3"])
  })

  it("catch a batch that spins with nothing in line, and a gate that gives nothing without a wait", () => {
    const screen: Screen = {
      block: { batch: true, total: 1, saved: 0, byYou: 0, things: 0, running: true, ended: false, outside: [], rows: [{ kind: "none", papers: 1 }] },
      waits: [],
      papers: { a: { hasPdf: false, title: "" } },
      silent: ["pub:acm"],
      inLine: 0,
      browser,
    }
    expect(invariantErrors(screen)).toEqual(["the batch says it is getting PDFs, and nothing is in line at the extension", "the batch says it is getting PDFs, with nothing in line", "pub:acm was handed papers all day and gave no PDF, with no wait to say why"])
  })
})
