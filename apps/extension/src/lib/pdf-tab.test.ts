import { describe, expect, it } from "vitest"
import { OwlitError, Unreachable } from "./owlit.ts"
import { contentTypeOf, pdfTabWrite, refusedByOwlit, takesPdfTab } from "./pdf-tab.ts"

const on = { connected: true, takePdfs: true, permitted: true }
const pdf = { url: "https://dl.acm.org/doi/pdf/10.1145/3626772.3657891", contentType: "application/pdf" }

describe("takesPdfTab", () => {
  it("takes a PDF tab on a permitted site while connected with the setting on", () => {
    expect(takesPdfTab(pdf, on)).toBe(true)
    expect(takesPdfTab({ ...pdf, contentType: "application/pdf; charset=binary" }, on)).toBe(true)
  })

  it("leaves it when any of those is missing", () => {
    expect(takesPdfTab(pdf, { ...on, connected: false })).toBe(false)
    expect(takesPdfTab(pdf, { ...on, takePdfs: false })).toBe(false)
    expect(takesPdfTab(pdf, { ...on, permitted: false })).toBe(false)
  })

  it("leaves pages that aren't PDFs, and PDFs that aren't on the web", () => {
    expect(takesPdfTab({ ...pdf, contentType: "text/html; charset=utf-8" }, on)).toBe(false)
    expect(takesPdfTab({ ...pdf, contentType: undefined }, on)).toBe(false)
    expect(takesPdfTab({ url: "file:///Users/me/paper.pdf", contentType: "application/pdf" }, on)).toBe(false)
  })

  it("reads the content type whatever the header's case", () => {
    expect(contentTypeOf([{ name: "Content-Type", value: "application/pdf" }])).toBe("application/pdf")
    expect(contentTypeOf([{ name: "content-length", value: "10" }])).toBeUndefined()
  })
})

describe("pdfTabWrite", () => {
  it("keeps a tab's PDF under that tab's own key", () => {
    expect(pdfTabWrite(7, pdf.url, [{ name: "Content-Type", value: "application/pdf" }])).toEqual({ set: { "pdfTab:7": pdf.url } })
    expect(pdfTabWrite(8, pdf.url, [{ name: "content-type", value: "application/pdf" }])).toEqual({ set: { "pdfTab:8": pdf.url } })
  })

  it("clears the tab's key when it loads something else", () => {
    expect(pdfTabWrite(7, "https://dl.acm.org/doi/10.1145/3626772.3657891", [{ name: "content-type", value: "text/html" }])).toEqual({ remove: "pdfTab:7" })
    expect(pdfTabWrite(7, pdf.url, undefined)).toEqual({ remove: "pdfTab:7" })
  })
})

describe("refusedByOwlit", () => {
  it("is owlit's no for this PDF", () => {
    expect(refusedByOwlit(new OwlitError(404, { reason: "not-a-library-paper" }))).toBe(true)
    expect(refusedByOwlit(new OwlitError(422, { reason: "not-this-paper" }))).toBe(true)
  })

  it("isn't a lost pairing, a failing owlit or no owlit at all", () => {
    expect(refusedByOwlit(new OwlitError(401, { reason: "not-paired" }))).toBe(false)
    expect(refusedByOwlit(new OwlitError(503, { reason: "no-workspace" }))).toBe(false)
    expect(refusedByOwlit(new Unreachable())).toBe(false)
  })
})
