import { describe, expect, it } from "vitest"
import type { PdfState, PdfTry } from "@owlit/protocol"
import { pdfWait, pdfWord, waitsOnYou } from "./pdf-wait"

const tryOf = (ended: PdfTry["ended"], by: PdfTry["by"] = "owlit"): PdfTry => ({ by, ended, at: 1 })
const noPdf = (ended: PdfTry["ended"], extra: Partial<PdfState> = {}) => ({ pdfState: { state: "no-pdf" as const, tried: [tryOf(ended)], reason: tryOf(ended), ...extra } })

describe("pdfWait", () => {
  it("reads where a paper without its PDF stands, and nothing once it has it", () => {
    expect(pdfWait({ pdf: { url: "x" }, pdfState: undefined })).toBeUndefined()
    expect(pdfWait({ pdfState: { state: "finding", tried: [] } })).toBe("finding")
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("offline")], reason: tryOf("offline") } })).toBe("offline")
    expect(pdfWait(noPdf("no-copy"))).toBe("not-found")
    expect(pdfWait(noPdf("check"))).toBe("for-browser")
    expect(pdfWait(noPdf("sign-in"))).toBe("for-browser")
    expect(pdfWait(noPdf("not-offered"))).toBe("not-offered")
    expect(pdfWait(noPdf("nothing-came"))).toBe("nothing-came")
  })

  it("puts a run in the user's browser before what the tries say, and a file to confirm first", () => {
    expect(pdfWait(noPdf("check", { run: { state: "waiting", why: "sign-in" } }))).toBe("run-stopped")
    expect(pdfWait(noPdf("check", { run: { state: "page", offered: "x.pdf" } }))).toBe("offered")
  })

  it("waits on the user only in a run they started", () => {
    expect(waitsOnYou(pdfWait(noPdf("no-copy", { run: { state: "page" } })))).toBe(true)
    expect(waitsOnYou(pdfWait(noPdf("check", { run: { state: "queued" } })))).toBe(false)
    // A page that stopped owlit is their browser's chance, not their move
    expect(waitsOnYou(pdfWait(noPdf("check")))).toBe(false)
    expect(waitsOnYou(pdfWait(noPdf("sign-in")))).toBe(false)
  })

  it("gives the states that read alike one name", () => {
    expect(pdfWord("no-access")).toBe(pdfWord("not-offered"))
    expect(pdfWord("finding")).toBe(pdfWord("offline"))
    expect(pdfWord("queued")).toBe("In your browser…")
    expect(pdfWord("for-browser")).toBe("For your browser")
  })
})
