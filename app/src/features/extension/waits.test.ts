import type { ExtensionWait } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { cameLine, siteWaitItem, siteWaitItems } from "./waits"

const wait = (kind: ExtensionWait["kind"], askedFor: boolean, papers = 2): ExtensionWait => ({ kind, host: "tlink.lib.tsinghua.edu.cn", papers, url: "https://tlink.lib.tsinghua.edu.cn/go", askedFor, proxied: true })
const publisher = (papers = 1): ExtensionWait => ({ kind: "sign-in", host: "sagepub.com", papers, url: "https://journals.sagepub.com/action/showLogin", askedFor: true, proxied: false })

describe("sites the extension waits at", () => {
  it("wait on the user only once they asked for one of the papers there", () => {
    expect(siteWaitItems([wait("sign-in", false), wait("check", false)], () => {})).toEqual([])
    const [item] = siteWaitItems([wait("sign-in", false), wait("sign-in", true, 3)], () => {})
    expect(item).toMatchObject({ tone: "warning", place: "/library", what: "Sign in to your library", where: "· 3 papers wait for it", action: { label: "Sign in" } })
  })

  it("are grey rows of their own until then", () => {
    expect(siteWaitItem(wait("sign-in", false), () => {}).tone).toBe("working")
    expect(siteWaitItem(wait("sign-in", true), () => {}).tone).toBe("warning")
  })

  it("name the library only for a sign-in through its proxy", () => {
    expect(siteWaitItem(publisher(), () => {})).toMatchObject({ what: "Sign in at sagepub.com", action: { label: "Sign in" } })
    expect(cameLine(1, [publisher(2)])?.detail).toBe("2 wait for a sign-in at sagepub.com")
  })

  it("say each kind of wait with its one thing to do", () => {
    const items = siteWaitItems([wait("check", true, 1), wait("permission", true)], () => {})
    expect(items.map((i) => [i.what, i.where, i.action?.label])).toEqual([
      ["Pass a check at tlink.lib.tsinghua.edu.cn", "· 1 paper", "Open it"],
      ["Let the owlit extension read tlink.lib.tsinghua.edu.cn", "· 2 papers", "Allow…"],
    ])
  })
})

describe("Since you left's line for PDFs", () => {
  it("counts the PDFs that came, and what still waits", () => {
    expect(cameLine(0, [wait("sign-in", false)])).toBeUndefined()
    expect(cameLine(1, [])).toEqual({ title: "1 PDF came through your browser" })
    expect(cameLine(3, [wait("sign-in", false, 2), wait("check", true, 1)])).toEqual({
      title: "3 PDFs came through your browser",
      detail: "2 wait for your library sign-in · 1 waits for a check at tlink.lib.tsinghua.edu.cn",
    })
  })
})
