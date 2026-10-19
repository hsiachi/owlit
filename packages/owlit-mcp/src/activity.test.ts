import { describe, expect, it } from "vitest"
import { activityQueryOf, activityText, clock, duration, pageRanges, parseWhen, traceText } from "./activity.ts"

const now = new Date("2026-10-14T12:00").getTime()

describe("activity_read's arguments", () => {
  it("reads times back from now and dates", () => {
    expect(parseWhen("7d", now)).toBe(now - 7 * 86_400_000)
    expect(parseWhen("24h", now)).toBe(now - 86_400_000)
    expect(parseWhen("2w", now)).toBe(now - 14 * 86_400_000)
    expect(parseWhen("2026-10-07", now)).toBe(new Date("2026-10-07T00:00").getTime())
    expect(parseWhen(undefined, now)).toBeUndefined()
    expect(() => parseWhen("last week", now)).toThrow(/can't read the time/)
  })

  it("keeps only what each mode takes", () => {
    expect(activityQueryOf({ mode: "recent", since: "7d", paper: "p1" }, now)).toEqual({ mode: "recent", since: now - 7 * 86_400_000 })
    expect(activityQueryOf({ mode: "of", paper: "p1", since: "7d" }, now)).toEqual({ mode: "of", paper: "p1" })
    expect(activityQueryOf({ mode: "log", actor: "agent", limit: 5 }, now)).toEqual({ mode: "log", actor: "agent", limit: 5 })
    expect(() => activityQueryOf({ mode: "all" }, now)).toThrow(/mode is one of/)
  })
})

describe("activity_read's answer", () => {
  it("says how far the user got with a paper in three states", () => {
    expect(traceText({ state: "read", pdfSeconds: 0, digestSeconds: 0, pages: [] })).toBe("read in full")
    expect(traceText({ state: "looked", pdfSeconds: 720, digestSeconds: 0, pages: [1, 2, 3, 4, 5, 6] })).toBe("looked at: 12 min, pp. 1–6")
    expect(traceText({ state: "looked", pdfSeconds: 0, digestSeconds: 180, pages: [] })).toBe("looked at: the digest, 3 min")
    expect(traceText({ state: "none", pdfSeconds: 0, digestSeconds: 0, pages: [] })).toBe("not opened here")
  })

  it("writes durations, pages and times plainly", () => {
    expect(duration(40)).toBe("40 s")
    expect(duration(12 * 60 + 20)).toBe("12 min")
    expect(duration(80 * 60)).toBe("1 h 20 min")
    expect(pageRanges([7, 3, 4, 5])).toBe("pp. 3–5, 7")
    expect(pageRanges([4])).toBe("p. 4")
    expect(clock(new Date("2026-10-12T09:05").getTime())).toBe("2026-10-12 09:05")
  })

  it("lists what the user did, one fact per item", () => {
    const text = activityText(
      {
        recording: true,
        since: now - 7 * 86_400_000,
        items: [
          { kind: "paper", id: "p1", title: "Paper One", first: now, last: now, visits: 2, pdfSeconds: 900, digestSeconds: 0, pages: { 3: 400, 4: 300, 5: 200 }, highlights: 2, noted: false, starred: true, trace: { state: "read", pdfSeconds: 900, digestSeconds: 0, pages: [3, 4, 5] } },
          { kind: "doc", path: "notes/a.md", first: now, last: now, opens: 1, edits: 3, agentEdits: 0 },
        ],
      },
      { mode: "top" },
    )
    expect(text).toBe(
      [
        "What the user did since 2026-10-07 12:00, what the user spent the most on first:",
        '- paper p1 · "Paper One" · last 2026-10-14 12:00 · opened 2 times · 15 min on the PDF (pp. 3–5) · 2 highlights · starred it · read in full',
        "- doc notes/a.md · last 2026-10-14 12:00 · opened once · edited 3 times",
      ].join("\n"),
    )
  })

  it("tells the agent to ask when recording is off, and says when nothing was recorded", () => {
    expect(activityText({ recording: false }, { mode: "recent" })).toMatch(/turned off "Remember what I do in owlit"/)
    expect(activityText({ recording: true, since: now, items: [] }, { mode: "recent" })).toBe("Nothing recorded since 2026-10-14 12:00.")
    expect(activityText({ recording: true, items: [], lines: [] }, { mode: "of", paper: "p9" })).toBe("Nothing is recorded about the paper p9.")
  })

  it("gives a paper's history and the sentences Owlit cited from it", () => {
    const text = activityText(
      {
        recording: true,
        items: [{ kind: "paper", id: "p1", title: "Paper One", first: now, last: now, visits: 1, pdfSeconds: 0, digestSeconds: 200, pages: {}, highlights: 0, noted: false, trace: { state: "looked", pdfSeconds: 0, digestSeconds: 200, pages: [] } }],
        lines: [{ at: now, actor: "user", what: "looked at", paper: { id: "p1", title: "Paper One" }, seconds: 200, detail: "the digest only" }],
        cited: [{ quote: "A sentence.", page: 4, chatId: "c1", chatTitle: "Why", at: now }],
      },
      { mode: "of", paper: "p1" },
    )
    expect(text).toContain("In all: paper p1 · \"Paper One\" · last 2026-10-14 12:00 · opened once · 3 min on the digest · looked at: the digest, 3 min")
    expect(text).toContain('History:\n2026-10-14 12:00 · the user looked at "Paper One" (p1) for 3 min (the digest only)')
    expect(text).toContain('Sentences Owlit\'s answers cited from it:\n- 2026-10-14 12:00 in "Why" (c1), p. 4: "A sentence."')
  })
})
