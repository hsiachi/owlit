import { describe, expect, it } from "vitest"
import type { Paper } from "@owlit/protocol"
import type { PdfState, PdfTry } from "@owlit/protocol"
import { countByFilter, groupPapers, visiblePapers } from "./filter"
import { pdfWait } from "./pdf-wait"

const paper = (id: string, extra: Partial<Paper> = {}): Paper => ({
  id,
  title: id,
  authors: [],
  ids: { doi: `10.1/${id}` },
  addedAt: 1,
  addedBy: "p_1",
  starred: false,
  status: "unread",
  citeKey: id,
  tags: [],
  ...extra,
})
const tryOf = (ended: PdfTry["ended"], by: PdfTry["by"] = "search"): PdfTry => ({ by, ended, at: 1 })
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
    noAccess: paper("noAccess", noPdf([found, tryOf("no-access", "person")])),
    notOffered: paper("notOffered", noPdf([found, tryOf("not-offered", "person")])),
    notThere: paper("notThere", noPdf([found, tryOf("not-there")])),
  }

  it("reads where each stands off its state and the ending of its reason", () => {
    expect(Object.fromEntries(Object.values(library).map((p) => [p.id, pdfWait(p) ?? null]))).toEqual({
      read: null,
      looking: "finding",
      offline: "offline",
      found: "not-found",
      noDoi: "not-found",
      check: "not-found",
      signIn: "not-found",
      noAccess: "no-access",
      notOffered: "not-offered",
      notThere: "not-there",
    })
  })

  it("lists them all under No PDF, grouped by one name per state", () => {
    expect(countByFilter(library)["no-pdf"]).toBe(9)
    const sort = { key: "addedAt" as const, desc: true }
    const visible = visiblePapers(library, { query: "", filter: "no-pdf", tags: [], sort })
    const groups = groupPapers(visible, sort, false, Date.now(), undefined, true)
    expect(groups.map((g) => [g.label, g.papers.map((p) => p.id).sort()])).toEqual([
      ["No PDF found", ["check", "found", "noDoi", "signIn"]],
      ["No access", ["noAccess", "notOffered"]],
      ["No PDF there", ["notThere"]],
      ["Finding", ["looking", "offline"]],
    ])
  })
})
