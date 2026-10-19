import type { ActivityEvent, JournalEntry } from "@owlit/protocol"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { fullReadAt, readInFull, readJournal, readingOf, traceOf } from "./reading.ts"
import { ME, MY_OWLIT } from "../test-util.ts"

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
      digestEnd: false,
    })
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
    expect(papers.get("doi-10.1-x")).toMatchObject({ pdfSeconds: 120 })
  })
})

describe("readJournal", () => {
  it("reads entries in order and skips a line cut short", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "owlit-reading-")), "journal.jsonl")
    writeFileSync(file, [JSON.stringify(user({ kind: "paper.opened", at, paperId: "p" })), '{"kind":"paper.fo', ""].join("\n"))
    expect(await readJournal(file)).toEqual([{ kind: "paper.opened", at, paperId: "p", actor: ME }])
    expect(await readJournal(path.join(path.dirname(file), "missing.jsonl"))).toEqual([])
  })

  it("skips the kinds owlit doesn't write, which older journals hold", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "owlit-reading-")), "journal.jsonl")
    const opened = user({ kind: "paper.opened", at, paperId: "p" })
    const old = [
      { kind: "evaluation", at: at + 1, rule: "paper.readInFull", subject: "p", decision: "job", taskId: "t1", cause: "paper.read", causeAt: at, actor: MY_OWLIT },
      { kind: "rule.looked", at: at + 1, rule: "paper.readInFull", cause: "paper.read", causeAt: at, reads: [], actor: MY_OWLIT },
      { kind: "paper.read", at, paperId: "p", actor: MY_OWLIT },
      { kind: "feedback.dismiss", at: at + 2, subject: "a.md", detail: { comment: "c1" }, actor: ME },
      { kind: "idle", at: at + 3, seconds: 30, actor: ME },
      { kind: "back", at: at + 4, seconds: 90, actor: ME },
      { kind: "doc.closed", at: at + 5, path: "a.md", actor: ME },
    ]
    writeFileSync(file, [opened, ...old].map((e) => JSON.stringify(e)).join("\n") + "\n")
    expect(await readJournal(file)).toEqual([opened])
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

  it("is the digest's end reached, with two minutes on the digest in all", () => {
    const focus = (seconds: number) => user({ kind: "paper.focus", at, paperId: "p", view: "digest", seconds })
    const end = user({ kind: "paper.end", at, paperId: "p", view: "digest" })
    expect(readInFull(readingOf([focus(60), focus(59), end]).get("p"), 10)).toBe(false)
    expect(readInFull(readingOf([focus(60), focus(60)]).get("p"), 10)).toBe(false)
    expect(readInFull(readingOf([focus(60), end, focus(60)]).get("p"), 10)).toBe(true)
    expect(readInFull(readingOf([focus(120), end]).get("p"), null)).toBe(true)
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

describe("traceOf", () => {
  it("is Read from the status, looked at from a visit or Reading, and nothing for a paper never opened", () => {
    const reading = readingOf([
      user({ kind: "paper.opened", at, paperId: "p" }),
      user({ kind: "paper.focus", at, paperId: "p", view: "pdf", seconds: 720 }),
      ...[3, 1, 2].map((page) => user({ kind: "paper.dwell", at, paperId: "p", page, seconds: 20 })),
    ]).get("p")
    expect(traceOf(reading, "unread")).toEqual({ state: "looked", pdfSeconds: 720, digestSeconds: 0, pages: [1, 2, 3] })
    expect(traceOf(reading, "read").state).toBe("read")
    expect(traceOf(undefined, "read").state).toBe("read")
    expect(traceOf(undefined, "reading").state).toBe("looked")
    expect(traceOf(undefined, "unread")).toEqual({ state: "none", pdfSeconds: 0, digestSeconds: 0, pages: [] })
  })
})
