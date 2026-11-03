import type { GateKey, Paper, PdfState, PdfTry } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { classify, runView, type PdfRun, type RunPaper } from "./runs.ts"

const AT = 1_000
const run = (ids: string[], extra: Partial<PdfRun> = {}): PdfRun => ({ id: "r", started: AT, ids, handed: new Set(ids), away: new Set(), ...extra })
const tryOf = (ended: PdfTry["ended"], host: string, at = AT + 1, by: PdfTry["by"] = "extension"): PdfTry => ({ by, ended, at, host })
const lane = { lane: "site:x" as GateKey, gate: "site:x" as GateKey, attempt: 1, at: "x" }
const held = (wait: GateKey, kind: "sign-in" | "check" | "permission" = "check"): RunPaper => ({ paper: { pdfState: { state: "finding", tried: [], extension: { ...lane, wait, kind, at: "x" } } } })
const inLine = (fetching = false): RunPaper => ({ paper: { pdfState: { state: "finding", tried: [], extension: { ...lane, ...(fetching ? { fetching } : {}) } } } })
const ended = (end: PdfTry["ended"], host: string, at?: number, by?: PdfTry["by"]): RunPaper => {
  const t = tryOf(end, host, at, by)
  return { paper: { pdfState: { state: "no-pdf", tried: [t], reason: t } satisfies PdfState } }
}
const saved = (by: PdfTry["by"]): RunPaper => ({ paper: { pdf: { url: "owlit-file://workspace/x.pdf" } as Paper["pdf"] }, placedBy: by })
const viewOf = (papers: Record<string, RunPaper | undefined>, extra: Partial<PdfRun> = {}, connected = true) => runView(run(Object.keys(papers), extra), new Map(Object.entries(papers)), connected)

describe("a Get PDFs, counted from its papers", () => {
  it("ends as a summary once everything left needs the user: the night of 2026-10-22", () => {
    const papers: Record<string, RunPaper> = {}
    for (let i = 0; i < 23; i++) papers[`tlink${i}`] = held("proxy:tlink.lib.tsinghua.edu.cn", "sign-in")
    papers.oup = held("pub:oup")
    for (let i = 0; i < 7; i++) papers[`apa${i}`] = ended("unreadable", "psycnet.apa.org")
    for (let i = 0; i < 2; i++) papers[`els${i}`] = ended("unreadable", "linkinghub.elsevier.com")
    papers.thieme = ended("unreadable", "www.thieme-connect.com")
    const view = viewOf(papers)
    expect(view).toMatchObject({ total: 34, saved: 0, going: 0, running: false })
    expect(view.waits.map((w) => [w.wait, w.papers])).toEqual([
      ["proxy:tlink.lib.tsinghua.edu.cn", 23],
      ["pub:oup", 1],
    ])
    expect(view.manual.ids).toHaveLength(10)
    expect(view.manual.sites).toEqual([
      { host: "psycnet.apa.org", papers: 7 },
      { host: "linkinghub.elsevier.com", papers: 2 },
      { host: "thieme-connect.com", papers: 1 },
    ])
    expect(view.endedAt).toEqual(expect.any(Number))
  })

  it("goes on while a paper is in line or not handed over yet, and counts what came, and by whom", () => {
    const papers = { queued: inLine(), fetching: inLine(true), came: saved("extension"), found: saved("search"), dropped: saved("person"), before: ended("no-copy", "doi.org", AT - 1), apa: held("pub:apa", "permission"), gone: undefined }
    // Its record is from before the run, and it is still being looked up: not handed over yet
    const view = viewOf(papers, { handed: new Set(Object.keys(papers).filter((id) => id !== "before")) })
    expect(view).toMatchObject({ total: 7, saved: 2, byYou: 1, getting: 1, going: 2, running: true, waits: [{ wait: "pub:apa", papers: 1, ids: ["apa"] }] })
    expect(view).not.toHaveProperty("endedAt")
  })

  it("says which papers have no PDF to be had, which the user found none for, and which they stopped", () => {
    const skipped = tryOf("skipped", "psycnet.apa.org", AT + 2, "person")
    const papers = {
      refused: ended("no-access", "dl.acm.org"),
      left: ended("unreadable", "psycnet.apa.org"),
      skipped: { paper: { pdfState: { state: "no-pdf" as const, tried: [tryOf("unreadable", "psycnet.apa.org"), skipped], reason: skipped } } },
      stopped: ended("stopped", "", AT + 3, "person"),
    }
    expect(viewOf(papers)).toMatchObject({ none: 1, skipped: 1, stopped: 1, manual: { ids: ["left"] }, running: false })
  })

  it("isn't going with no extension connected, nor once stopped, nor for papers never handed over", () => {
    expect(classify("a", inLine(), run(["a"]), false)).toEqual({ kind: "away" })
    expect(classify("a", { paper: { pdfState: { state: "finding", tried: [] } } }, run(["a"], { handed: new Set(), away: new Set(["a"]) }), true)).toEqual({ kind: "away" })
    // Being looked up before its hand-over: going
    expect(classify("a", { paper: { pdfState: { state: "finding", tried: [] } } }, run(["a"], { handed: new Set() }), true)).toEqual({ kind: "going" })
    // Stopped before its hand-over, or dropped from the queue by Stop with nothing noted
    expect(classify("a", { paper: { pdfState: { state: "finding", tried: [] } } }, run(["a"], { stoppedAt: AT + 5 }), true)).toEqual({ kind: "stopped" })
    // Handed over, and since with the extension nowhere (the user got through at a wait with no
    // extension connected): nothing moves it, so it isn't going, connected or not
    const check = tryOf("check", "www.science.org")
    for (const connected of [true, false]) expect(classify("a", { paper: { pdfState: { state: "finding", tried: [check], reason: check } } }, run(["a"]), connected)).toEqual({ kind: "away" })
    expect(classify("a", { paper: { pdfState: { state: "finding", tried: [] } } }, run(["a"]), true)).toEqual({ kind: "away" })
  })

  it("counts the papers held back by a host that didn't answer, by that host, as still going", () => {
    const off = (at: string, until: number): RunPaper => ({ paper: { pdfState: { state: "finding", tried: [], extension: { ...lane, unreachable: { at, until } } } } })
    const view = viewOf({ a: off("journals.sagepub.com", 50), b: off("journals.sagepub.com", 70), c: inLine() })
    expect(view).toMatchObject({ going: 1, running: true, unreachable: [{ at: "journals.sagepub.com", until: 70, papers: 2, ids: ["a", "b"] }] })
    expect(viewOf({ a: off("journals.sagepub.com", 50) })).toMatchObject({ going: 0, running: true })
  })

  it("counts the paper being fetched apart from those in line", () => {
    expect(viewOf({ a: inLine(true), b: inLine(), c: inLine() })).toMatchObject({ getting: 1, going: 2, running: true })
  })

  it("hasn't ended while its papers are still being handed over, though all of them wait for the user now", () => {
    const r = run(["a", "b"], { handing: 1 })
    const papers = new Map([
      ["a", held("pub:sage")],
      ["b", held("pub:sage")],
    ])
    const view = runView(r, papers, true, 5)
    expect(view).toMatchObject({ running: true })
    expect(view).not.toHaveProperty("endedAt")
    expect(r.endedAt).toBeUndefined()
    r.handing = 0
    expect(runView(r, papers, true, 9)).toMatchObject({ running: false, endedAt: 9 })
  })

  it("shows no end while it goes on again after it ended", () => {
    const r = run(["a"])
    runView(r, new Map([["a", held("pub:sage")]]), true, 5)
    const view = runView(r, new Map([["a", inLine()]]), true, 9)
    expect(view).toMatchObject({ running: true })
    expect(view).not.toHaveProperty("endedAt")
    expect(r.endedAt).toBe(5)
  })

  it("writes when it ended once, and keeps it", () => {
    const r = run(["a"])
    runView(r, new Map([["a", inLine()]]), true, 5)
    expect(r.endedAt).toBeUndefined()
    runView(r, new Map([["a", ended("no-copy", "x")]]), true, 10)
    runView(r, new Map([["a", ended("no-copy", "x")]]), true, 20)
    expect(r.endedAt).toBe(10)
  })
})
