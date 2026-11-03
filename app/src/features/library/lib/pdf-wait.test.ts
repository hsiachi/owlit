import { describe, expect, it } from "vitest"
import type { PdfState, PdfTry } from "@owlit/protocol"
import { noPdfTitle, pdfColumnWord, pdfWait, pdfWord, waitsOnYou } from "./pdf-wait"

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
    // The user looked there and found none: their word, not owlit's
    expect(pdfWait(noPdf("skipped"))).toBe("skipped")
    expect(pdfWord("skipped")).toBe("You found none")
    // The user stopped it while it waited for them: their word too, with a way to look again
    expect(pdfWait(noPdf("stopped"))).toBe("stopped")
    expect(pdfWord("stopped")).toBe("Stopped")
    expect(pdfWord("stopped")).not.toBe(pdfWord("not-found"))
  })

  it("reads a paper the extension waits with as still finding, under its site's wait", () => {
    const signIn = tryOf("sign-in", "extension")
    // In the queue at a site that waits for the user
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-copy")], reason: tryOf("no-copy"), extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, wait: "site:x" as const, kind: "sign-in" as const, at: "tlink.lib.tsinghua.edu.cn" } } })).toBe("for-sign-in")
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, wait: "site:x" as const, kind: "check" as const, at: "tandfonline.com" } } })).toBe("for-check")
    const blocked = tryOf("blocked", "extension")
    expect(pdfWait({ pdfState: { state: "finding", tried: [blocked], reason: blocked, extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, wait: "site:x" as const, kind: "blocked" as const, at: "bmj.com" } } })).toBe("blocked")
    expect(pdfWord("blocked")).toBe("Blocked")
    // Fetched again once the user got through: finding, whatever its last try met
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, at: "tlink.lib.tsinghua.edu.cn" } } })).toBe("finding")
    // Only a wait that is up says so: once the user got through (or with no wait put up for it), the
    // paper waits for the browser, whatever its last try met
    expect(pdfWait({ pdfState: { state: "finding", tried: [signIn], reason: signIn } })).toBe("finding")
    expect(pdfWait({ pdfState: { state: "finding", tried: [tryOf("no-permission", "extension")], reason: tryOf("no-permission", "extension") } })).toBe("finding")
    expect(pdfWord("for-sign-in")).toBe("Needs sign-in")
    // In line at the extension, not held: Waiting, which owlit's own looking is not
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [], extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, at: "sagepub.com" } } })).toBe("Waiting")
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [], extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, at: "sagepub.com", fetching: true } } })).toBe("Finding")
    expect(pdfColumnWord({ pdfState: { state: "finding", tried: [] } })).toBe("Finding")
  })

  it("says about how long a paper waits its turn at the library's proxy", () => {
    const inLine = (turnAt: number) => ({ pdfState: { state: "finding" as const, tried: [], extension: { lane: "proxy:tlink.lib.tsinghua.edu.cn" as const, gate: "pub:tandf" as const, attempt: 1, at: "tlink.lib.tsinghua.edu.cn", turnAt } } })
    expect(pdfColumnWord(inLine(Date.now() + 4 * 60_000 + 10_000))).toBe("In line · about 5 min")
    expect(noPdfTitle(inLine(Date.now() + 4 * 60_000 + 10_000))).toBe("In line through your library · about 5 min")
    // Due now, or nearly: still a minute's word, never none
    expect(pdfColumnWord(inLine(Date.now() - 1000))).toBe("In line · about 1 min")
    // Out for its fetch: Finding, as any other
    expect(pdfColumnWord({ pdfState: { ...inLine(Date.now()).pdfState, extension: { ...inLine(Date.now()).pdfState.extension, fetching: true } } })).toBe("Finding")
  })

  it("waits on the user at a site only once they asked for one of its papers", () => {
    const wait = { id: "proxy:tlink.lib.tsinghua.edu.cn" as const, at: "tlink.lib.tsinghua.edu.cn", watch: [], kind: "sign-in" as const, host: "tlink.lib.tsinghua.edu.cn", papers: 2, url: "https://tlink.lib.tsinghua.edu.cn/go", proxied: true, since: 0 }
    expect(waitsOnYou({ ...wait, askedFor: false })).toBe(false)
    expect(waitsOnYou({ ...wait, askedFor: true })).toBe(true)
  })

  it("gives the states that read alike one name", () => {
    expect(pdfWord("no-access")).toBe(pdfWord("not-offered"))
    expect(pdfWord("finding")).toBe(pdfWord("offline"))
  })

  it("names the library for a sign-in at its proxy, and a publisher's sign-in met through it by the publisher", () => {
    const signIn = { by: "extension" as const, ended: "sign-in" as const, at: 1, host: "tlink.lib.tsinghua.edu.cn" }
    const tlink = { at: "tlink.lib.tsinghua.edu.cn", proxied: true }
    const own = { lane: "proxy:tlink.lib.tsinghua.edu.cn" as const, gate: "proxy:tlink.lib.tsinghua.edu.cn" as const, attempt: 2, wait: "proxy:tlink.lib.tsinghua.edu.cn" as const, kind: "sign-in" as const, at: "tlink.lib.tsinghua.edu.cn" }
    expect(noPdfTitle({ pdfState: { state: "finding", tried: [signIn], reason: signIn, extension: own } }, tlink)).toBe("Needs you to sign in to your library")
    // Its record alone, with no wait up: it waits for the browser, not for the user
    expect(noPdfTitle({ pdfState: { state: "finding", tried: [signIn], reason: signIn } })).toBe("Finding a PDF…")
    // A publisher's sign-in met through the proxy is that publisher's: its wait says where
    const at = { lane: "proxy:tlink.lib.tsinghua.edu.cn" as const, gate: "pub:thieme" as const, attempt: 1, wait: "pub:thieme" as const, kind: "sign-in" as const, at: "thieme-connect.de" }
    expect(noPdfTitle({ pdfState: { state: "finding", tried: [], extension: at } }, { at: "thieme-connect.de", proxied: false })).toBe("Needs you to sign in at thieme-connect.de")
  })
})
