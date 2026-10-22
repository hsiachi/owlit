import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionPaper, Library } from "../library/library.ts"
import { CONNECTED_MS, ExtensionWork, GAP_MS, IN_FLIGHT_MS, PAUSED_RETRY_MS, PROXY_GAP_MS } from "./work.ts"

const library = {} as Library
const paper = (paperId: string, host: string, extra: Partial<ExtensionPaper> = {}): ExtensionPaper => ({ paperId, url: `https://${host}/doi/${paperId}`, host, proxied: false, ...extra })

function setup() {
  const heard: string[][] = []
  let waitsChanged = 0
  const connects: Library[] = []
  const work = new ExtensionWork({ papers: (_, ids) => heard.push(ids), waits: () => waitsChanged++, connected: (library) => void connects.push(library) })
  const never = new AbortController().signal
  // What one GET /work hands out, when nothing has to wait for the gap
  const take = (hold = 0) => work.take(library, hold, never)
  return { work, heard, take, waitsChanged: () => waitsChanged, never, connects }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the extension's queue", () => {
  it("hands out one paper per site at a time, the next one only after the gap", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    work.fetch(library, paper("b1", "wiley.com"), false)
    const first = await take()
    expect(first.map((w) => w.paperId)).toEqual(["a1", "b1"])
    // Nothing more while both are in flight
    expect(await take()).toEqual([])
    work.settle(first[0].id, "no-copy")
    // a2 waits for sagepub.com's gap after a1 ended
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(GAP_MS - 1)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(1)
    expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
  })

  it("keeps the gap at a site when its papers come one at a time", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const [a1] = await take()
    work.settle(a1.id, "no-copy")
    // The next paper there comes after the site's queue emptied
    work.fetch(library, paper("a2", "sagepub.com"), false)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
  })

  it("spaces fetches through the library's proxy further apart", async () => {
    const { work, take } = setup()
    const proxied = { proxied: true, signIn: "https://proxy.example.edu/login" }
    work.fetch(library, paper("p1", "proxy.example.edu", proxied), false)
    work.fetch(library, paper("p2", "proxy.example.edu", proxied), false)
    const [first] = await take()
    expect(first).toMatchObject({ paperId: "p1", host: "proxy.example.edu", proxied: true })
    work.settle(first.id, "not-offered")
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(PROXY_GAP_MS - GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["p2"])
  })

  it("holds a long poll until a paper is due, and answers empty when none comes", async () => {
    const { work, never } = setup()
    const empty = work.take(library, 20_000, never)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await empty).toEqual([])
    const waiting = work.take(library, 20_000, never)
    work.fetch(library, paper("a1", "sagepub.com"), false)
    expect((await waiting).map((w) => w.paperId)).toEqual(["a1"])
    expect(work.connected()).toBe(true)
  })

  it("pauses a site that wants the user, while another site goes on", async () => {
    const { work, take, heard } = setup()
    for (const id of ["t1", "t2", "t3"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    work.fetch(library, paper("w1", "wiley.com"), false)
    work.fetch(library, paper("w2", "wiley.com"), false)
    const first = await take()
    const t1 = first.find((w) => w.paperId === "t1")!
    work.settle(t1.id, "check", { url: "https://www.tandfonline.com/doi/full/t1" })
    expect(work.waits()).toEqual([{ kind: "check", host: "tandfonline.com", papers: 3, url: "https://www.tandfonline.com/doi/full/t1", askedFor: false, proxied: false }])
    // Every paper waiting there is told it waits for the check, the one that met it first in line
    expect(heard.at(-1)).toEqual(["t1", "t2", "t3"])
    expect(work.holding(library, "t2")).toEqual({ host: "tandfonline.com", waits: "check" })
    work.settle(first.find((w) => w.paperId === "w1")!.id, "no-access")
    expect(work.holding(library, "w1")).toBeUndefined()
    vi.advanceTimersByTime(GAP_MS)
    // tandfonline.com's papers stay where they are; wiley.com's next goes
    expect((await take()).map((w) => w.paperId)).toEqual(["w2"])
  })

  it("pauses a site whose firewall blocks the user's browser, like a check", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("b1", "bmj.com"), false)
    const [b1] = await take()
    work.settle(b1.id, "blocked", { url: "https://www.bmj.com/content/b1" })
    expect(work.waits()).toEqual([{ kind: "blocked", host: "bmj.com", papers: 1, url: "https://www.bmj.com/content/b1", askedFor: false, proxied: false }])
    expect(work.holding(library, "b1")).toEqual({ host: "bmj.com", waits: "blocked" })
  })

  it("backs off at a site that reached nothing, keeping its papers, and goes on once it answers", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    const [first] = await take()
    work.settle(first.id, "offline")
    // Still queued, first in line
    expect(work.holding(library, "a1")).toEqual({ host: "sagepub.com" })
    vi.advanceTimersByTime(2 * 60_000 - 1)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(1)
    const [second] = await take()
    expect(second.paperId).toBe("a1")
    // Offline again: a longer wait
    work.settle(second.id, "offline")
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(1)
    const [third] = await take()
    expect(third.paperId).toBe("a1")
    // An answer: the next goes after the plain gap, and a later offline starts the back-off over
    work.settle(third.id, "no-copy")
    vi.advanceTimersByTime(GAP_MS)
    const [fourth] = await take()
    expect(fourth.paperId).toBe("a2")
    work.settle(fourth.id, "offline")
    vi.advanceTimersByTime(2 * 60_000)
    expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
  })

  it("holds a long poll through an offline back-off and hands the paper out when it ends", async () => {
    const { work, take, never } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const [first] = await take()
    work.settle(first.id, "offline")
    const held = work.take(library, 3 * 60_000, never)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect((await held).map((w) => w.paperId)).toEqual(["a1"])
  })

  it("goes on at a site once the user got through there, the paper they asked for first", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("s1", "sagepub.com"), false)
    work.fetch(library, paper("s2", "sagepub.com"), false)
    const [s1] = await take()
    work.settle(s1.id, "sign-in", { url: "https://journals.sagepub.com/action/ssostart" })
    // Asked for by the user while it waits: the line waits on them now
    work.fetch(library, paper("s3", "sagepub.com"), false)
    expect(work.waits()[0]).toMatchObject({ kind: "sign-in", papers: 3, askedFor: false })
    // A host under another site doesn't let it go
    expect(work.resume("www.wiley.com")).toBe(false)
    expect(await take()).toEqual([])
    expect(work.resume("journals.sagepub.com")).toBe(true)
    expect(work.waits()).toEqual([])
    expect((await take()).map((w) => w.paperId)).toEqual(["s1"])
  })

  it("waits to be allowed on the site a proxied fetch was sent on to, and goes on once it is", async () => {
    const { work, never } = setup()
    const tlink = (id: string) => paper(id, "tlink.lib.tsinghua.edu.cn", { url: `https://tlink.lib.tsinghua.edu.cn/go?url=https://doi.org/${id}`, proxied: true, signIn: "https://tlink.lib.tsinghua.edu.cn/" })
    const take = () => work.take(library, 0, never, "chrome")
    work.fetch(library, tlink("10.1037/a"), false)
    work.fetch(library, tlink("10.1037/b"), false)
    const [a] = await take()
    // The extension may not read where the proxy sent it: the whole publisher's site is the one to allow
    work.settle(a.id, "no-permission", { host: "doi.apa.org" })
    expect(work.waits()).toEqual([{ kind: "permission", host: "apa.org", papers: 2, url: a.url, askedFor: false, proxied: true }])
    expect(work.waitsForExtension()).toEqual([{ kind: "permission", host: "apa.org", papers: 2, proxied: true }])
    // Opened and resumed by the site the wait names, not the proxy's
    expect(work.open("permission", "tlink.lib.tsinghua.edu.cn")).toBeUndefined()
    expect(work.open("permission", "apa.org")).toBe("chrome")
    expect(work.pausedBy("apa.org")).toBe("chrome")
    expect(work.resume("tlink.lib.tsinghua.edu.cn")).toBe(false)
    expect(work.resume("psycnet.apa.org")).toBe(true)
    expect(work.waits()).toEqual([])
    expect((await take()).map((w) => w.paperId)).toEqual(["10.1037/a"])
    // Not allowed before the fetch, at the site's own host: the wait names the site as before
    work.fetch(library, paper("s1", "sagepub.com"), false)
    const [s1] = (await take()).filter((w) => w.paperId === "s1")
    work.settle(s1.id, "no-permission", { host: "journals.sagepub.com" })
    expect(work.waits().find((w) => w.kind === "permission" && w.host === "sagepub.com")).toBeDefined()
  })

  it("tries one paper of a paused site once more, then waits for the user", async () => {
    const { work, take, never } = setup()
    work.fetch(library, paper("t1", "tandfonline.com"), false)
    work.fetch(library, paper("t2", "tandfonline.com"), false)
    const [t1] = await take()
    work.settle(t1.id, "sign-in", { url: "https://www.tandfonline.com/action/showLogin" })
    vi.advanceTimersByTime(PAUSED_RETRY_MS - 1)
    expect(await take()).toEqual([])
    // A held GET /work hands out the try when it is due
    const held = work.take(library, 60_000, never)
    await vi.advanceTimersByTimeAsync(1)
    const [again] = await held
    expect(again.paperId).toBe("t1")
    // The line stays while the try is out
    expect(work.waits()).toMatchObject([{ kind: "sign-in", host: "tandfonline.com", papers: 2 }])
    work.settle(again.id, "sign-in")
    expect(work.waits()).toMatchObject([{ kind: "sign-in", papers: 2 }])
    // Met again: no third try on owlit's own, however long the site waits
    vi.advanceTimersByTime(24 * 60 * PAUSED_RETRY_MS)
    expect(await take()).toEqual([])
    // The user got through (the extension saw it): the site goes on
    expect(work.resume("tandfonline.com")).toBe(true)
    const [third] = await take()
    expect(third.paperId).toBe("t1")
    work.settle(third.id, "no-access")
    expect(work.waits()).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["t2"])
  })

  it("goes on through once a try at a paused site gets through by itself", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("t1", "tandfonline.com"), false)
    const [t1] = await take()
    work.settle(t1.id, "sign-in")
    vi.advanceTimersByTime(PAUSED_RETRY_MS)
    const [again] = await take()
    // The user signed in somewhere the extension didn't see
    work.settle(again.id, "no-access")
    expect(work.waits()).toEqual([])
    expect(work.holding(library, "t1")).toBeUndefined()
  })

  it("takes a pause a paper's record carries over as the site's own, line up and one try to come", async () => {
    const { work, take, waitsChanged } = setup()
    const before = waitsChanged()
    work.fetch(library, paper("p1", "sagepub.com", { signIn: "https://proxy.example.edu/login" }), false, { kind: "sign-in" })
    expect(work.waits()).toMatchObject([{ kind: "sign-in", host: "sagepub.com", papers: 1, url: "https://proxy.example.edu/login" }])
    expect(waitsChanged()).toBeGreaterThan(before)
    expect(work.holding(library, "p1")).toMatchObject({ host: "sagepub.com", waits: "sign-in" })
    // A second paper of the site joins the line; a site with something going on keeps its own state
    work.fetch(library, paper("p2", "sagepub.com"), false, { kind: "check" })
    expect(work.waits()).toMatchObject([{ kind: "sign-in", papers: 2 }])
    // Its one try on owlit's own goes at once (the user may have got through since owlit last ran);
    // met again, the site waits for the user
    const [p1] = await take()
    expect(p1.paperId).toBe("p1")
    work.settle(p1.id, "sign-in")
    vi.advanceTimersByTime(24 * 60 * PAUSED_RETRY_MS)
    expect(await take()).toEqual([])
    // Asked for by the user, it is tried at once
    work.fetch(library, paper("p1", "sagepub.com"), true)
    expect((await take()).map((w) => w.paperId)).toEqual(["p1"])
  })

  it("lets go of a paper that got its PDF another way or left the library", async () => {
    const { work, take, waitsChanged } = setup()
    for (const id of ["t1", "t2"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    work.fetch(library, paper("w1", "wiley.com"), false)
    work.fetch(library, paper("w2", "wiley.com"), false)
    const first = await take()
    work.settle(first.find((w) => w.paperId === "t1")!.id, "sign-in")
    const before = waitsChanged()
    work.drop(library, "t2")
    expect(work.waits()).toMatchObject([{ host: "tandfonline.com", papers: 1 }])
    expect(waitsChanged()).toBeGreaterThan(before)
    work.drop(library, "t1")
    expect(work.waits()).toEqual([])
    expect(work.holding(library, "t1")).toBeUndefined()
    // A queued paper at a site going on
    work.drop(library, "w2")
    work.settle(first.find((w) => w.paperId === "w1")!.id, "no-copy")
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toEqual([])
  })

  it("puts what the user asked for first, and tries a paused site once more for it", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("s1", "sagepub.com"), false)
    work.fetch(library, paper("s2", "sagepub.com"), false)
    const [s1] = await take()
    work.settle(s1.id, "check")
    expect(work.waits()[0].askedFor).toBe(false)
    vi.advanceTimersByTime(GAP_MS)
    work.fetch(library, paper("s2", "sagepub.com"), true)
    expect(work.waits()).toEqual([])
    const [again] = await take()
    expect(again.paperId).toBe("s2")
    work.settle(again.id, "check")
    expect(work.waits()[0]).toMatchObject({ kind: "check", papers: 2, askedFor: true })
  })

  it("opens the proxy's sign-in for a sign-in through it", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("p1", "tlink.lib.tsinghua.edu.cn", { proxied: true, signIn: "https://tlink.lib.tsinghua.edu.cn/go" }), false)
    const [p1] = await take()
    work.settle(p1.id, "sign-in", { url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form" })
    expect(work.waits()[0]).toMatchObject({ kind: "sign-in", url: "https://tlink.lib.tsinghua.edu.cn/go", proxied: true })
    expect(work.holding(library, "p1")).toEqual({ host: "tlink.lib.tsinghua.edu.cn", waits: "sign-in", proxied: true })
    expect(work.waitsForExtension()).toEqual([{ kind: "sign-in", host: "tlink.lib.tsinghua.edu.cn", papers: 1, proxied: true }])
  })

  it("asks again for a fetch the extension never answered, not for one still going", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const [lost] = await take()
    // The extension's slowest fetch: three gets of a minute each, then the upload
    vi.advanceTimersByTime(4 * 60_000)
    expect(await take()).toEqual([])
    expect(work.paperOf(lost.id)).toBeDefined()
    vi.advanceTimersByTime(IN_FLIGHT_MS - 4 * 60_000)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    const [again] = await take()
    expect(again.paperId).toBe("a1")
    expect(again.id).not.toBe(lost.id)
    expect(work.paperOf(lost.id)).toBeUndefined()
  })

  it("has the library hand over what waits when the extension connects, after being away, or for another workspace", async () => {
    const { work, take, connects } = setup()
    await take()
    // Connected now: the library is asked once, before anything was due
    expect(connects).toEqual([library])
    expect(work.connected()).toBe(true)
    vi.advanceTimersByTime(CONNECTED_MS - 1)
    await take()
    expect(connects).toHaveLength(1)
    // Away a while (the browser closed): what the plain routes missed meanwhile went nowhere
    vi.advanceTimersByTime(CONNECTED_MS)
    expect(work.connected()).toBe(false)
    await take()
    expect(connects).toHaveLength(2)
    const other = {} as Library
    await work.take(other, 0, new AbortController().signal)
    expect(connects).toEqual([library, library, other])
  })

  it("starts afresh for another workspace's library", async () => {
    const { work } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const other = {} as Library
    expect(await work.take(other, 0, new AbortController().signal)).toEqual([])
    expect(work.holding(library, "a1")).toBeUndefined()
  })
})
