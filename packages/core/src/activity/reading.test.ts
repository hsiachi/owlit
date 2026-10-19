import type { ActivityEvent, JournalEntry } from "@owlit/protocol"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { fullReadAt, readInFull, readJournal, readingOf } from "./reading.ts"
import { ME } from "../test-util.ts"

const at = 1_790_000_000_000
const user = (e: ActivityEvent): JournalEntry => ({ ...e, actor: ME })

describe("readingOf", () => {
  it("adds up time on the paper, by side, and on each page", () => {
    const papers = readingOf([
      user({ kind: "paper.opened", at, paperId: "p" }),
      user({ kind: "paper.focus", at: at + 30_000, paperId: "p", view: "digest", seconds: 30 }),
      user({ kind: "paper.focus", at: at + 60_000, paperId: "p", view: "pdf", seconds: 30 }),
      user({ kind: "paper.dwell", at: at + 60_000, paperId: "p", page: 2, seconds: 20 }),
      user({ kind: "paper.dwell", at: at + 60_000, paperId: "p", page: 3, seconds: 10 }),
      user({ kind: "paper.closed", at: at + 61_000, paperId: "p" }),
      user({ kind: "paper.opened", at: at + 90_000, paperId: "p" }),
      user({ kind: "paper.dwell", at: at + 95_000, paperId: "p", page: 2, seconds: 5 }),
    ])
    expect(papers.get("p")).toMatchObject({
      pdfSeconds: 30,
      digestSeconds: 30,
      pages: { 2: 25, 3: 10 },
      visits: 2,
      firstAt: at,
      lastAt: at + 95_000,
      read: false,
    })
  })

  it("counts a paper as read after two minutes on it, the PDF and the digest together", () => {
    const focus = (view: "pdf" | "digest", seconds: number) => user({ kind: "paper.focus", at, paperId: "p", view, seconds })
    expect(readingOf([focus("pdf", 30), focus("pdf", 30), focus("digest", 30), focus("digest", 29)]).get("p")?.read).toBe(false)
    expect(readingOf([focus("pdf", 30), focus("pdf", 30), focus("digest", 30), focus("digest", 30)]).get("p")?.read).toBe(true)
    expect(readingOf([focus("digest", 120)]).get("p")?.read).toBe(true)
  })

  it("counts a highlight, a note or a star as read at any length", () => {
    const papers = readingOf([
      user({ kind: "highlight.added", at, paperId: "h", highlightId: "x" }),
      user({ kind: "note.edited", at, paperId: "n" }),
      user({ kind: "paper.marked", at, paperId: "s", mark: { what: "starred", to: true } }),
      user({ kind: "paper.marked", at, paperId: "s", mark: { what: "starred", to: false } }),
      user({ kind: "paper.marked", at, paperId: "t", mark: { what: "tags", to: ["method"] } }),
    ])
    expect([...papers.values()].map((p) => [p.paperId, p.read])).toEqual([
      ["h", true],
      ["n", true],
      ["s", true],
      ["t", false],
    ])
  })

  it("doesn't count a paper only opened and closed", () => {
    const papers = readingOf([user({ kind: "paper.opened", at, paperId: "p" }), user({ kind: "paper.closed", at: at + 4000, paperId: "p" })])
    expect(papers.get("p")).toMatchObject({ visits: 1, read: false })
  })

  it("takes visits from closings in a journal from before openings were kept", () => {
    const papers = readingOf([user({ kind: "paper.closed", at, paperId: "p" }), user({ kind: "paper.closed", at: at + 1, paperId: "p" })])
    expect(papers.get("p")?.visits).toBe(2)
  })

  it("follows a paper that changed id", () => {
    const papers = readingOf(
      [
        user({ kind: "paper.focus", at, paperId: "local-abc", view: "pdf", seconds: 90 }),
        user({ kind: "paper.focus", at: at + 1, paperId: "doi-10.1-x", view: "pdf", seconds: 30 }),
      ],
      (id) => (id === "local-abc" ? "doi-10.1-x" : id),
    )
    expect([...papers.keys()]).toEqual(["doi-10.1-x"])
    expect(papers.get("doi-10.1-x")).toMatchObject({ pdfSeconds: 120, read: true })
  })
})

describe("readJournal", () => {
  it("reads entries in order and skips a line cut short", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "owlit-reading-")), "journal.jsonl")
    writeFileSync(file, [JSON.stringify(user({ kind: "paper.opened", at, paperId: "p" })), '{"kind":"paper.fo', ""].join("\n"))
    expect(await readJournal(file)).toEqual([{ kind: "paper.opened", at, paperId: "p", actor: ME }])
    expect(await readJournal(path.join(path.dirname(file), "missing.jsonl"))).toEqual([])
  })
})

describe("readInFull", () => {
  const dwell = (page: number, at2 = at) => user({ kind: "paper.dwell", at: at2, paperId: "p", page, seconds: 20 })
  it("is most of the paper's pages read at the top of the screen, or a long stay without a page count", () => {
    const reading = readingOf([1, 2, 3, 4, 5, 6].map((p) => dwell(p))).get("p")
    expect(readInFull(reading, 10)).toBe(true)
    expect(readInFull(reading, 11)).toBe(false)
    expect(readInFull(reading, null)).toBe(false)
    expect(readInFull(readingOf([user({ kind: "paper.focus", at, paperId: "p", view: "pdf", seconds: 900 })]).get("p"), null)).toBe(true)
  })

  it("is said on the visit that got there, once", () => {
    const visit = (from: number, pages: number[]) => [
      user({ kind: "paper.opened", at: from, paperId: "p" }),
      ...pages.map((p) => dwell(p, from + p * 1000)),
      user({ kind: "paper.closed", at: from + 60_000, paperId: "p" }),
    ]
    const first = visit(at, [1, 2, 3])
    const second = visit(at + 100_000, [4, 5, 6])
    const third = visit(at + 200_000, [7])
    const all = [...first, ...second, ...third]
    expect(fullReadAt(all, "p", at + 60_000, 10)).toBe(false)
    expect(fullReadAt(all, "p", at + 160_000, 10)).toBe(true)
    expect(fullReadAt(all, "p", at + 260_000, 10)).toBe(false)
  })
})
