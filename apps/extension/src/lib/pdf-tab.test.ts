import { describe, expect, it } from "vitest"
import { contentTypeOf, takesPdfTab } from "./pdf-tab.ts"

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
