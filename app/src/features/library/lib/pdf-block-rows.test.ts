import type { ExtensionWait, Paper, PdfRunView } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { blockRows, handDownloads } from "./pdf-block-rows"

const run = (over: Partial<PdfRunView> = {}): PdfRunView => ({ id: "r", started: 0, ids: [], total: 0, saved: 0, byYou: 0, waits: [], manual: { ids: [], sites: [] }, none: 0, skipped: 0, stopped: 0, getting: 0, going: 0, closed: 0, unreachable: [], away: 0, running: true, ...over })
const wait = (papers: number): ExtensionWait => ({ id: "pub:sage", at: "sagepub.com", watch: [], kind: "check", host: "sagepub.com", papers, url: "https://journals.sagepub.com/", askedFor: true, proxied: false, since: 0 })
const held = { pdfState: { state: "finding" as const, tried: [], extension: { lane: "pub:sage" as const, gate: "pub:sage" as const, attempt: 1, wait: "pub:sage" as const, kind: "check" as const, at: "sagepub.com" } } }

describe("the PDF block's rows", () => {
  it("count a wait the run shares with other papers as much as Home does, the others in a row outside", () => {
    const { rows, outside } = blockRows(run({ ids: ["a", "b"], waits: [{ wait: "pub:sage", papers: 2, ids: ["a", "b"] }] }), [wait(5)], { a: held, b: held })
    expect(rows).toMatchObject([{ kind: "wait", papers: 2 }])
    expect(outside).toMatchObject([{ kind: "wait", papers: 3 }])
  })

  it("show no row outside when the run has the whole wait", () => {
    const { outside } = blockRows(run({ ids: ["a", "b"], waits: [{ wait: "pub:sage", papers: 2, ids: ["a", "b"] }] }), [wait(2)], { a: held, b: held })
    expect(outside).toEqual([])
  })
})

describe("papers to download by hand", () => {
  const manual = (id: string) => ({ id, pdfState: { state: "no-pdf", tried: [], reason: { by: "extension", ended: "unreadable", at: 1 } } }) as unknown as Paper

  it("are those the run's own row doesn't have", () => {
    const papers = [manual("mine"), manual("before")]
    expect(handDownloads(papers, run({ total: 1, manual: { ids: ["mine"], sites: [] } })).map((p) => p.id)).toEqual(["before"])
    expect(handDownloads(papers, undefined).map((p) => p.id)).toEqual(["mine", "before"])
  })
})
