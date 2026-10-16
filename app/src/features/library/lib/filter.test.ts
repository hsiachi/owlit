import { describe, expect, it } from "vitest"
import type { Paper } from "@owlit/protocol"
import { countByFilter, groupPapers, mightComeThroughBrowser, needsYou, noPdfReason, visiblePapers } from "./filter"

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
const noPdf = (extra: NonNullable<Paper["noPdf"]> extends infer T ? Partial<T> : never = {}) => ({ noPdf: { tried: ["arxiv"], at: 1, ...extra } })

describe("papers without a PDF", () => {
  const library: Record<string, Paper> = {
    read: paper("read", { pdf: { pages: 1 } as Paper["pdf"] }),
    looking: paper("looking"),
    found: paper("found", noPdf()),
    noDoi: paper("noDoi", { ids: {}, ...noPdf() }),
    needs: paper("needs", noPdf({ needs: "browser" })),
    refused: paper("refused", noPdf({ needs: "browser", noAccess: { refused: false, at: 1 } })),
    missing: paper("missing", noPdf({ noAccess: { refused: false, missing: true, at: 1 } })),
    missed: paper("missed", noPdf({ needs: "browser", fromBrowser: { state: "missed" } })),
    sent: paper("sent", noPdf({ sentAt: 5 })),
    onPage: paper("onPage", noPdf({ fromBrowser: { state: "page" } })),
  }

  it("says why for every paper owlit looked for, and nothing for one with a PDF or still being looked for", () => {
    expect(Object.fromEntries(Object.values(library).map((p) => [p.id, noPdfReason(p) ?? null]))).toEqual({
      read: null,
      looking: null,
      found: "not-found",
      noDoi: "not-found",
      needs: "needs",
      refused: "no-access",
      missing: "missing",
      missed: "missed",
      sent: "not-found",
      onPage: "needs",
    })
  })

  it("offers the browser only for papers with a DOI it hasn't been sent for", () => {
    expect(Object.values(library).filter(mightComeThroughBrowser).map((p) => p.id)).toEqual(["found"])
  })

  it("counts a page open for the user in Needs you, whoever sent it", () => {
    expect(needsYou(library.onPage)).toBe(true)
    expect(needsYou(library.found)).toBe(false)
  })

  it("lists them all under No PDF, Needs you ones included, grouped by why", () => {
    expect(countByFilter(library)["no-pdf"]).toBe(8)
    const sort = { key: "addedAt" as const, desc: true }
    const visible = visiblePapers(library, { query: "", filter: "no-pdf", tags: [], sort })
    const groups = groupPapers(visible, sort, false, Date.now(), undefined, true)
    expect(groups.map((g) => [g.label, g.papers.map((p) => p.id).sort()])).toEqual([
      ["Needs you", ["needs", "onPage"]],
      ["No PDF found", ["found", "noDoi", "sent"]],
      ["No access", ["refused"]],
      ["No PDF there", ["missing"]],
      ["Didn't come", ["missed"]],
    ])
  })
})
