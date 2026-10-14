import type { ActivityEvent, JournalEntry } from "@owlit/protocol"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readJournal, readingOf } from "./reading.ts"

const at = 1_790_000_000_000
const user = (e: ActivityEvent): JournalEntry => ({ ...e, actor: "user" })

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

  it("counts a paper as read after two minutes on the paper itself", () => {
    const focus = (seconds: number) => user({ kind: "paper.focus", at, paperId: "p", view: "pdf", seconds })
    expect(readingOf([focus(30), focus(30), focus(30), focus(29)]).get("p")?.read).toBe(false)
    expect(readingOf([focus(30), focus(30), focus(30), focus(30)]).get("p")?.read).toBe(true)
  })

  it("doesn't count reading the digest, however long, as reading the paper", () => {
    const papers = readingOf([user({ kind: "paper.focus", at, paperId: "p", view: "digest", seconds: 900 })])
    expect(papers.get("p")?.read).toBe(false)
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

  it("ignores what agents did and follows a paper that changed id", () => {
    const papers = readingOf(
      [
        { kind: "agent.wrote", at, path: "a.md", versionId: "v", actor: "agent" },
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
    expect(await readJournal(file)).toEqual([{ kind: "paper.opened", at, paperId: "p", actor: "user" }])
    expect(await readJournal(path.join(path.dirname(file), "missing.jsonl"))).toEqual([])
  })
})
