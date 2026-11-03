import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FOLLOW_UP_MS, PdfWorkNotes } from "./pdf-work.ts"

const dirs: string[] = []
const dataDir = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-pdf-work-")))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const wait = { gate: "pub:science" as const, since: 1_000, kind: "check" as const, at: "science.org" }

describe("pdf-work.json", () => {
  it("keeps the follow-ups of a wait and the tally, written once a run of changes settles", async () => {
    const dir = dataDir()
    const notes = new PdfWorkNotes(dir, { delayMs: 5 })
    await notes.loaded
    notes.of(wait).opened = { at: 2_000, browser: "Dia" }
    notes.changed()
    notes.handed("pub:science")
    notes.ended("pub:science", "check")
    await vi.waitFor(() => expect(JSON.parse(readFileSync(path.join(dir, "pdf-work.json"), "utf8")).tally["pub:science"]).toMatchObject({ handed: 1, endings: { check: 1 } }))
    // Written whole through a temp file: nothing else is left beside it
    expect(readdirSync(dir)).toEqual(["pdf-work.json"])
    const again = new PdfWorkNotes(dir)
    await again.loaded
    expect(again.upAt("pub:science")).toMatchObject({ since: 1_000, opened: { browser: "Dia" } })
    expect(again.tallies().get("pub:science")).toMatchObject({ handed: 1, pdfs: 0 })
  })

  it("keeps one line going on per gate: getting through there again adds to it, each paper counted from when it went", async () => {
    const notes = new PdfWorkNotes(undefined)
    await notes.loaded
    vi.spyOn(Date, "now").mockReturnValue(5_000)
    notes.of(wait)
    notes.down(wait.gate, wait.since, ["a", "b"])
    // A later wait at the same gate, got through while a and b still go on
    const later = { ...wait, since: 6_000, at: "www.science.org" }
    vi.spyOn(Date, "now").mockReturnValue(7_000)
    notes.of(later)
    notes.down(later.gate, later.since, ["b", "c"])
    expect(notes.gone()).toEqual([expect.objectContaining({ gate: "pub:science", host: "www.science.org", going: { at: 5_000, ids: ["a", "b", "c"], from: { b: 7_000, c: 7_000 } } })])
    vi.restoreAllMocks()
  })

  it("forgets a wait that went a day ago, and what is older than a day in the tally's window", async () => {
    const dir = dataDir()
    const now = Date.now()
    const old = now - FOLLOW_UP_MS - 1
    writeFileSync(
      path.join(dir, "pdf-work.json"),
      JSON.stringify({
        version: 1,
        followUps: [
          { ...wait, host: "science.org", up: false, proxied: false, going: { at: old, ids: ["a"] } },
          { ...wait, since: 3_000, host: "science.org", up: false, proxied: false, going: { at: now, ids: ["b"] } },
        ],
        tally: { "pub:acm": { handed: 9, pdfs: 0, endings: {}, recent: [old, now] } },
      }),
    )
    const notes = new PdfWorkNotes(dir)
    // Handed out before the file was read: added to what it kept
    notes.handed("pub:acm", now)
    await notes.loaded
    expect(notes.gone().map((f) => f.since)).toEqual([3_000])
    expect(notes.tallies().get("pub:acm")).toMatchObject({ handed: 10, recent: [now, now] })
  })

  it("starts afresh from a file it can't read", async () => {
    const dir = dataDir()
    writeFileSync(path.join(dir, "pdf-work.json"), "{ not json")
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const notes = new PdfWorkNotes(dir)
    await notes.loaded
    expect(notes.gone()).toEqual([])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
