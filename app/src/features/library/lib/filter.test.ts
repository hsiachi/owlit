import { describe, expect, it } from "vitest"
import type { Paper } from "@owlit/protocol"
import type { PdfState, PdfTry } from "@owlit/protocol"
import { countByFilter, groupPapers, mightComeThroughBrowser, visiblePapers } from "./filter"
import { pdfWait } from "./pdf-wait"

const paper = (id: string, extra: Partial<Paper> = {}): Paper => ({
  id,
  title: id,
  authors: [],
  ids: { doi: `10.1/${id}` },
  addedAt: 1,
  addedBy: "user",
  starred: false,
  status: "unread",
  tags: [],
  ...extra,
})
const tryOf = (ended: PdfTry["ended"], by: PdfTry["by"] = "owlit"): PdfTry => ({ by, ended, at: 1 })
// No PDF, for the reason of the last try given
const noPdf = (tries: PdfTry[], extra: Partial<PdfState> = {}) => ({ pdfState: { state: "no-pdf" as const, tried: tries, reason: tries.at(-1), ...extra } })

describe("papers without a PDF", () => {
  const found = tryOf("no-copy")
  const library: Record<string, Paper> = {
    read: paper("read", { pdf: { pages: 1 } as Paper["pdf"] }),
    looking: paper("looking", { pdfState: { state: "finding", tried: [] } }),
    offline: paper("offline", { pdfState: { state: "finding", tried: [tryOf("offline")], reason: tryOf("offline") } }),
    found: paper("found", noPdf([found])),
    noDoi: paper("noDoi", { ids: {}, ...noPdf([found]) }),
    check: paper("check", noPdf([found, tryOf("check")])),
    signIn: paper("signIn", noPdf([found, tryOf("sign-in")])),
    noAccess: paper("noAccess", noPdf([found, tryOf("no-access", "you")])),
    notOffered: paper("notOffered", noPdf([found, tryOf("not-offered", "you")])),
    notThere: paper("notThere", noPdf([found, tryOf("not-there")])),
    nothingCame: paper("nothingCame", noPdf([found, tryOf("nothing-came", "you")])),
    queued: paper("queued", noPdf([found, tryOf("check")], { run: { state: "queued" } })),
    onPage: paper("onPage", noPdf([found], { run: { state: "page" } })),
  }

  it("reads where each stands off its state, the ending of its reason and the run", () => {
    expect(Object.fromEntries(Object.values(library).map((p) => [p.id, pdfWait(p) ?? null]))).toEqual({
      read: null,
      looking: "finding",
      offline: "offline",
      found: "not-found",
      noDoi: "not-found",
      check: "for-browser",
      signIn: "for-browser",
      noAccess: "no-access",
      notOffered: "not-offered",
      notThere: "not-there",
      nothingCame: "nothing-came",
      queued: "queued",
      onPage: "page",
    })
  })

  it("offers the browser only for papers found nowhere, with a DOI, it hasn't been sent for", () => {
    expect(Object.values(library).filter(mightComeThroughBrowser).map((p) => p.id)).toEqual(["found"])
  })

  it("lists them all under No PDF, grouped by one name per state", () => {
    expect(countByFilter(library)["no-pdf"]).toBe(12)
    const sort = { key: "addedAt" as const, desc: true }
    const visible = visiblePapers(library, { query: "", filter: "no-pdf", tags: [], sort })
    const groups = groupPapers(visible, sort, false, Date.now(), undefined, true)
    expect(groups.map((g) => [g.label, g.papers.map((p) => p.id).sort()])).toEqual([
      ["Needs you", ["onPage"]],
      ["For your browser", ["check", "signIn"]],
      ["In your browser…", ["queued"]],
      ["Nothing came", ["nothingCame"]],
      ["Not found", ["found", "noDoi"]],
      ["No access", ["noAccess", "notOffered"]],
      ["No PDF there", ["notThere"]],
      ["Finding", ["looking", "offline"]],
    ])
  })
})
