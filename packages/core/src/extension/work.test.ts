import { PROXY_PRESETS } from "@owlit/protocol"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionPaper, Library } from "../library/library.ts"
import { CONNECTED_MS, ExtensionWork, GAP_MS, movedOn, parseWorkItemId, PAUSED_RETRY_MS, PROXY_GAP_MS, RESUME_AGAIN_MS, STALLED_MS } from "./work.ts"

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
  it("takes down a wait whose last paper moved on to another gate, so it doesn't catch later papers", async () => {
    const { work, take } = setup()
    work.fetch(library, { ...tlinkPaper("a1", "10.1177/1"), predicted: "pub:sage" }, true)
    const [first] = await take()
    work.settle(first.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
    vi.advanceTimersByTime(PAUSED_RETRY_MS)
    const [again] = await take()
    work.settle(again.id, "check", { url: "https://onlinelibrary.wiley.com/doi/a1" })
    expect(work.waits()).toMatchObject([{ id: "pub:wiley", papers: 1 }])
    work.fetch(library, { ...tlinkPaper("a2", "10.1177/2"), predicted: "pub:sage" }, false)
    expect(work.holding(library, "a2")).not.toHaveProperty("wait")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
  })

  describe("a paper stopped while it is out for a fetch", () => {
    async function outThenStopped() {
      const s = setup()
      s.work.fetch(library, paper("a1", "sagepub.com"), true)
      s.work.fetch(library, paper("a2", "sagepub.com"), true)
      const [item] = await s.take()
      s.work.stop(library, "a1")
      return { ...s, item }
    }

    it("reads as gone from the moment of the Stop, though the lane waits for its answer", async () => {
      const { work, take, item } = await outThenStopped()
      expect(work.holding(library, "a1")).toBeUndefined()
      expect(work.inQueue(library, "a1")).toBe(false)
      expect(work.isStopped(item.id)).toBe(true)
      expect(work.current(library, item.id)).toMatchObject({ paperId: "a1" })
      vi.advanceTimersByTime(GAP_MS)
      expect(await take()).toEqual([])
    })

    it.each(["check", "sign-in", "blocked", "no-permission", "offline", "no-access"] as const)("makes no wait and is never requeued after %s", async (ended) => {
      const { work, take, item } = await outThenStopped()
      work.settle(item.id, ended, { url: "https://journals.sagepub.com/doi/a1", host: "journals.sagepub.com" })
      expect(work.waits()).toEqual([])
      expect(work.holding(library, "a1")).toBeUndefined()
      vi.advanceTimersByTime(GAP_MS)
      expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
    })

    it("is never requeued when the extension goes away with it", async () => {
      const { work, take } = await outThenStopped()
      vi.advanceTimersByTime(STALLED_MS)
      expect(await take()).toEqual([])
      expect(work.holding(library, "a1")).toBeUndefined()
      vi.advanceTimersByTime(GAP_MS)
      expect((await take()).map((w) => w.paperId)).toEqual(["a2"])
    })

    it("lifts a wait it was the last paper of, its one try out", async () => {
      const { work, take } = setup()
      work.fetch(library, paper("a1", "sagepub.com"), true)
      const [first] = await take()
      work.settle(first.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
      vi.advanceTimersByTime(PAUSED_RETRY_MS)
      const [again] = await take()
      expect(again.paperId).toBe("a1")
      work.stop(library, "a1")
      expect(work.waits()).toEqual([])
      expect(work.followUpOf("pub:sage")).toBeUndefined()
    })

    it("goes on as the user's when they ask for it again before its answer", async () => {
      const { work, item } = await outThenStopped()
      work.fetch(library, paper("a1", "sagepub.com"), true)
      expect(work.isStopped(item.id)).toBe(false)
      expect(work.holding(library, "a1")).toMatchObject({ fetching: true })
      work.settle(item.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
      expect(work.waits()).toMatchObject([{ id: "pub:sage", kind: "check" }])
    })
  })

  it("keeps a check at a sign-in hop under the paper's publisher, holding only that publisher's papers in the proxy's lane", async () => {
    const { work, take } = setup()
    work.fetch(library, { ...tlinkPaper("s1", "10.1177/1"), predicted: "pub:sage" }, true)
    work.fetch(library, { ...tlinkPaper("w1", "10.1002/1"), predicted: "pub:wiley" }, false)
    const [s1] = await take()
    expect(work.gateFor(s1.id, { url: "https://login.openathens.net/saml?x=1" })).toBe("pub:sage")
    work.settle(s1.id, "check", { url: "https://login.openathens.net/saml?x=1", host: "login.openathens.net" })
    expect(work.waits()).toMatchObject([{ id: "pub:sage", kind: "check", at: "sagepub.com", url: tlinkPaper("s1", "10.1177/1").url, papers: 1 }])
    expect(work.waits()[0].watch).toContain("sagepub.com")
    expect(work.holding(library, "w1")).not.toHaveProperty("wait")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["w1"])
  })

  it("leaves another workspace's waits and queue alone when a closed workspace's hand-over comes late", async () => {
    const { work, never } = setup()
    const closed = {} as Library
    const open = {} as Library
    work.fetch(closed, paper("old", "wiley.com"), false)
    await work.take(open, 0, never)
    work.fetch(open, paper("p1", "sagepub.com"), false)
    work.fetch(open, paper("p2", "sagepub.com"), false)
    const [p1] = await work.take(open, 0, never)
    work.settle(p1.id, "check", { url: "https://journals.sagepub.com/doi/p1" })
    work.fetch(closed, paper("late", "wiley.com"), true)
    expect(await work.take(open, 0, never)).toEqual([])
    expect(work.waits()).toMatchObject([{ id: "pub:sage", papers: 2 }])
    expect(work.holding(open, "p2")).toMatchObject({ wait: "pub:sage" })
    expect(work.holding(closed, "late")).toBeUndefined()
  })

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

  it("tells the window of each paper as it goes out for a fetch, so it reads as being fetched", async () => {
    const { work, take, heard } = setup()
    work.fetch(library, paper("a1", "dl.acm.org"), true)
    work.fetch(library, paper("b1", "wiley.com"), true)
    expect(work.holding(library, "a1")).not.toHaveProperty("fetching")
    heard.length = 0
    expect((await take()).map((w) => w.paperId)).toEqual(["a1", "b1"])
    expect(heard.flat().sort()).toEqual(["a1", "b1"])
    expect(work.holding(library, "a1")).toMatchObject({ fetching: true })
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
    // The user says they got through: every paper there goes on as theirs
    expect(work.resumeWait("pub:sage")).toBe(true)
    const [again] = await take()
    expect(again).toMatchObject({ paperId: "a1", attempt: 3, userStarted: true })
    work.settle(again.id, "pdf")
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toMatchObject([{ paperId: "a2", userStarted: true }])
  })

  it("opens no tab for a paper the extension saw a wait passed for, unless the user opened that wait or asked for it", async () => {
    const { work, take } = setup()
    const check = { url: "https://journals.sagepub.com/doi/x" }
    work.fetch(library, paper("a1", "sagepub.com"), true)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    work.fetch(library, paper("b1", "wiley.com"), false)
    const [a1, b1] = await take()
    work.settle(a1.id, "check", check)
    work.settle(b1.id, "check", { url: "https://onlinelibrary.wiley.com/doi/b1" })
    // The extension sees the user on a page past the check at sagepub.com, browsing for something else
    expect(work.resumeAt("pub:sage")).toBe(true)
    const [again] = await take()
    // Asked for: still theirs
    expect(again).toMatchObject({ paperId: "a1", userStarted: true })
    work.settle(again.id, "no-copy")
    vi.advanceTimersByTime(GAP_MS)
    const [a2] = await take()
    expect(a2).toMatchObject({ paperId: "a2" })
    expect(a2).not.toHaveProperty("userStarted")
    // At wiley, they had the wait's page opened from owlit
    work.opened("pub:wiley", "Chrome")
    expect(work.resumeAt("pub:wiley")).toBe(true)
    expect(await take()).toMatchObject([{ paperId: "b1", userStarted: true }])
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
    expect(work.holding(library, "t2")).toMatchObject({ at: "tandfonline.com", kind: "check" })
    work.settle(first.find((w) => w.paperId === "w1")!.id, "no-access")
    expect(work.holding(library, "w1")).toBeUndefined()
    vi.advanceTimersByTime(GAP_MS)
    // tandfonline.com's papers stay where they are; wiley.com's next goes
    expect((await take()).map((w) => w.paperId)).toEqual(["w2"])
  })

  it("opens the paper's page for a check met at its PDF's address", async () => {
    const { work, take } = setup()
    const pdfUrl = "https://dl.acm.org/doi/pdf/10.1145/a1"
    work.fetch(library, { ...paper("a1", "dl.acm.org"), url: "https://dl.acm.org/doi/10.1145/a1", pdfUrl }, false)
    const [a1] = await take()
    work.settle(a1.id, "check", { url: pdfUrl })
    expect(work.waits()).toMatchObject([{ kind: "check", url: "https://dl.acm.org/doi/10.1145/a1" }])
  })

  it("gives the user a paper whose fetches went with two restarted workers, and goes on with its site", async () => {
    const lost: string[] = []
    const work = new ExtensionWork({ papers: () => {}, waits: () => {}, connected: () => {}, lost: (_, id) => lost.push(id) })
    const never = new AbortController().signal
    work.fetch(library, paper("big", "dl.acm.org"), false)
    work.fetch(library, paper("next", "dl.acm.org"), false)
    const ask = async (worker: string) => {
      const items = await work.take(library, 0, never, "p", worker)
      vi.advanceTimersByTime(GAP_MS)
      return items.map((w) => w.paperId)
    }
    expect(await ask("w1")).toEqual(["big"])
    // A new worker had nothing of the last one's fetch: handed out again, once
    expect(await ask("w2")).toEqual([])
    expect(await ask("w2")).toEqual(["big"])
    expect(lost).toEqual([])
    expect(await ask("w3")).toEqual([])
    expect(await ask("w3")).toEqual(["next"])
    expect(lost).toEqual(["big"])
    expect(work.holding(library, "big")).toBeUndefined()
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
    expect(work.holding(library, "b1")).toMatchObject({ at: "bmj.com", kind: "blocked" })
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
    expect(work.holding(library, "a1")).toMatchObject({ at: "sagepub.com" })
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

  it("tells the window when a back-off begins and ends, so no paper says a time to try again that has passed", async () => {
    const { work, take, heard } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), false)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    work.fetch(library, paper("w1", "wiley.com"), false)
    const first = await take()
    heard.length = 0
    work.settle(first.find((w) => w.paperId === "a1")!.id, "offline")
    // Every paper the back-off holds is said again with it, not only the one that met it
    expect(heard).toEqual([["a1", "a2"]])
    const until = work.holding(library, "a1")!.unreachable!.until
    heard.length = 0
    vi.advanceTimersByTime(until - Date.now())
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1)
    // sagepub.com's papers, not wiley.com's
    expect(heard).toEqual([["a1", "a2"]])
    expect(work.holding(library, "a1")).not.toHaveProperty("unreachable")
  })

  it("through the proxy, backs off from a publisher that reached nothing alone, and goes on with the others", async () => {
    const { work, take } = setup()
    work.fetch(library, tlinkPaper("sage", "10.1177/1"), false)
    work.fetch(library, tlinkPaper("wiley", "10.1111/1"), false)
    work.fetch(library, tlinkPaper("ieee", "10.1109/1"), false)
    const [first] = await take()
    expect(first).toMatchObject({ paperId: "sage", gate: "pub:sage" })
    // The proxy sent the browser on to SAGE, whose host didn't resolve
    work.settle(first.id, "offline", { host: "journals.sagepub.com" })
    expect(work.holding(library, "sage")).toMatchObject({ unreachable: { at: "journals.sagepub.com", until: Date.now() + 2 * 60_000 } })
    expect(work.holding(library, "wiley")).not.toHaveProperty("unreachable")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [second] = await take()
    expect(second.paperId).toBe("wiley")
    work.settle(second.id, "pdf")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [third] = await take()
    expect(third.paperId).toBe("ieee")
    // SAGE keeps its place in its gate, and goes once its back-off ends
    vi.advanceTimersByTime(2 * 60_000)
    work.settle(third.id, "no-copy")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["sage"])
  })

  it("through the proxy, backs off from every paper when the proxy itself reached nothing", async () => {
    const { work, take } = setup()
    work.fetch(library, tlinkPaper("sage", "10.1177/1"), false)
    work.fetch(library, tlinkPaper("wiley", "10.1111/1"), false)
    const [first] = await take()
    work.settle(first.id, "offline", { host: TLINK })
    expect(work.holding(library, "wiley")).toMatchObject({ unreachable: { at: TLINK } })
    vi.advanceTimersByTime(2 * 60_000 - 1)
    expect(await take()).toEqual([])
    vi.advanceTimersByTime(1)
    expect((await take()).map((w) => w.paperId)).toEqual(["sage"])
  })

  it("ends a held ask once a paper going on after the user got through has its answer, so the popup's count is current", async () => {
    const { work, never } = setup()
    work.fetch(library, paper("a1", "sagepub.com"), true)
    work.fetch(library, paper("a2", "sagepub.com"), false)
    const [a1] = await work.take(library, 0, never, "pairing-1")
    work.settle(a1.id, "check", { url: "https://journals.sagepub.com/doi/a1" })
    expect(work.resumeWait("pub:sage")).toBe(true)
    const [again] = await work.take(library, 0, never, "pairing-1")
    // The extension holds its next ask while it fetches
    const held = work.take(library, 20_000, never, "pairing-1")
    work.settle(again.id, "pdf")
    await vi.advanceTimersByTimeAsync(0)
    expect(await held).toEqual([])
    // Once: the next ask is held again
    const next = work.take(library, 20_000, never, "pairing-1")
    let ended = false
    void next.then(() => (ended = true))
    await vi.advanceTimersByTimeAsync(GAP_MS - 1)
    expect(ended).toBe(false)
  })

  it("ends a held ask at once when the waits change, so the extension watches for a new one within a second", async () => {
    const { work, never } = setup()
    for (const id of ["a", "b"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    const [a] = await work.take(library, 0, never, "p1")
    // Held: b waits for the gap after a
    let ended = false
    const held = work.take(library, 25_000, never, "p1").then(() => (ended = true))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ended).toBe(false)
    // a met a check: a wait came up
    work.settle(a.id, "check")
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toBe(true)
    await held
    // Answered with it, the next ask is held again; the check turning into a block ends it at once
    ended = false
    const next = work.take(library, 25_000, never, "p1").then(() => (ended = true))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ended).toBe(false)
    work.blocked("www.tandfonline.com", "https://www.tandfonline.com/blocked")
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toBe(true)
    await next
  })

  it("tells the window when the extension went, and when it is back", async () => {
    const { work, take, waitsChanged } = setup()
    await take()
    expect(work.connected()).toBe(true)
    const before = waitsChanged()
    vi.advanceTimersByTime(CONNECTED_MS - 1)
    expect(waitsChanged()).toBe(before)
    vi.advanceTimersByTime(2)
    expect(work.connected()).toBe(false)
    expect(waitsChanged()).toBe(before + 1)
    await take()
    expect(work.connected()).toBe(true)
    expect(waitsChanged()).toBe(before + 2)
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
    for (const id of ["a", "b"]) expect(work.holding(library, id)).toEqual({ lane: `proxy:${TLINK}`, gate: "pub:apa", attempt: expect.any(Number), wait: "pub:apa", kind: "permission", at: "apa.org" })
    // Opened by its id
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
    expect(work.holding(library, "misq")).toMatchObject({ wait: `proxy:${TLINK}`, kind: "sign-in", at: TLINK })
    // The school's sign-in page loading, under the same registrable domain, is not the user through
    expect(work.resume("id.tsinghua.edu.cn")).toBe(false)
    expect(work.waits()).toMatchObject([{ id: `proxy:${TLINK}` }])
    // Signed in: the publisher's check still holds its own two
    work.resume(TLINK)
    expect(work.waits()).toMatchObject([{ id: "pub:misq", papers: 2 }])
    work.drop(library, "misq")
    work.drop(library, "misq2")
    expect(work.waits()).toEqual([])
    // First in the proxy's line, at once now that the user got through
    expect(work.holding(library, "sage")).toEqual({ lane: `proxy:${TLINK}`, gate: `proxy:${TLINK}`, attempt: 2, at: TLINK, turnAt: Date.now() })
  })

  it("watches a line going on after the proxy's sign-in at its papers' publishers too, where the user sees them", async () => {
    const { work, take } = setup()
    for (const [id, doi] of [["tandf", "10.1080/1"], ["wiley", "10.1111/1"]]) work.fetch(library, tlinkPaper(id, doi), false)
    const [first] = await take()
    work.settle(first.id, "sign-in", { host: "id.tsinghua.edu.cn", url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form" })
    work.opened(`proxy:${TLINK}`, "Chrome")
    work.resume(TLINK)
    const [line] = work.goneWaits()
    expect(line).toMatchObject({ gate: `proxy:${TLINK}`, going: { ids: ["tandf", "wiley"] } })
    expect(line.watch).toEqual(expect.arrayContaining([TLINK, "tandfonline.com", "wiley.com"]))
    // T&F's came: the line is watched where its papers still going are
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [tandf] = await take()
    work.settle(tandf.id, "pdf")
    expect(work.goneWaits()[0].watch).not.toContain("tandfonline.com")
    expect(work.goneWaits()[0].watch).toEqual(expect.arrayContaining([TLINK, "wiley.com"]))
  })

  it("says when each paper in the proxy's line gets its turn, and lets a publisher that reached nothing go after the papers that can go now", async () => {
    const { work, take, heard } = setup()
    for (const [id, doi] of [["sage", "10.1177/1"], ["wiley", "10.1111/1"], ["ieee", "10.1109/1"], ["acm", "10.1145/1"]]) work.fetch(library, tlinkPaper(id, doi), false)
    const [first] = await take()
    expect(first.paperId).toBe("sage")
    // While SAGE is out, the others are a gap apart behind it
    const now = Date.now()
    expect(["wiley", "ieee", "acm"].map((id) => work.holding(library, id)?.turnAt)).toEqual([now + PROXY_GAP_MS, now + 2 * PROXY_GAP_MS, now + 3 * PROXY_GAP_MS])
    heard.length = 0
    work.settle(first.id, "offline", { host: "journals.sagepub.com" })
    // They moved up, and the window hears it
    expect(heard.flat()).toEqual(expect.arrayContaining(["wiley", "ieee", "acm"]))
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [second] = await take()
    expect(second.paperId).toBe("wiley")
    // SAGE's back-off ends before IEEE's turn: it still goes after the papers that can go
    vi.advanceTimersByTime(2 * 60_000)
    expect(work.holding(library, "sage")?.turnAt).toBe(work.holding(library, "acm")!.turnAt! + PROXY_GAP_MS)
    work.settle(second.id, "pdf")
    vi.advanceTimersByTime(PROXY_GAP_MS)
    expect((await take()).map((w) => w.paperId)).toEqual(["ieee"])
  })

  it("keeps a wait for its other papers when the one out for its try has its PDF by another way", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("s1", "sagepub.com"), false)
    work.fetch(library, paper("s2", "sagepub.com"), false)
    const [s1] = await take()
    work.settle(s1.id, "check", { url: "https://journals.sagepub.com/doi/s1" })
    vi.advanceTimersByTime(PAUSED_RETRY_MS)
    const [tried] = await take()
    expect(tried.paperId).toBe("s1")
    // The user dropped s1's PDF meanwhile: its answer finds nothing to fetch (server.ts's 409)
    work.settle(tried.id, undefined)
    expect(work.waits()).toMatchObject([{ id: "pub:sage", kind: "check", papers: 1 }])
    expect(work.holding(library, "s2")).toMatchObject({ wait: "pub:sage" })
    work.drop(library, "s2")
    expect(work.waits()).toEqual([])
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
    expect(work.holding(library, "p1")).toMatchObject({ gate: "pub:sage", attempt: 2, wait: "pub:sage", kind: "sign-in", at: "journals.sagepub.com" })
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

  it("after a restart, holds the papers that were in its queues with the browser, under the wait at their gate", async () => {
    vi.useRealTimers()
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-work-")))
    try {
      const lib = { dataDir: base } as Library
      const before = setup().work
      const never = new AbortController().signal
      before.fetch(lib, paper("p1", "sagepub.com"), false)
      before.fetch(lib, paper("p2", "sagepub.com"), false)
      before.fetch(lib, paper("w1", "wiley.com"), false)
      const out = await before.take(lib, 0, never)
      before.settle(out.find((w) => w.paperId === "p1")!.id, "check", { url: "https://journals.sagepub.com/doi/p1" })
      await before.flush()
      // owlit starts again; the extension hasn't asked yet
      const { work } = setup()
      expect(await work.queuedBefore(lib)).toEqual(new Set(["p1", "p2", "w1"]))
      await work.restore(lib, [{ paperId: "p1", kind: "check", gate: "pub:sage", url: "https://journals.sagepub.com/doi/p1", host: "journals.sagepub.com", tries: 1, triedAt: Date.now() }], undefined, [
        { paperId: "p2", tries: 0 },
        { paperId: "w1", tries: 0 },
      ])
      expect(work.waits()).toMatchObject([{ id: "pub:sage", papers: 2 }])
      expect(work.holding(lib, "p2")).toMatchObject({ gate: "pub:sage", attempt: 1, wait: "pub:sage", kind: "check" })
      expect(work.holding(lib, "w1")).toEqual({ lane: "pub:wiley", gate: "pub:wiley", attempt: 1, at: "wiley.com" })
      expect(work.inQueue(lib, "w1")).toBe(false)
      // Queued again once the extension asks: in line as any other, numbered on from its record
      work.fetch(lib, paper("w1", "wiley.com"), false)
      expect(work.holding(lib, "w1")).toMatchObject({ lane: "pub:wiley", attempt: 1 })
      expect(work.inQueue(lib, "w1")).toBe(true)
      // Stopped before it asks: out of the wait's count
      work.drop(lib, "p2")
      expect(work.waits()).toMatchObject([{ id: "pub:sage", papers: 1 }])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("counts a paper of a line going on as moved on once it waits elsewhere, never while it is still the line's", () => {
    const proxy = `proxy:${TLINK}` as const
    const base = { lane: proxy, gate: "pub:tandf" as const, attempt: 2, at: TLINK }
    // In line, or out for its fetch: still going on there
    expect(movedOn(proxy, base)).toBe(false)
    expect(movedOn(proxy, { ...base, fetching: true })).toBe(false)
    // Under the publisher's check it met once through the proxy, or another site's that didn't answer
    expect(movedOn(proxy, { ...base, wait: "pub:tandf", kind: "check", at: "tandfonline.com" })).toBe(true)
    expect(movedOn(proxy, { ...base, gate: "pub:sage", unreachable: { at: "journals.sagepub.com", until: 1 } })).toBe(true)
    // The proxy itself not answering, or the line's own wait back: still the line's
    expect(movedOn(proxy, { ...base, unreachable: { at: TLINK, until: 1 } })).toBe(false)
    expect(movedOn(proxy, { ...base, wait: proxy, kind: "sign-in", at: TLINK })).toBe(false)
    expect(movedOn("pub:wiley", { lane: "pub:wiley", gate: "pub:wiley", attempt: 1, at: "wiley.com", unreachable: { at: "onlinelibrary.wiley.com", until: 1 } })).toBe(false)
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
    expect(work.waits()).toMatchObject([{ kind: "check", papers: 2, askedFor: true }])
    const [again] = await take()
    expect(again.paperId).toBe("s2")
    work.settle(again.id, "check")
    expect(work.waits()[0]).toMatchObject({ kind: "check", papers: 2, askedFor: true })
  })

  it("says a paper under a wait is still going while the try the user started there is to come, until it ends", async () => {
    const { work, take, never } = setup()
    for (const [id, doi] of [["tandf", "10.1080/1"], ["wiley", "10.1111/1"]]) work.fetch(library, tlinkPaper(id, doi), false)
    const [first] = await take()
    work.settle(first.id, "check", { url: "https://www.tandfonline.com/doi/10.1080/1" })
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [second] = await take()
    work.settle(second.id, "check", { url: "https://onlinelibrary.wiley.com/doi/10.1111/1" })
    // owlit's own later try isn't the user's
    expect(work.holding(library, "tandf")).not.toHaveProperty("trying")
    // Get PDFs on both: each wait's one try is due, the proxy's lane taking one at a time
    work.fetch(library, tlinkPaper("tandf", "10.1080/1"), true)
    work.fetch(library, tlinkPaper("wiley", "10.1111/1"), true)
    expect(["tandf", "wiley"].map((id) => work.holding(library, id))).toMatchObject([
      { wait: "pub:tandf", trying: true },
      { wait: "pub:wiley", trying: true },
    ])
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [tandf] = await work.take(library, 0, never, "chrome")
    expect(tandf).toMatchObject({ paperId: "tandf", userStarted: true })
    work.settle(tandf.id, "pdf")
    expect(work.holding(library, "wiley")).toMatchObject({ wait: "pub:wiley", trying: true })
    vi.advanceTimersByTime(PROXY_GAP_MS)
    const [wiley] = await take()
    // Its try met the check again: the wait is the user's once more
    work.settle(wiley.id, "check", { url: "https://onlinelibrary.wiley.com/doi/10.1111/1" })
    expect(work.holding(library, "wiley")).toMatchObject({ wait: "pub:wiley" })
    expect(work.holding(library, "wiley")).not.toHaveProperty("trying")
  })

  it("keeps a wait the user opened when they ask again for a paper under it, and what they did there", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("s1", "sagepub.com"), true)
    work.fetch(library, paper("s2", "sagepub.com"), false)
    const [s1] = await take()
    work.settle(s1.id, "check", { url: "https://journals.sagepub.com/doi/s1" })
    const { since } = work.waits()[0]
    work.opened("pub:sage", "Chrome")
    vi.advanceTimersByTime(GAP_MS)
    // Get PDFs, or Look again, while the check is in front of the user
    work.fetch(library, paper("s2", "sagepub.com"), true)
    work.fetch(library, paper("s1", "sagepub.com"), true)
    expect(work.waits()).toMatchObject([{ id: "pub:sage", since, opened: { browser: "Chrome" }, papers: 2 }])
    expect(work.holding(library, "s1")).toMatchObject({ wait: "pub:sage" })
    // Its one try goes now, and meets the check again: the same wait, still opened
    const [again] = await take()
    expect(again).toMatchObject({ userStarted: true })
    work.settle(again.id, "check", { url: "https://journals.sagepub.com/doi/s2" })
    expect(work.waits()).toMatchObject([{ id: "pub:sage", since, opened: { browser: "Chrome" }, papers: 2 }])
    vi.advanceTimersByTime(GAP_MS)
    expect(await take()).toEqual([])
  })

  it("opens the proxy's sign-in for a sign-in through it", async () => {
    const { work, take } = setup()
    work.fetch(library, tlinkPaper("p1", "10.1126/science.1"), false)
    const [p1] = await take()
    work.settle(p1.id, "sign-in", { url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form" })
    expect(work.waits()[0]).toMatchObject({ kind: "sign-in", url: `https://${TLINK}/`, proxied: true })
    expect(work.holding(library, "p1")).toMatchObject({ at: TLINK, kind: "sign-in", wait: `proxy:${TLINK}` })
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

  it("starts a new line going on when the user gets through at a gate whose last line has ended", async () => {
    const { work, take } = setup()
    for (const id of ["a", "b"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    const [a] = await take()
    work.settle(a.id, "check", { triedAt: 500 })
    work.resume("tandfonline.com")
    // Both of the first line end with their PDFs
    const [one] = await take()
    work.settle(one.id, "pdf")
    vi.advanceTimersByTime(GAP_MS)
    const [two] = await take()
    work.settle(two.id, "pdf")
    expect(work.goneWaits()).toMatchObject([{ going: { ids: ["a", "b"] } }])
    // Later, two more papers meet the gate's check, and the user gets through again
    for (const id of ["c", "d"]) work.fetch(library, paper(id, "tandfonline.com"), false)
    vi.advanceTimersByTime(GAP_MS)
    const [c] = await take()
    work.settle(c.id, "check", { triedAt: 9_000 })
    work.resume("tandfonline.com")
    expect(work.goneWaits()).toMatchObject([{ since: 9_000, going: { ids: ["c", "d"] } }])
  })

  it("hands a paper out once when the extension posts the same resume twice, though its wait came back in between", async () => {
    const { work, take } = setup()
    work.fetch(library, paper("a", "dl.acm.org"), false)
    const [a] = await take()
    work.settle(a.id, "check", { triedAt: 500 })
    expect(work.resumeAt("pub:acm")).toBe(true)
    const [again] = await take()
    expect(again).toMatchObject({ paperId: "a", attempt: 2 })
    // Its try meets the check at once: the same wait (same since) is up again
    work.settle(again.id, "check", { triedAt: 600 })
    expect(work.waits()).toMatchObject([{ id: "pub:acm", since: 500 }])
    // The page's other look posts again: heard, and nothing handed out
    expect(work.resumeAt("pub:acm")).toBe(true)
    expect(work.resume("dl.acm.org")).toBe(true)
    expect(work.waits()).toMatchObject([{ id: "pub:acm" }])
    expect(await take()).toEqual([])
    // A later page past it is the user again
    vi.advanceTimersByTime(RESUME_AGAIN_MS)
    expect(work.resumeAt("pub:acm")).toBe(true)
    expect(await take()).toMatchObject([{ paperId: "a", attempt: 3 }])
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

describe("pdf-work.json across workspaces", () => {
  it("reads a workspace's notes again only once what it still had to write is written (A, then B, then A)", async () => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-work-")))
    try {
      const a = { dataDir: path.join(base, "a") } as Library
      const b = { dataDir: path.join(base, "b") } as Library
      const { work } = setup()
      const never = new AbortController().signal
      work.fetch(a, paper("a1", "sagepub.com"), false)
      // Handed out: the tally's to write, in a while
      expect(await work.take(a, 0, never)).toHaveLength(1)
      work.fetch(b, paper("b1", "wiley.com"), false)
      work.fetch(a, paper("a2", "sagepub.com"), false)
      await work.flush()
      expect(work.tallies().get("pub:sage")).toMatchObject({ handed: 1 })
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

