import { PROXY_PRESETS } from "@owlit/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionPaper, Library } from "../library/library.ts"
import { CONNECTED_MS, ExtensionWork, GAP_MS, parseWorkItemId, PAUSED_RETRY_MS, PROXY_GAP_MS, STALLED_MS } from "./work.ts"

const library = {} as Library
const TLINK = "tlink.lib.tsinghua.edu.cn"
// A paper through Tsinghua's tlink, to the DOI's link
const tlinkPaper = (paperId: string, doi: string): ExtensionPaper => ({ paperId, url: `https://${TLINK}/go?url=https://doi.org/${doi}`, host: TLINK, proxied: true, signIn: `https://${TLINK}/`, proxy: PROXY_PRESETS.tsinghua.proxy })
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

  it("marks a fetch the user started, and a tab-only publisher's, and no other", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), true)
    work.fetch(library, paper("b1", "dl.acm.org"), false)
    const [a1, b1] = await take()
    expect(a1).toMatchObject({ paperId: "a1", attempt: 1, lane: "pub:sage", gate: "pub:sage", userStarted: true })
    expect(a1).not.toHaveProperty("inTab")
    expect(b1).toMatchObject({ paperId: "b1", gate: "pub:acm", inTab: true })
    expect(b1).not.toHaveProperty("userStarted")
  })

  it("lets a fetch open a tab after the user got through at its wait, not at the wait's own later try", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), true)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    const [a1] = await take()
    work.settle(a1.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
    // The wait's one try on owlit's own, a while later, is nobody's run
    vi.advanceTimersByTime(PAUSED_RETRY_MS)
    const [tried] = await take()
    expect(tried).toMatchObject({ paperId: "a1", attempt: 2 })
    expect(tried).not.toHaveProperty("userStarted")
    work.settle(tried.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
    expect(work.resumeAt("pub:sage")).toBe(true)
    const [again] = await take()
    expect(again).toMatchObject({ paperId: "a1", attempt: 3, userStarted: true })
    work.settle(again.id, "pdf")
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toMatchObject([{ paperId: "a2", userStarted: true }])
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
    expect(work.waits()).toMatchObject([{ kind: "check", host: "tandfonline.com", papers: 3, url: "https://www.tandfonline.com/doi/full/t1", askedFor: false, proxied: false }])
    // Every paper waiting there is told it waits for the check, the one that met it first in line
    expect(heard.at(-1)).toEqual(["t1", "t2", "t3"])
    expect(work.holding(library, "t2")).toMatchObject({ host: "tandfonline.com", waits: "check" })
    work.settle(first.find((w) => w.paperId === "w1")!.id, "no-access")
    expect(work.holding(library, "w1")).toBeUndefined()
    vi.advanceTimersByTime(GAP_MS)
    // tandfonline.com's papers stay where they are; wiley.com's next goes
    expect((await take()).map((w) => w.paperId)).toEqual(["w2"])
  })

  it("goes on at a site whose page the extension couldn't open, the paper out of the queue", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "apa.org"), false)
    work.fetch(library, paper("a2", "apa.org"), false)
    const [a1] = await take()
    work.settle(a1.id, "unreadable", { url: "https://psycnet.apa.org/doiLanding?doi=a1", host: "psycnet.apa.org" })
    expect(work.waits()).toEqual([])
    expect(work.holding(library, "a1")).toBeUndefined()
    vi.advanceTimersByTime(GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
  })

  it("pauses a site whose firewall blocks the user's browser, like a check", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("b1", "bmj.com"), false)
    const [b1] = await take()
    work.settle(b1.id, "blocked", { url: "https://www.bmj.com/content/b1" })
    expect(work.waits()).toMatchObject([{ kind: "blocked", host: "bmj.com", papers: 1, url: "https://www.bmj.com/content/b1", askedFor: false, proxied: false }])
    expect(work.holding(library, "b1")).toMatchObject({ host: "bmj.com", waits: "blocked" })
  })

  it("turns a check into a block the user's browser met there, without another try", async () => {
    const { work, take, heard } = setup()
    for (const id of ["q1", "q2"]) work.fetch(library, paper(id, "bmj.com"), false)
    const first = await take()
    work.settle(first[0].id, "check", { url: "https://qualitysafety.bmj.com/content/q1" })
    expect(work.blocked("qualitysafety.bmj.com", "https://qualitysafety.bmj.com/content/q1")).toBe(true)
    expect(work.waits()).toMatchObject([{ id: "site:bmj.com", kind: "blocked", at: "qualitysafety.bmj.com", papers: 2, url: "https://qualitysafety.bmj.com/content/q1", askedFor: false, proxied: false }])
    expect(heard.at(-1)).toEqual(["q1", "q2"])
    // Nowhere paused there, or paused for something a block doesn't stand in for: nothing changes
    expect(work.blocked("wiley.com", "https://onlinelibrary.wiley.com/doi/1")).toBe(false)
    expect(work.blocked("bmj.com", "https://www.bmj.com/content/2")).toBe(false)
  })

  it("backs off at a site that reached nothing, keeping its papers, and goes on once it answers", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    const [first] = await take()
    work.settle(first.id, "offline")
    // Still queued, first in line
    expect(work.holding(library, "a1")).toMatchObject({ host: "sagepub.com" })
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
    const take = () => work.take(library, 0, never, "chrome")
    work.fetch(library, tlinkPaper("a", "10.1037/a"), false)
    work.fetch(library, tlinkPaper("b", "10.1037/b"), false)
    const [a] = await take()
    // The extension may not read where the proxy sent it: the whole publisher's site is the one to allow
    work.settle(a.id, "no-permission", { host: "doi.apa.org" })
    expect(work.waits()).toMatchObject([{ id: "pub:apa", kind: "permission", at: "apa.org", host: "apa.org", papers: 2, url: a.url, askedFor: false, proxied: false }])
    expect(work.waitsForExtension()).toMatchObject([{ id: "pub:apa", kind: "permission", host: "apa.org", papers: 2, proxied: false }])
    // Both are APA's, so both are under it, though only one met it; the proxy's lane holds them both
    for (const id of ["a", "b"]) expect(work.holding(library, id)).toMatchObject({ lane: `proxy:${TLINK}`, gate: "pub:apa", wait: "pub:apa", kind: "permission", at: "apa.org", host: TLINK, waits: "permission", waitsAt: "apa.org", proxied: true })
    expect(work.holding(library, "b")).not.toHaveProperty("behind")
    // Named by the site it shows, not the proxy's; opened by its id
    expect(work.waitIdOf("permission", TLINK)).toBeUndefined()
    expect(work.waitIdOf("permission", "apa.org")).toBe("pub:apa")
    expect(work.open("pub:apa")).toBe("chrome")
    expect(work.pausedBy("pub:apa")).toBe("chrome")
    expect(work.resume(TLINK)).toBe(false)
    expect(work.resume("psycnet.apa.org")).toBe(true)
    expect(work.waits()).toEqual([])
    expect((await take()).map((w) => w.paperId)).toEqual(["a"])
    // Not allowed before the fetch, at the site's own host: the wait is the paper's own gate
    work.fetch(library, paper("s1", "sagepub.com"), false)
    const [s1] = (await take()).filter((w) => w.paperId === "s1")
    work.settle(s1.id, "no-permission", { host: "sagepub.com" })
    expect(work.waits().find((w) => w.kind === "permission")).toMatchObject({ id: "pub:sage", at: "sagepub.com" })
  })

  it("passes over the papers under a publisher's wait in the proxy's lane, and holds them all for its sign-in", async () => {
    const { work, never } = setup()
    const take = () => work.take(library, 0, never, "chrome")
    work.fetch(library, tlinkPaper("misq", "10.25300/misq/1"), false)
    work.fetch(library, tlinkPaper("misq2", "10.25300/misq/2"), false)
    work.fetch(library, tlinkPaper("sage", "10.1177/1"), false)
    const [misq] = await take()
    work.settle(misq.id, "check", { host: "misq.umn.edu", url: "https://misq.umn.edu/x?__cf_chl_tk=abc" })
    expect(work.waits()).toMatchObject([{ id: "pub:misq", kind: "check", at: "misq.umn.edu", papers: 2, askedFor: false, proxied: false }])
    expect(work.waits()[0].watch).toEqual(["misq.umn.edu"])
    // The next paper of the lane not under a wait goes, after the proxy's gap
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [next] = await take()
    expect(next.paperId).toBe("sage")
    expect(work.holding(library, "misq2")).toMatchObject({ gate: "pub:misq", wait: "pub:misq" })
    // The library's own sign-in is in the way of every paper through it, and opens its sign-in page;
    // the school's sign-in page it ended on is the proxy's, never named
    work.settle(next.id, "sign-in", { host: "id.tsinghua.edu.cn", url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form" })
    expect(work.waits()).toMatchObject([{ id: `proxy:${TLINK}`, kind: "sign-in", at: TLINK, papers: 3, url: `https://${TLINK}/`, proxied: true, watch: [TLINK] }])
    expect(work.holding(library, "misq")).toMatchObject({ wait: `proxy:${TLINK}`, kind: "sign-in", host: TLINK, proxied: true })
    expect(work.holding(library, "misq")).not.toHaveProperty("waitsAt")
    // Signed in: the publisher's check still holds its own two
    work.resume(TLINK)
    expect(work.waits()).toMatchObject([{ id: "pub:misq", papers: 2 }])
    work.drop(library, "misq")
    work.drop(library, "misq2")
    expect(work.waits()).toEqual([])
    expect(work.holding(library, "sage")).toEqual({ lane: `proxy:${TLINK}`, gate: `proxy:${TLINK}`, attempt: 2, host: TLINK, proxied: true })
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

  it("puts up the waits the papers' records say, before any extension connects, with one try to come", async () => {
    const { work, take, waitsChanged } = setup()
    const before = waitsChanged()
    await work.restore(library, [{ paperId: "p1", kind: "sign-in", gate: "pub:sage", url: "https://journals.sagepub.com/action/showLogin", host: "journals.sagepub.com", tries: 1, triedAt: 1 }], undefined)
    expect(work.waits()).toMatchObject([{ id: "pub:sage", kind: "sign-in", at: "journals.sagepub.com", papers: 1, url: "https://journals.sagepub.com/action/showLogin" }])
    expect(waitsChanged()).toBeGreaterThan(before)
    expect(work.holding(library, "p1")).toMatchObject({ gate: "pub:sage", attempt: 2, wait: "pub:sage", waits: "sign-in", waitsAt: "journals.sagepub.com" })
    expect(work.inQueue(library, "p1")).toBe(false)
    // Queued once the extension connects, it is under the wait, with a second paper of its gate
    work.fetch(library, paper("p1", "sagepub.com"), false)
    work.fetch(library, paper("p2", "sagepub.com"), false)
    expect(work.inQueue(library, "p1")).toBe(true)
    expect(work.waits()).toMatchObject([{ kind: "sign-in", papers: 2 }])
    // Its one try on owlit's own goes at once (the user may have got through since owlit last ran),
    // numbered on from the record; met again, the wait is for the user
    const [p1] = await take()
    expect(p1.id).toBe("p1#2")
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
    expect(work.queued(library)).toBe(3)
    work.drop(library, "t1")
    expect(work.waits()).toEqual([])
    expect(work.queued(library)).toBe(2)
    expect(work.queued({} as Library)).toBe(0)
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
    work.fetch(library, tlinkPaper("p1", "10.1126/science.1"), false)
    const [p1] = await take()
    work.settle(p1.id, "sign-in", { url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form" })
    expect(work.waits()[0]).toMatchObject({ kind: "sign-in", url: `https://${TLINK}/`, proxied: true })
    expect(work.holding(library, "p1")).toMatchObject({ host: TLINK, waits: "sign-in", proxied: true })
    expect(work.waitsForExtension()).toMatchObject([{ kind: "sign-in", host: TLINK, papers: 1, proxied: true }])
  })

  it("numbers each hand-out of a paper by the extension's tries its record holds", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com", { tries: 2 }), false)
    const [first] = await take()
    expect(first.id).toBe("a1#3")
    expect(parseWorkItemId(first.id)).toEqual({ paperId: "a1", attempt: 3 })
    expect(work.current(library, first.id)).toMatchObject({ paperId: "a1" })
    work.settle(first.id, "offline")
    vi.advanceTimersByTime(60 * 60_000)
    const [second] = await take()
    expect(second.id).toBe("a1#4")
    // The first attempt's answer, late: nothing changes
    work.settle(first.id, "no-copy")
    expect(work.current(library, second.id)).toBeDefined()
    expect(work.current(library, first.id)).toBeUndefined()
    // Handed over again by the library meanwhile, with a record that lags: the number never goes back
    work.fetch(library, paper("a1", "sagepub.com", { tries: 1 }), true)
    work.settle(second.id, "offline")
    vi.advanceTimersByTime(60 * 60_000)
    expect((await take())[0].id).toBe("a1#5")
    expect(parseWorkItemId("3f2a9c1e-uuid")).toBeUndefined()
    expect(parseWorkItemId("a1#0")).toBeUndefined()
  })

  it("doesn't ask again for a fetch while the extension it went to keeps asking, short of a stalled one", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const [out] = await take()
    const asks = STALLED_MS / (CONNECTED_MS / 2)
    for (let i = 1; i < asks; i++) {
      vi.advanceTimersByTime(CONNECTED_MS / 2)
      expect(await take()).toEqual([])
    }
    expect(work.current(library, out.id)).toBeDefined()
    // Out for STALLED_MS with the extension asking all along: an answer that never comes
    vi.advanceTimersByTime(CONNECTED_MS / 2)
    expect(await take()).toEqual([])
    expect(work.current(library, out.id)).toBeUndefined()
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toMatchObject([{ id: out.id }])
  })

  it("asks again under the same attempt once the extension comes back from being away", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    const [lost] = await take()
    // The machine slept: no ask for a while
    vi.advanceTimersByTime(CONNECTED_MS)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    const [again] = await take()
    expect(again).toMatchObject({ paperId: "a1", id: lost.id })
    // Both hand-outs' answers are the same attempt's: the first to come settles it
    work.settle(lost.id, "no-copy")
    expect(work.current(library, again.id)).toBeUndefined()
  })

  it("asks again for the fetches of an extension that closed its ask while it was held", async () => {
    const { work } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    work.fetch(library, paper("b1", "wiley.com"), false)
    const [a1, b1] = await work.take(library, 0, new AbortController().signal, "chrome")
    expect([a1.paperId, b1.paperId]).toEqual(["a1", "b1"])
    // Another browser asking meanwhile takes nothing of Chrome's while Chrome is still asking
    const held = new AbortController()
    const holding = work.take(library, 30_000, held.signal, "chrome")
    expect(await work.take(library, 0, new AbortController().signal, "arc")).toEqual([])
    // Chrome's service worker stopped mid-hold
    held.abort()
    expect(await holding).toEqual([])
    // Back in their queues, at the sites' pace from now
    expect(await work.take(library, 0, new AbortController().signal, "arc")).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    const again = await work.take(library, 0, new AbortController().signal, "arc")
    expect(again.map((w) => w.id)).toEqual([a1.id, b1.id])
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

  it("tallies each gate, and names one handed papers all day that gives nothing with no wait to say why", async () => {
    const { work, take } = setup()
    // The next one there, after the gap
    const out = async () => {
      vi.advanceTimersByTime(GAP_MS)
      const [item] = await take()
      return item
    }
    for (let i = 0; i < 4; i++) {
      work.fetch(library, paper(`u${i}`, "dl.acm.org"), false)
      work.settle((await out()).id, "unreadable")
    }
    // Four is bad luck
    expect(work.silentZeros()).toEqual([])
    work.fetch(library, paper("u4", "dl.acm.org"), false)
    work.settle((await out()).id, "unreadable")
    expect(work.silentZeros()).toEqual(["pub:acm"])
    expect(work.tallies().get("pub:acm")).toMatchObject({ handed: 5, pdfs: 0, endings: { unreadable: 5 } })
    // A wait there says why: not silent
    work.fetch(library, paper("c1", "dl.acm.org"), false)
    work.settle((await out()).id, "check")
    expect(work.silentZeros()).toEqual([])
    work.resume("dl.acm.org")
    // A PDF that came is not a zero
    const [c1] = await take()
    work.settle(c1.id, "pdf")
    expect(work.silentZeros()).toEqual([])
    expect(work.tallies().get("pub:acm")).toMatchObject({ handed: 7, pdfs: 1, lastPdfAt: expect.any(Number) })
  })

  it("follows a wait by its id, and knows the same wait when it comes back after the user got through", async () => {
    const { work, take } = setup()
    for (const id of ["a", "b"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    const [a] = await take()
    work.settle(a.id, "check", { triedAt: 500 })
    const [wait] = work.waits()
    expect(wait).toMatchObject({ id: "pub:tandf", since: 500, papers: 2 })
    work.opened("pub:tandf", "Dia")
    expect(work.waits()[0].opened).toEqual({ at: expect.any(Number), browser: "Dia" })
    expect(work.resumeWait("pub:tandf")).toBe(true)
    expect(work.goneWaits()).toMatchObject([{ gate: "pub:tandf", since: 500, going: { ids: ["a", "b"] } }])
    // The first try after it meets the same check: the same wait, which still asks the user
    const [again] = await take()
    work.settle(again.id, "check", { triedAt: 900 })
    expect(work.waits()).toMatchObject([{ id: "pub:tandf", since: 500, retried: { again: true } }])
    expect(work.waits()[0]).not.toHaveProperty("opened")
    expect(work.goneWaits()).toEqual([])
    expect(work.followUpOf("pub:tandf")?.going?.ids).toEqual(["a", "b"])
    // A check that turns into a block forgets the page opened for the check
    work.opened("pub:tandf", undefined)
    work.blocked("www.tandfonline.com", "https://www.tandfonline.com/blocked")
    expect(work.waits()[0]).toMatchObject({ kind: "blocked" })
    // Through again, its line put away: a later wait at the same gate is a new one
    work.resume("tandfonline.com")
    expect(work.goneWaits()).toHaveLength(1)
    expect(work.dismissGoing("pub:tandf")).toBe(true)
    expect(work.goneWaits()).toEqual([])
    vi.advanceTimersByTime(GAP_MS)
    const [later] = await take()
    work.settle(later.id, "check", { triedAt: 2000 })
    expect(work.waits()).toMatchObject([{ since: 2000 }])
    expect(work.waits()[0]).not.toHaveProperty("retried")
  })
})
