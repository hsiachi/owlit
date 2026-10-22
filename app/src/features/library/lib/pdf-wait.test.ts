import { describe, expect, it } from "vitest"
import type { PdfState, PdfTry } from "@owlit/protocol"
import { pdfColumnWord, pdfWait, pdfWord, waitsOnYou } from "./pdf-wait"

const tryOf = (ended: PdfTry["ended"], by: PdfTry["by"] = "search"): PdfTry => ({ by, ended, at: 1 })
const noPdf = (ended: PdfTry["ended"], extra: Partial<PdfState> = {}) => ({ pdfState: { state: "no-pdf" as const, tried: [tryOf(ended)], reason: tryOf(ended), ...extra } })

describe("pdfWait", () => {
  it("reads where a paper without its PDF stands, and nothing once it has it", () => {
    expect(pdfWait({ pdf: { url: "x" }, pdfState: undefined })).toBeUndefined()
    expect(pdfWait({ pdfState: { state: "finding", tried: [] } })).toBe("finding")
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("offline")], reason: tryOf("offline") } })).toBe("offline")
    expect(pdfWait(noPdf("no-copy"))).toBe("not-found")
    expect(pdfWait(noPdf("not-offered"))).toBe("not-offered")
    // A check or a sign-in that stopped owlit itself, in an older record: no PDF found, waiting on nobody
    expect(pdfWait(noPdf("check"))).toBe("not-found")
    expect(pdfWait(noPdf("sign-in"))).toBe("not-found")
    // A page the extension couldn't open: the user downloads it there, never "no copy"
    const unreadable = tryOf("unreadable", "extension")
    expect(pdfWait({ pdfState: { state: "no-pdf", tried: [tryOf("no-copy"), unreadable, tryOf("no-copy")], reason: unreadable } })).toBe("manual")
    expect(pdfWord("manual")).not.toBe(pdfWord("not-found"))
  })

  it("reads a paper the extension waits with as still finding, under its site's wait", () => {
    const signIn = tryOf("sign-in", "extension")
    // In the queue at a site that waits for the user
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-copy")], reason: tryOf("no-copy"), extension: { host: "tlink.lib.tsinghua.edu.cn", waits: "sign-in" } } })).toBe("for-sign-in")
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { host: "tandfonline.com", waits: "check" } } })).toBe("for-check")
    const blocked = tryOf("blocked", "extension")
    expect(pdfWait({ pdfState: { state: "finding", tried: [blocked], reason: blocked, extension: { host: "bmj.com", waits: "blocked" } } })).toBe("blocked")
    expect(pdfWord("blocked")).toBe("Blocked")
    // Fetched again once the user got through: finding, whatever its last try met
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { host: "tlink.lib.tsinghua.edu.cn" } } })).toBe("finding")
    // After a restart, before the queue has it again, its last try says what it waits for
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn } })).toBe("for-sign-in")
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-permission", "extension")], reason: tryOf("no-permission", "extension") } })).toBe("for-permission")
    expect(pdfWord("for-sign-in")).toBe("Needs sign-in")
    // In line at the extension, not held: Waiting, which owlit's own looking is not
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [], extension: { host: "sagepub.com" } } })).toBe("Waiting")
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [], extension: { host: "sagepub.com", fetching: true } } })).toBe("Finding")
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [] } })).toBe("Finding")
  })

  it("waits on the user at a site only once they asked for one of its papers", () => {
    const wait = { kind: "sign-in" as const, host: "tlink.lib.tsinghua.edu.cn", papers: 2, url: "https://tlink.lib.tsinghua.edu.cn/go", proxied: true }
    expect(waitsOnYou({ ...wait, askedFor: false })).toBe(false)
    expect(waitsOnYou({ ...wait, askedFor: true })).toBe(true)
  })

  it("gives the states that read alike one name", () => {
    expect(pdfWord("no-access")).toBe(pdfWord("not-offered"))
    expect(pdfWord("finding")).toBe(pdfWord("offline"))
  })
})
