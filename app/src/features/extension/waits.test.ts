import type { ExtensionWait } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { siteWaitItem, siteWaitItems, stillWhy, stillWords, waitWords } from "./waits"

const wait = (kind: ExtensionWait["kind"], askedFor: boolean, papers = 2): ExtensionWait => ({ id: "proxy:tlink.lib.tsinghua.edu.cn", at: "tlink.lib.tsinghua.edu.cn", watch: [], kind, host: "tlink.lib.tsinghua.edu.cn", papers, url: "https://tlink.lib.tsinghua.edu.cn/go", askedFor, proxied: true, since: 0 })
const publisher = (papers = 1): ExtensionWait => ({ id: "pub:sage", at: "sagepub.com", watch: [], kind: "sign-in", host: "sagepub.com", papers, url: "https://journals.sagepub.com/action/showLogin", askedFor: true, proxied: false, since: 0 })

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

  it("are keyed on Home by their id", () => {
    expect(siteWaitItem(publisher(), () => {}).key).toBe("papers:wait:pub:sage")
  })

  it("say a check is still there when it came back after I've verified it", () => {
    expect(stillWords({ kind: "check", at: "misq.umn.edu", proxied: false })).toBe("misq.umn.edu still asks you to verify you're human")
    expect(stillWords({ kind: "sign-in", at: "tlink.lib.tsinghua.edu.cn", proxied: true }, "Tsinghua University")).toBe("Tsinghua University still asks you to sign in")
  })

  it("say what a wait that turned into a block or a permission still needs, with no button to press after it", () => {
    expect(stillWords({ kind: "blocked", at: "sagepub.com", proxied: false })).toBe("sagepub.com still blocks your browser")
    expect(stillWords({ kind: "permission", at: "sagepub.com", proxied: false })).toBe("owlit still needs your permission for sagepub.com")
    expect(stillWhy("check")).toBe("owlit tried again just now and met the same page. Open it, finish there, then press I've verified it.")
    for (const kind of ["blocked", "permission"] as const) expect(stillWhy(kind)).toBe("owlit tried again just now and met the same page. It goes on by itself once a page there loads.")
  })
})
