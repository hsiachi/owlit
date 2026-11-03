import type { ExtensionWait } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { siteWaitItem, siteWaitItems, stillWaits, stillWords, waitOf, waitWords } from "./waits"

const wait = (kind: ExtensionWait["kind"], askedFor: boolean, papers = 2): ExtensionWait => ({ id: "proxy:tlink.lib.tsinghua.edu.cn", at: "tlink.lib.tsinghua.edu.cn", watch: [], kind, host: "tlink.lib.tsinghua.edu.cn", papers, url: "https://tlink.lib.tsinghua.edu.cn/go", askedFor, proxied: true })
const publisher = (papers = 1): ExtensionWait => ({ id: "pub:sage", at: "sagepub.com", watch: [], kind: "sign-in", host: "sagepub.com", papers, url: "https://journals.sagepub.com/action/showLogin", askedFor: true, proxied: false })

describe("sites the extension waits at", () => {
  it("wait on the user only once they asked for one of the papers there", () => {
    expect(siteWaitItems([wait("sign-in", false), wait("check", false)], () => {})).toEqual([])
    const [item] = siteWaitItems([wait("sign-in", false), wait("sign-in", true, 3)], () => {})
    expect(item).toMatchObject({ tone: "warning", place: "/library", what: "3 papers need you to sign in to your library", action: { label: "Sign in" } })
  })

  it("are grey rows of their own until then", () => {
    expect(siteWaitItem(wait("sign-in", false), () => {}).tone).toBe("working")
    expect(siteWaitItem(wait("sign-in", true), () => {}).tone).toBe("warning")
  })

  it("name the library only for a sign-in through its proxy", () => {
    expect(siteWaitItem(publisher(), () => {})).toMatchObject({ what: "1 paper needs you to sign in at sagepub.com", action: { label: "Sign in" } })
  })

  it("say each kind of wait with its one thing to do", () => {
    const items = siteWaitItems([wait("check", true, 1), wait("permission", true)], () => {})
    expect(items.map((i) => [i.what, i.action?.label])).toEqual([
      ["1 paper needs you to verify you're human on tlink.lib.tsinghua.edu.cn", "Open"],
      ["2 papers need your permission for tlink.lib.tsinghua.edu.cn", "Allow"],
    ])
  })

  it("read as rows after a count, agreeing with it", () => {
    expect(waitWords(wait("sign-in", true), 23).need).toBe("Need you to sign in to your library")
    expect(waitWords(wait("check", true), 1).need).toBe("Needs you to verify you're human on tlink.lib.tsinghua.edu.cn")
  })

  it("are found from a paper by the host its wait names", () => {
    const apa: ExtensionWait = { id: "pub:apa", at: "apa.org", watch: [], kind: "permission", host: "apa.org", papers: 1, url: "https://doi.apa.org/x", askedFor: true, proxied: true }
    const held = { pdfState: { state: "finding" as const, tried: [], extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, host: "tlink.lib.tsinghua.edu.cn", waits: "permission" as const, waitsAt: "apa.org", proxied: true } } }
    expect(waitOf(held, [wait("sign-in", true), apa])).toBe(apa)
    expect(waitOf({ pdfState: { state: "finding", tried: [], extension: { lane: "site:x" as const, gate: "site:x" as const, attempt: 1, host: "tlink.lib.tsinghua.edu.cn" } } }, [wait("sign-in", true)])).toBeUndefined()
  })

  it("say a check is still there when it came back after I've verified it", () => {
    const misq = { kind: "check" as const, host: "misq.umn.edu", proxied: false }
    const now = 10 * 60_000
    expect(stillWaits([{ ...misq, at: now - 1000, gone: true }], misq, now)).toBe(true)
    // The wait hadn't gone yet: owlit's try is still out
    expect(stillWaits([{ ...misq, at: now - 1000, gone: false }], misq, now)).toBe(false)
    // Long after, it is a new wait
    expect(stillWaits([{ ...misq, at: 0, gone: true }], misq, now)).toBe(false)
    expect(stillWords(misq)).toBe("misq.umn.edu still asks you to verify you're human")
  })
})
