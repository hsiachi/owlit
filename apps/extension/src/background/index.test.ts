import type { WorkItem, WorkWait } from "@owlit/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser, FakeOwlit, type Answer, type FakeBrowser, type Site } from "../test/fake-chrome.ts"

// The background as it runs in the browser, on a fake chrome.*: owlit hands it papers (GET /work), and
// what it fetches, which tabs it opens and what it tells owlit are watched from outside.

// A Cloudflare check in front of a page: managed (it passes by itself in a tab that runs it) or
// interactive (a person must solve it)
const check = (interactive = false): Answer => ({
  status: 403,
  headers: { "cf-mitigated": "challenge" },
  html: `<html><head><title>Just a moment...</title></head><body>${interactive ? "<h1>Are you a robot?</h1>" : ""}<script>window._cf_chl_opt={cType: '${interactive ? "interactive" : "managed"}'}</script></body></html>`,
})
const article = (title: string, pdf: string): Answer => ({
  html: `<html><head><title>${title}</title><meta name="citation_title" content="${title}"><meta name="citation_pdf_url" content="${pdf}"></head><body><a href="${pdf}">PDF</a></body></html>`,
})

// A publisher behind a check. passAfter: looks at a hidden tab before its check lets it through;
// front: only once the tab is in front; interactive: never by waiting. worker: its firewall refuses the
// background's own fetch even after the check is passed. recheck: in-tab fetches before it asks again.
function guarded(content: (url: URL) => Answer, opts: { passAfter?: number; front?: boolean; interactive?: boolean; worker?: "refused" | "ok"; recheck?: number } = {}) {
  const state = { cleared: false, looks: 0, tabFetches: 0 }
  const site: Site = ({ url, from, look, tab }) => {
    if (from === "tab" && look && !state.cleared && !opts.interactive) {
      state.looks++
      if (opts.front ? tab?.active : state.looks >= (opts.passAfter ?? 2)) state.cleared = true
    }
    if (from === "tab" && !look && state.cleared && opts.recheck !== undefined && state.tabFetches++ >= opts.recheck) state.cleared = false
    const refused = !state.cleared || (from === "worker" && opts.worker !== "ok")
    return refused ? check(opts.interactive) : content(url)
  }
  return { site, state }
}

const item = (paperId: string, gate: WorkItem["gate"], url: string, extra: Partial<WorkItem> = {}): WorkItem => ({
  id: `${paperId}#1`,
  paperId,
  attempt: 1,
  url,
  lane: gate,
  gate,
  host: new URL(url).hostname,
  proxied: false,
  ...extra,
})

const QUICK = { hiddenMs: 40, shownMs: 40, lookMs: 2, loadMs: 500, gapMs: 5, idleMs: 20 }
const PATIENCE = { timeout: 5_000, interval: 5 }

let running: FakeBrowser[] = []
async function boot(sites: Record<string, Site>, kept?: ReturnType<typeof fakeBrowser>["kept"], owlit = new FakeOwlit()) {
  vi.resetModules()
  const browser = fakeBrowser(sites, kept, owlit)
  browser.kept.local.token ??= "token"
  vi.stubGlobal("chrome", browser.chrome)
  vi.stubGlobal("fetch", browser.fetch)
  const ladder = await import("./ladder.ts")
  Object.assign(ladder.TAB_TIMES, QUICK)
  await import("./index.ts")
  running.push(browser)
  return browser
}

afterEach(() => {
  for (const browser of running) browser.owlit.close()
  running = []
  vi.unstubAllGlobals()
})

// What the background told owlit about this item
const answered = (b: FakeBrowser, id: string) => b.owlit.posted(`/work/${encodeURIComponent(id)}`)
const until = (b: FakeBrowser, id: string) => vi.waitFor(() => expect(answered(b, id)).toHaveLength(1), PATIENCE)

const ACM = "https://dl.acm.org/doi/10.1145/1"
const ACM_PDF = "https://dl.acm.org/doi/pdf/10.1145/1"

describe("the fetch ladder", () => {
  it("takes the PDF the background's own fetch gets, and opens no tab", async () => {
    const b = await boot({ "journals.sagepub.com": ({ url }) => (url.pathname.includes("/pdf/") ? { pdf: true } : article("Sage", "/doi/pdf/1")) })
    b.owlit.give({ work: [item("s1", "pub:sage", "https://journals.sagepub.com/doi/1", { pdfUrl: "https://journals.sagepub.com/doi/pdf/1", userStarted: true })] })
    await until(b, "s1#1")
    expect(answered(b, "s1#1")[0]).toMatchObject({ route: "/work/s1%231?host=journals.sagepub.com", pdf: true })
    expect(b.created).toEqual([])
  })

  it("meets a check, opens one hidden tab, waits for it to pass, and fetches the PDF from inside it", async () => {
    const acm = guarded((url) => (url.pathname.includes("/pdf/") ? { pdf: true } : article("ACM", ACM_PDF)), { passAfter: 3 })
    const b = await boot({ "dl.acm.org": acm.site })
    b.owlit.give({ work: [item("a1", "pub:acm", ACM, { pdfUrl: ACM_PDF, userStarted: true })] })
    await until(b, "a1#1")
    expect(answered(b, "a1#1")[0]).toMatchObject({ pdf: true })
    expect(b.created).toEqual([{ url: ACM, active: false }])
    expect(b.activated).toEqual([])
    // The worker was turned away; the PDF came from the tab
    expect(b.fetches.filter((f) => f.url === ACM_PDF).map((f) => f.from)).toEqual(["worker", "tab"])
    // Closed once the gate has nothing more
    await vi.waitFor(() => expect(b.tabs.size).toBe(0), PATIENCE)
  })

  it("brings the tab to the front once when its check passes only there, and reaches a PDF on another host by its signed redirect", async () => {
    const OUP = "https://academic.oup.com/journal/article/1"
    const OUP_PDF = "https://academic.oup.com/journal/article-pdf/1/paper.pdf"
    const SIGNED = "https://watermark.silverchair.com/paper.pdf?token=signed"
    const oup = guarded((url) => (url.pathname.includes("article-pdf") ? { status: 302, redirect: SIGNED } : article("OUP", OUP_PDF)), { front: true })
    const b = await boot({ "academic.oup.com": oup.site, "watermark.silverchair.com": () => ({ pdf: true }) })
    // OUP always turns the background's own fetch away: a tab from the start
    b.owlit.give({ work: [item("o1", "pub:oup", OUP, { inTab: true, userStarted: true })] })
    await until(b, "o1#1")
    expect(answered(b, "o1#1")[0]).toMatchObject({ route: "/work/o1%231?host=watermark.silverchair.com", pdf: true })
    expect(b.fetches.filter((f) => f.from === "worker" && f.url.includes("oup.com"))).toEqual([])
    expect(b.activated).toHaveLength(1)
    // The tab's fetch of the PDF link, followed (fails on the other origin), then not followed; the
    // signed address the redirect named, fetched by the background
    expect(b.fetches.filter((f) => f.url === OUP_PDF)).toEqual([
      { url: OUP_PDF, from: "tab", redirect: "follow" },
      { url: OUP_PDF, from: "tab", redirect: "manual" },
    ])
    expect(b.fetches.filter((f) => f.url === SIGNED).map((f) => f.from)).toEqual(["worker"])
  })

  it("through a library proxy that sends the browser on, fetches from the publisher's page the tab landed on", async () => {
    const TLINK = "https://tlink.lib.tsinghua.edu.cn/go?url=https://www.science.org/doi/10.1126/1"
    const science = guarded((url) => (url.pathname.includes("/pdf/") ? { pdf: true } : article("Science", "https://www.science.org/doi/pdf/10.1126/1")), { passAfter: 1 })
    const b = await boot({ "tlink.lib.tsinghua.edu.cn": ({ url }) => ({ status: 302, redirect: url.searchParams.get("url")! }), "www.science.org": science.site })
    b.owlit.give({ work: [item("t1", "pub:science", TLINK, { lane: "proxy:tlink.lib.tsinghua.edu.cn", host: "tlink.lib.tsinghua.edu.cn", proxied: true, userStarted: true })] })
    await until(b, "t1#1")
    expect(answered(b, "t1#1")[0]).toMatchObject({ route: "/work/t1%231?host=www.science.org", pdf: true })
    expect(b.fetches.filter((f) => f.url === "https://www.science.org/doi/pdf/10.1126/1").map((f) => f.from)).toEqual(["tab"])
  })

  it("leaves a check only a person passes to the user at once, as the wait", async () => {
    const SD = "https://www.sciencedirect.com/science/article/pii/1"
    const sd = guarded(() => article("SD", `${SD}/pdf`), { interactive: true })
    const b = await boot({ "www.sciencedirect.com": sd.site })
    b.owlit.give({ work: [item("e1", "pub:elsevier", SD, { userStarted: true })] })
    await until(b, "e1#1")
    expect(answered(b, "e1#1")[0].json).toMatchObject({ ended: "check", host: "www.sciencedirect.com" })
    expect(b.activated).toEqual([])
    await vi.waitFor(() => expect(b.tabs.size).toBe(0), PATIENCE)
  })

  it("opens no tab for a fetch the user didn't start", async () => {
    const acm = guarded(() => ({ pdf: true }))
    const b = await boot({ "dl.acm.org": acm.site })
    b.owlit.give({ work: [item("a1", "pub:acm", ACM, { pdfUrl: ACM_PDF, inTab: true })] })
    await until(b, "a1#1")
    expect(answered(b, "a1#1")[0].json).toMatchObject({ ended: "check", host: "dl.acm.org" })
    expect(b.created).toEqual([])
  })

  it("keeps the gate's tab for its next paper, and stops at the first check met again", async () => {
    const acm = guarded((url) => (url.pathname.includes("/pdf/") ? { pdf: true } : article("ACM", ACM_PDF)), { passAfter: 1, recheck: 1 })
    const b = await boot({ "dl.acm.org": acm.site })
    b.owlit.give({ work: [item("a1", "pub:acm", ACM, { pdfUrl: ACM_PDF, userStarted: true })] })
    await until(b, "a1#1")
    expect(answered(b, "a1#1")[0]).toMatchObject({ pdf: true })
    const [tab] = [...b.tabs.keys()]
    b.owlit.give({ work: [item("a2", "pub:acm", "https://dl.acm.org/doi/10.1145/2", { pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/2", userStarted: true })] })
    await until(b, "a2#1")
    // The same tab, asked again by the site: the wait's, and the tab closed
    expect(b.created).toHaveLength(1)
    expect(answered(b, "a2#1")[0].json).toMatchObject({ ended: "check" })
    expect(b.removed).toContain(tab)
  })
})

describe("waits", () => {
  const science: WorkWait = { id: "pub:science", kind: "check", at: "science.org", host: "science.org", watch: ["science.org"], papers: 2, proxied: false, allow: ["science.org"] }
  const sites = { "www.science.org": () => article("Science", "https://www.science.org/doi/pdf/1") }

  it("goes on when a page at a host the wait watches is past its check, naming the wait", async () => {
    const b = await boot(sites)
    b.owlit.give({ waits: [science] })
    await vi.waitFor(() => expect(b.kept.session.waits).toEqual([science]), PATIENCE)
    await b.openTab("https://www.science.org/doi/1")
    await vi.waitFor(() => expect(b.owlit.posted("/work/resume")).toEqual([{ route: "/work/resume", method: "POST", json: { wait: "pub:science" } }]), PATIENCE)
  })

  it("still knows its waits after the worker restarts", async () => {
    const first = await boot(sites)
    first.owlit.give({ waits: [science] })
    await vi.waitFor(() => expect(first.kept.session.waits).toEqual([science]), PATIENCE)
    first.owlit.close()
    const again = await boot(sites, first.kept)
    await again.openTab("https://www.science.org/doi/1")
    await vi.waitFor(() => expect(again.owlit.posted("/work/resume")).toMatchObject([{ json: { wait: "pub:science" } }]), PATIENCE)
  })
})

describe("an owlit of 0.2.x", () => {
  // Its shapes, as its server.ts takes and gives them: items with an opaque id and a host, waits named by
  // host alone, no endings said
  const old = () => new FakeOwlit({ legacy: true })
  const PSYCNET = "https://psycnet.apa.org/doiLanding?doi=10.1037/1"
  const shell = { "psycnet.apa.org": () => ({ html: "<html><head><title>APA PsycNet</title></head><body><app-root></app-root></body></html>" }) }

  it("hears a page the extension couldn't read as no copy, the word it knows", async () => {
    const b = await boot(shell, undefined, old())
    b.owlit.give({ work: [{ id: "7f3c", paperId: "p1", url: PSYCNET, host: "apa.org", proxied: false } as unknown as WorkItem] })
    await until(b, "7f3c")
    expect(answered(b, "7f3c").map((a) => a.json.ended)).toEqual(["no-copy"])
  })

  it("is told the host of the wait the user got through at, and keeps its other waits", async () => {
    const legacyWait = (host: string) => ({ kind: "check", host, papers: 1, proxied: false }) as unknown as WorkWait
    const b = await boot({ "www.science.org": () => article("Science", "https://www.science.org/doi/pdf/1") }, undefined, old())
    b.owlit.give({ waits: [legacyWait("science.org"), legacyWait("tandfonline.com")] })
    await vi.waitFor(() => expect(b.kept.session.waits).toHaveLength(2), PATIENCE)
    await b.openTab("https://www.science.org/doi/1")
    await vi.waitFor(() => expect(b.owlit.posted("/work/resume")).toEqual([{ route: "/work/resume", method: "POST", json: { host: "science.org" } }]), PATIENCE)
    await vi.waitFor(() => expect(b.kept.session.waits).toMatchObject([{ host: "tandfonline.com" }]), PATIENCE)
  })
})
