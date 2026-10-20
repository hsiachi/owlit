import { describe, expect, it, vi } from "vitest"
import { OwlitError, Unreachable } from "./owlit.ts"
import { contentTypeOf, pdfTabWrite, refusedByOwlit, showsPdf, takePdf, takesPdfTab, type TakeDeps } from "./pdf-tab.ts"

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

describe("showsPdf", () => {
  it("is the PDF kept for the tab, wherever the viewer scrolled", () => {
    expect(showsPdf(pdf.url, pdf.url)).toBe(true)
    expect(showsPdf(`${pdf.url}#page=3`, pdf.url)).toBe(true)
  })

  it("isn't a tab that went elsewhere, or one with nothing kept", () => {
    expect(showsPdf("https://www.example.org/", pdf.url)).toBe(false)
    expect(showsPdf(pdf.url, undefined)).toBe(false)
  })
})

describe("takePdf", () => {
  const bytes = new ArrayBuffer(8)
  const paper = { id: "p1", title: "Attention Is All You Need", hasPdf: false }
  const deps = (over: Partial<TakeDeps> = {}) => {
    const answered = new Set<string>()
    const put = vi.fn(async () => ({ paper: { ...paper, hasPdf: true } }))
    return {
      answered,
      put,
      deps: {
        fetchPdf: async () => bytes,
        lookUp: async () => paper,
        put,
        answered: { has: async (url: string) => answered.has(url), add: async (url: string) => void answered.add(url) },
        ...over,
      } satisfies TakeDeps,
    }
  }

  it("hands the PDF to the paper its address names, and keeps it as answered", async () => {
    const run = deps()
    expect(await takePdf(pdf.url, { doi: "10.1145/3626772.3657891" }, run.deps)).toEqual({ taken: { ...paper, hasPdf: true } })
    expect(run.put).toHaveBeenCalledWith("p1", bytes)
    expect(run.answered.has(pdf.url)).toBe(true)
    expect(await takePdf(pdf.url, { doi: "10.1145/3626772.3657891" }, run.deps)).toEqual({ seen: true })
  })

  it("lets owlit place a PDF whose address names no paper", async () => {
    const run = deps()
    await takePdf(pdf.url, {}, run.deps)
    expect(run.put).toHaveBeenCalledWith(undefined, bytes)
  })

  it("doesn't keep a PDF that didn't come, so the next load tries again", async () => {
    const run = deps({ fetchPdf: async () => undefined })
    expect(await takePdf(pdf.url, {}, run.deps)).toEqual({ missed: undefined })
    expect(run.answered.size).toBe(0)
  })

  it("doesn't keep one owlit couldn't answer for, and keeps one it refused", async () => {
    const away = deps({ put: async () => Promise.reject(new Unreachable()) })
    expect(await takePdf(pdf.url, {}, away.deps)).toHaveProperty("missed")
    expect(away.answered.size).toBe(0)
    const refused = deps({ put: async () => Promise.reject(new OwlitError(404, { reason: "not-a-library-paper" })) })
    expect(await takePdf(pdf.url, {}, refused.deps)).toHaveProperty("refused")
    expect(refused.answered.has(pdf.url)).toBe(true)
  })

  it("leaves a paper that has its PDF already", async () => {
    const run = deps({ lookUp: async () => ({ ...paper, hasPdf: true }) })
    expect(await takePdf(pdf.url, { arxiv: "1706.03762" }, run.deps)).toEqual({ had: { ...paper, hasPdf: true } })
    expect(run.put).not.toHaveBeenCalled()
  })
})
