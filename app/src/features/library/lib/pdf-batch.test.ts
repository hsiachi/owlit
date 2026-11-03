import type { ExtensionWait, Paper, PdfState, PdfTry } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { batchView, outsideRows, siteRows } from "./pdf-batch"

const AT = 1_000
const paper = (id: string, extra: Partial<Paper> = {}): Paper => ({ id, title: id, authors: [], ids: { doi: `10.1/${id}` }, tags: [], starred: false, status: "unread", addedAt: 0, ...extra }) as Paper
const tryOf = (ended: PdfTry["ended"], host: string, at = AT + 1, by: PdfTry["by"] = "extension"): PdfTry => ({ by, ended, at, host })
const held = (id: string, kind: ExtensionWait["kind"], host: string, proxied = false) => paper(id, { pdfState: { state: "finding", tried: [], extension: { host, waits: kind, ...(proxied ? { proxied } : {}) } } })
const inLine = (id: string, fetching = false) => paper(id, { pdfState: { state: "finding", tried: [], extension: { host: "sagepub.com", ...(fetching ? { fetching } : {}) } } })
const ended = (id: string, ended: PdfTry["ended"], host: string, at?: number): Paper => {
  const t = tryOf(ended, host, at)
  return paper(id, { pdfState: { state: "no-pdf", tried: [t], reason: t } satisfies PdfState })
}
const byId = (papers: Paper[]) => Object.fromEntries(papers.map((p) => [p.id, p]))

describe("a batch of papers sent to the extension", () => {
  it("ends as a summary once everything left needs the user: the night of 2026-10-22", () => {
    const papers = [
      ...Array.from({ length: 23 }, (_, i) => held(`tlink${i}`, "sign-in", "tlink.lib.tsinghua.edu.cn", true)),
      held("oup", "check", "oup.com"),
      ...Array.from({ length: 7 }, (_, i) => ended(`apa${i}`, "unreadable", "psycnet.apa.org")),
      ...Array.from({ length: 2 }, (_, i) => ended(`els${i}`, "unreadable", "linkinghub.elsevier.com")),
      ended("thieme", "unreadable", "www.thieme-connect.com"),
    ]
    const view = batchView({ ids: papers.map((p) => p.id), at: AT }, byId(papers))
    expect(view).toMatchObject({ total: 34, saved: 0, held: 24, things: 2, running: false })
    expect(view.rows.map((r) => [r.kind, r.papers])).toEqual([
      ["sign-in", 23],
      ["check", 1],
      ["manual", 10],
    ])
    expect(view.rows[0]).toMatchObject({ host: "tlink.lib.tsinghua.edu.cn", proxied: true })
    expect(view.rows[2].sites).toEqual([
      { host: "psycnet.apa.org", papers: 7 },
      { host: "linkinghub.elsevier.com", papers: 2 },
      { host: "thieme-connect.com", papers: 1 },
    ])
  })

  it("runs while a paper is in line or not handed over yet, and counts what came", () => {
    const papers = [
      inLine("queued"),
      inLine("fetching", true),
      paper("saved", { pdf: { url: "owlit-file://workspace/x.pdf" } }),
      // Its record is from before the batch: the extension hasn't had it yet
      ended("before", "no-copy", "doi.org", AT - 1),
      held("apa", "permission", "tlink.lib.tsinghua.edu.cn", true),
    ]
    papers[4].pdfState!.extension!.waitsAt = "apa.org"
    const view = batchView({ ids: [...papers.map((p) => p.id), "gone"], at: AT }, byId(papers))
    expect(view).toMatchObject({ total: 5, saved: 1, held: 1, things: 1, running: true })
    expect(view.rows).toEqual([
      { kind: "permission", papers: 1, ids: ["apa"], host: "apa.org", proxied: false },
      { kind: "waiting", papers: 3, ids: ["queued", "fetching", "before"] },
    ])
  })

  it("says which papers have no PDF to be had, after the downloads by hand", () => {
    const papers = [ended("refused", "no-access", "dl.acm.org"), ended("manual", "unreadable", "psycnet.apa.org"), held("a", "check", "oup.com"), held("b", "sign-in", "sagepub.com"), held("c", "sign-in", "sagepub.com")]
    const view = batchView({ ids: papers.map((p) => p.id), at: AT }, byId(papers))
    expect(view.running).toBe(false)
    expect(view.rows.map((r) => r.kind)).toEqual(["sign-in", "check", "manual", "none"])
  })

  it("moves a paper the user skipped on its page from the downloads by hand to a row of its own", () => {
    const unreadable = tryOf("unreadable", "psycnet.apa.org")
    const skipped = tryOf("skipped", "psycnet.apa.org", AT + 2, "person")
    const papers = [ended("left", "unreadable", "psycnet.apa.org"), paper("skipped", { pdfState: { state: "no-pdf", tried: [unreadable, skipped], reason: skipped } })]
    const view = batchView({ ids: papers.map((p) => p.id), at: AT }, byId(papers))
    expect(view.rows.map((r) => [r.kind, r.ids])).toEqual([
      ["manual", ["left"]],
      ["skipped", ["skipped"]],
    ])
  })

  it("counts a wait met at a publisher through the proxy for its own paper, the rest only behind it", () => {
    const tlink = "tlink.lib.tsinghua.edu.cn"
    const thieme = paper("thieme", { pdfState: { state: "finding", tried: [], extension: { host: tlink, waits: "permission", waitsAt: "thieme-connect.de", proxied: true } } })
    const behind = Array.from({ length: 19 }, (_, i) => paper(`held${i}`, { pdfState: { state: "finding", tried: [], extension: { host: tlink, behind: { kind: "permission", host: "thieme-connect.de" }, proxied: true } } }))
    const papers = [thieme, ...behind]
    const view = batchView({ ids: papers.map((p) => p.id), at: AT }, byId(papers))
    expect(view.rows.map((r) => [r.kind, r.host, r.papers, r.proxied])).toEqual([
      ["permission", "thieme-connect.de", 1, false],
      ["waiting", undefined, 19, undefined],
    ])
    expect(view.rows[1].behind).toEqual([{ kind: "permission", host: "thieme-connect.de", papers: 19 }])
    // Nothing moves until the user allows Thieme: the summary, not "Getting…"
    expect(view).toMatchObject({ held: 1, things: 1, running: false })
    // One more in line at a site of its own keeps the batch running
    const free = inLine("free")
    expect(batchView({ ids: [...papers, free].map((p) => p.id), at: AT }, byId([...papers, free])).running).toBe(true)
  })

  it("keeps the sites that wait for papers outside the batch, under the batch's rows", () => {
    const wait = (kind: ExtensionWait["kind"], host: string, papers: number): ExtensionWait => ({ kind, host, papers, url: `https://${host}/`, askedFor: true, proxied: false })
    const papers = [held("a", "check", "oup.com"), inLine("b")]
    const view = batchView({ ids: papers.map((p) => p.id), at: AT }, byId(papers))
    expect(outsideRows([wait("check", "oup.com", 3), wait("permission", "tsinghua.edu.cn", 13)], view.rows).map((r) => [r.kind, r.host, r.papers])).toEqual([["permission", "tsinghua.edu.cn", 13]])
  })

  it("shows the sites that wait without a batch, the most papers first", () => {
    const wait = (kind: ExtensionWait["kind"], host: string, papers: number): ExtensionWait => ({ kind, host, papers, url: `https://${host}/`, askedFor: false, proxied: false })
    expect(siteRows([wait("check", "oup.com", 1), wait("sign-in", "sagepub.com", 4)]).map((r) => [r.kind, r.host, r.papers])).toEqual([
      ["sign-in", "sagepub.com", 4],
      ["check", "oup.com", 1],
    ])
  })
})
