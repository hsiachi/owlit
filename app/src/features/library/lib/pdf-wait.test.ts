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

  it("reads a paper the extension waits with as still finding, under its site's wait", () => {
    const signIn = tryOf("sign-in", "extension")
    // In the queue at a site that waits for the user
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-copy")], reason: tryOf("no-copy"), extension: { host: "tlink.lib.tsinghua.edu.cn", waits: "sign-in" } } })).toBe("for-sign-in")
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { host: "tandfonline.com", waits: "check" } } })).toBe("for-check")
    // Fetched again once the user got through: finding, whatever its last try met
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { host: "tlink.lib.tsinghua.edu.cn" } } })).toBe("finding")
    // After a restart, before the queue has it again, its last try says what it waits for
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn } })).toBe("for-sign-in")
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-permission", "extension")], reason: tryOf("no-permission", "extension") } })).toBe("for-permission")
    // Owlit's hidden browser's sign-in is still the user's browser's chance
    expect(pdfWait(noPdf("sign-in"))).toBe("for-browser")
    expect(pdfWord("for-sign-in")).toBe(pdfWord("finding"))
  })

  it("waits on the user at a site only once they asked for one of its papers", () => {
    const wait = { kind: "sign-in" as const, host: "tlink.lib.tsinghua.edu.cn", papers: 2, url: "https://tlink.lib.tsinghua.edu.cn/go" }
    expect(waitsOnYou({ ...wait, askedFor: false })).toBe(false)
    expect(waitsOnYou({ ...wait, askedFor: true })).toBe(true)
  })

  it("gives the states that read alike one name", () => {
    expect(pdfWord("no-access")).toBe(pdfWord("not-offered"))
    expect(pdfWord("finding")).toBe(pdfWord("offline"))
    expect(pdfWord("for-browser")).toBe("For your browser")
  })
})
