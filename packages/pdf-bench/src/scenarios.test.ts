import { afterEach, describe, expect, it, vi } from "vitest"
import { cloudflareCheck, FakeWeb, hang, landing, notFound, page, pdf, stall, tlink, ezproxy } from "../../core/src/extension/test/fake-web.ts"
import { startBench, type Bench, type BenchSetup, type Row, type Screen } from "./adapter.ts"
import { batchCountErrors, checkInvariants } from "./invariants.ts"
import { atypon, behindSso, checksWorker, elsevier, inBrowser, openAccess, psycnet, refusesWorker } from "./sites.ts"

// One test per real-world story of getting PDFs, each saying what the user would see: the Library's PDF
// block (its rows and counts), a paper's words, the waits. The bench's invariants run after every step.
// A story that fails on the code as it is, because of a real bug, is it.fails with the bug in one line.

const TLINK = "tlink.lib.tsinghua.edu.cn"

let bench: Bench | undefined
afterEach(async () => {
  await bench?.dispose()
  bench = undefined
  vi.restoreAllMocks()
})

const start = async (web: FakeWeb, setup: BenchSetup = {}) => {
  bench = await startBench(web, { check: checkInvariants, ...setup })
  return bench
}

// A row as the block shows it: its kind, its count, the site it names
const rowsOf = (screen: Screen) => [...(screen.block?.rows ?? []), ...(screen.block?.outside ?? [])].map((r: Row) => [r.kind, r.papers, ...(r.host ? [r.host] : [])])

const science = (n: number) => ({ doi: `10.1126/science.abc${1000 + n}`, title: `Science Paper Number ${n} On Particular Matters` })

describe("getting one paper's PDF", () => {
  it("takes an open access copy with owlit's own routes, without the browser", async () => {
    const web = new FakeWeb()
    openAccess(web, "10.1177/0001", "An Open Paper About Sleep")
    const b = await start(web)
    const id = b.addPaper("10.1177/0001", "An Open Paper About Sleep")
    const screen = await b.findPdf(id)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.block).toBeNull()
    expect(b.fetched()).toEqual([])
  })

  it("gets a publisher's PDF in the browser, at the address owlit knows", async () => {
    const web = new FakeWeb()
    atypon(web, "journals.sagepub.com", "10.1177/0002", "A Paywalled Paper About Memory")
    const b = await start(web)
    const id = b.addPaper("10.1177/0002", "A Paywalled Paper About Memory")
    const screen = await b.findPdf(id)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
  })

  it("follows a landing page to the PDF its tags name", async () => {
    const web = new FakeWeb()
    const doi = "10.25300/misq/2024/1234"
    web.paper(doi, "A Paper In A Journal owlit Has No Row For", { url: `https://misq.umn.edu/article/${doi}` })
    web.on(`misq.umn.edu/article/${doi}`, inBrowser(landing(doi, "A Paper In A Journal owlit Has No Row For", `https://misq.umn.edu/download/${doi}.pdf`)))
    web.on(`misq.umn.edu/download/${doi}.pdf`, inBrowser(pdf(doi)))
    const b = await start(web)
    const id = b.addPaper(doi, "A Paper In A Journal owlit Has No Row For")
    expect((await b.findPdf(id)).papers[id].hasPdf).toBe(true)
  })

  it("leaves a page only scripts read to the user, as a download by hand", async () => {
    const web = new FakeWeb()
    psycnet(web, "10.1037/xge0001", "A Paper Behind A Script Page")
    const b = await start(web)
    const id = b.addPaper("10.1037/xge0001", "A Paper Behind A Script Page")
    const screen = await b.findPdf(id)
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Needs you to download it", word: "Needs manual download" })
  })

  it("waits for the user past a firewall's block, and goes on once a page there loads on another network", async () => {
    const web = new FakeWeb()
    const { doi, title } = science(1)
    atypon(web, "www.science.org", doi, title, { blocked: true })
    web.block("www.science.org")
    const b = await start(web)
    const id = b.addPaper(doi, title)
    let screen = await b.findPdf(id)
    expect(screen.waits).toMatchObject([{ kind: "blocked", host: "science.org", papers: 1, what: "science.org blocks your browser · 1 paper" }])
    expect(screen.papers[id].title).toBe("science.org blocks your browser")
    await b.clickWait("blocked", "science.org")
    screen = await b.changeNetwork("www.science.org")
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
  })

  it("asks the user to let the extension read a site, and goes on once allowed", async () => {
    const web = new FakeWeb()
    const doi = "10.25300/misq/2024/77"
    web.paper(doi, "A Paper At A Site Not Yet Allowed", { url: `https://misq.umn.edu/article/${doi}` })
    web.on(`misq.umn.edu/article/${doi}`, inBrowser(landing(doi, "A Paper At A Site Not Yet Allowed", `https://misq.umn.edu/download/${doi}.pdf`)))
    web.on(`misq.umn.edu/download/${doi}.pdf`, inBrowser(pdf(doi)))
    const b = await start(web, { denied: ["umn.edu"] })
    const id = b.addPaper(doi, "A Paper At A Site Not Yet Allowed")
    let screen = await b.findPdf(id)
    expect(screen.waits).toMatchObject([{ kind: "permission", host: "umn.edu", papers: 1 }])
    screen = await b.clickWait("permission", "umn.edu")
    expect(screen.browser.allowAsked).toEqual(["umn.edu"])
    screen = await b.allow("umn.edu")
    expect(screen.papers[id].hasPdf).toBe(true)
  })

  it("takes the PDF the user drops on a paper that waits, and the wait goes", async () => {
    const web = new FakeWeb()
    const { doi, title } = science(2)
    atypon(web, "www.science.org", doi, title, { check: true })
    const b = await start(web)
    const id = b.addPaper(doi, title)
    expect((await b.findPdf(id)).waits).toMatchObject([{ kind: "check", host: "science.org", papers: 1 }])
    const screen = await b.dropPdf(id, doi)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
    expect(screen.block).toBeNull()
  })
})

describe("a check at a publisher", () => {
  // linkinghub.elsevier.com sends on to ScienceDirect, where the check stands; the queue's site is
  // elsevier.com, the DOI's registered site
  const ELS = { doi: "10.1016/j.chb.2024.108000", title: "Computers In Human Behavior Paper About Feeds" }

  it("at ScienceDirect, with no proxy: owlit goes on by itself once the user passes it", async () => {
    const web = new FakeWeb()
    elsevier(web, ELS.doi, ELS.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(ELS.doi, ELS.title)
    const screen = await b.findPdf(id)
    expect(screen.waits).toMatchObject([{ kind: "check", papers: 1 }])
    await b.clickWait(screen.waits[0].kind, screen.waits[0].host)
    expect((await b.passCheck("www.sciencedirect.com")).papers[id].hasPdf).toBe(true)
  })

  it("at ScienceDirect, with no proxy: I've verified it goes on", async () => {
    const web = new FakeWeb()
    elsevier(web, ELS.doi, ELS.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(ELS.doi, ELS.title)
    const { waits } = await b.findPdf(id)
    expect(waits).toMatchObject([{ id: "pub:elsevier", kind: "check", host: "sciencedirect.com" }])
    await b.clickWait(waits[0].kind, waits[0].host)
    await b.passCheck("www.sciencedirect.com")
    expect((await b.pressDone(waits[0].host)).papers[id].hasPdf).toBe(true)
  })

  it("through tlink: the wait names the publisher, and passing it there gets the PDFs", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    const papers = [science(3), science(4)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true, subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    let screen = await b.getPdfs()
    // Both are Science's, so both are under its check, though only one met it
    expect(rowsOf(screen)).toEqual([["check", 2, "science.org"]])
    expect(screen.block!.rows[0].words).toBe("Need you to verify you're human on science.org")
    await b.clickWait("check", "science.org")
    screen = await b.passCheck("www.science.org")
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true])
    expect(screen.block).toMatchObject({ total: 2, saved: 2, running: false })
  })

  // Counted by core from the papers, whatever host the fetch went through
  it("through tlink: the browser's card counts the PDFs that came after the user got through", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    const { doi, title } = science(5)
    atypon(web, "www.science.org", doi, title, { check: true, subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(doi, title)
    await b.getPdfs()
    await b.clickWait("check", "science.org")
    const screen = await b.passCheck("www.science.org")
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.browser.going).toEqual([])
  })
})

describe("a batch while a wait's try is out", () => {
  it("counts the paper out for its wait's one try once, under its wait", async () => {
    const web = new FakeWeb()
    const p = science(7)
    atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    let screen = await b.findPdf(id)
    expect(screen.waits).toMatchObject([{ id: "pub:science", papers: 1 }])
    // Get PDFs on it: the wait's one try goes now, and its answer is slow to come
    web.on(`www.science.org/doi/pdf/${p.doi}`, (visit) => (visit.client === "browser" ? hang(() => cloudflareCheck())(visit) : page("Access denied", "", 403)))
    await b.getPdfsNow([id])
    screen = await b.askOnce()
    expect(web.hanging()).toBe(1)
    expect(batchCountErrors(screen)).toEqual([])
    expect(rowsOf(screen)).toEqual([["check", 1, "science.org"]])
    web.release()
    screen = await b.step("the try's answer comes")
    expect(screen.waits).toMatchObject([{ id: "pub:science", papers: 1 }])
  })
})

describe("the library's proxy", () => {
  it("tlink signed out: one sign-in for every paper, then their PDFs", async () => {
    const web = tlink(new FakeWeb())
    const papers = [science(6), science(7), science(8)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    let screen = await b.getPdfs()
    expect(rowsOf(screen)).toEqual([["sign-in", 3, TLINK]])
    expect(screen.block!.rows[0].words).toBe("Need you to sign in to Tsinghua University")
    expect(screen.papers[ids[0]].title).toBe("Needs you to sign in to your library")
    await b.clickWait("sign-in", TLINK)
    screen = await b.signIn(TLINK)
    // The school's sign-in ends on a page that still looks like one: the user says they signed in
    if (screen.waits.length) screen = await b.pressDone(TLINK)
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true, true])
    expect(screen.block).toMatchObject({ total: 3, saved: 3, running: false, rows: [] })
  })

  it("tlink signed out, then a publisher's check: the line going on after the sign-in ends once its papers wait at the check", async () => {
    const web = tlink(new FakeWeb())
    const papers = [science(23), science(24)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true, subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    expect(rowsOf(await b.getPdfs())).toEqual([["sign-in", 2, TLINK]])
    await b.clickWait("sign-in", TLINK)
    let screen = await b.signIn(TLINK)
    if (screen.waits.some((w) => w.host === TLINK)) screen = await b.pressDone(TLINK)
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org", papers: 2 }])
    for (const id of ids) expect(screen.papers[id].title).toBe("Needs you to verify you're human on science.org")
    // Nothing goes on at tlink any more: the popup's line there has ended
    expect(screen.browser.going).toEqual([])
  })

  it("tlink, with a publisher the network can't reach: the other papers come, and that publisher's say when owlit tries again", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    const sage = { doi: "10.1177/0956797655", title: "A SAGE Paper Behind A Poisoned Name" }
    atypon(web, "journals.sagepub.com", sage.doi, sage.title, { subscription: true })
    const papers = [1, 2].map((n) => ({ doi: `10.2196/4400${n}`, title: `A JMIR Paper Number ${n} About Apps` }))
    for (const p of papers) atypon(web, "www.jmir.org", p.doi, p.title, { subscription: true })
    web.down("journals.sagepub.com")
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(sage.doi, sage.title)
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    let screen = await b.getPdfs()
    // SAGE's went first, and JMIR's had to go on without it
    expect(b.fetched()[0]).toBe(id)
    expect(ids.map((i) => screen.papers[i].hasPdf)).toEqual([true, true])
    expect(rowsOf(screen)).toEqual([["unreachable", 1, "journals.sagepub.com"]])
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, word: "Can't reach site" })
    expect(screen.papers[id].title).toMatch(/^Can't reach journals\.sagepub\.com right now · trying again at /)
    // Nothing else of the run is going: it ends with that row, and the paper is tried again by itself
    expect(screen.block).toMatchObject({ running: false, ended: true })
    await b.reach("journals.sagepub.com")
    screen = await b.sleep(2 * 60_000)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.block).toMatchObject({ total: 3, saved: 3, running: false, rows: [] })
  })

  it("tlink, Get PDFs on papers under publishers' checks: going until each one's try in the browser has ended", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    const papers = [
      { ...science(30), at: "www.science.org" },
      { doi: "10.1080/0000530", title: "A Taylor And Francis Paper Behind A Check", at: "www.tandfonline.com" },
    ]
    for (const p of papers) atypon(web, p.at, p.doi, p.title, { check: true, subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    expect(rowsOf(await b.getPdfs()).sort()).toEqual([
      ["check", 1, "science.org"],
      ["check", 1, "tandfonline.com"],
    ])
    // The user got past both checks in their browser, somewhere the extension didn't see, and asks again
    for (const p of papers) web.clear(p.at)
    let screen = await b.getPdfsNow(ids)
    // Each one's try goes in the browser, one at a time through the proxy: the batch is going, and says
    // it hasn't ended
    expect(screen.block).toMatchObject({ total: 2, saved: 0, running: true, ended: false })
    screen = await b.askOnce()
    expect(screen.block).toMatchObject({ total: 2, saved: 1, running: true, ended: false })
    screen = await b.step("the second try")
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true])
    expect(screen.block).toMatchObject({ total: 2, saved: 2, running: false, ended: true, rows: [] })
  })

  it("tlink's sign-in wait, a paper asked for meets a publisher's check: the check counts it, and the sign-in is over", async () => {
    const web = tlink(new FakeWeb())
    const checked = science(31)
    atypon(web, "www.science.org", checked.doi, checked.title, { check: true, subscription: true })
    const jmir = { doi: "10.2196/44031", title: "A JMIR Paper Under The Same Sign-In" }
    atypon(web, "www.jmir.org", jmir.doi, jmir.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(checked.doi, checked.title)
    const other = b.addPaper(jmir.doi, jmir.title)
    expect(rowsOf(await b.getPdfs())).toEqual([["sign-in", 2, TLINK]])
    // The user signed in somewhere the extension didn't see, and asks for one of the papers: its try gets
    // past the proxy and stops at Science's check
    web.signIn(TLINK)
    await b.call("library.fetchPdf", { id })
    const screen = await b.step("the asked-for paper's try")
    expect(screen.waits).toMatchObject([{ id: "pub:science", kind: "check", papers: 1 }])
    expect(screen.papers[id]).toMatchObject({ heldAt: "pub:science", title: "Needs you to verify you're human on science.org" })
    // The proxy let a reader through, so its sign-in holds no one
    expect(screen.papers[other].hasPdf).toBe(true)
  })

  it("EZproxy signed out: its sign-in, then the PDF at the rewritten host", async () => {
    const web = ezproxy(new FakeWeb())
    const { doi, title } = science(9)
    atypon(web, "www.science.org", doi, title, { subscription: true })
    const b = await start(web, { proxy: { link: `https://www-science-org.ezproxy.example.edu/doi/${doi}` } })
    const id = b.addPaper(doi, title)
    let screen = await b.findPdf(id)
    expect(screen.waits).toMatchObject([{ kind: "sign-in", papers: 1 }])
    await b.clickWait("sign-in", screen.waits[0].host)
    screen = await b.signIn("ezproxy.example.edu")
    if (screen.waits.length) screen = await b.pressDone(screen.waits[0].host)
    expect(screen.papers[id].hasPdf).toBe(true)
  })
})

describe("a paper the site keeps from this reader", () => {
  // Off campus: the paper's page names its PDF, and the PDF's address answers 403 with the article
  it("reads No access, with nothing left for the user to do at the site", async () => {
    const web = new FakeWeb()
    const paper = { doi: "10.1111/0000405", title: "A Paper Behind A Paywall" }
    const article = (status: number) => () => page(paper.title, `<h1>${paper.title}</h1><a href="/doi/pdf/${paper.doi}">PDF</a>`, status, `<meta name="citation_title" content="${paper.title}"><meta name="citation_doi" content="${paper.doi}">`)
    web.paper(paper.doi, paper.title, { url: `https://onlinelibrary.wiley.com/doi/${paper.doi}` })
    web.on(`onlinelibrary.wiley.com/doi/pdf`, article(403))
    web.on(`onlinelibrary.wiley.com/doi/pdfdirect`, article(403))
    web.on(`onlinelibrary.wiley.com/doi/`, article(200))
    const b = await start(web)
    const id = b.addPaper(paper.doi, paper.title)
    const screen = await b.getPdfs()
    expect(screen.block).toMatchObject({ total: 1, saved: 0, things: 0, running: false })
    expect(screen.papers[id].hasPdf).toBe(false)
    expect(rowsOf(screen)).toEqual([["none", 1]])
  })
})

describe("a firewall that tells the extension from a page", () => {
  it("a PDF's address that turns the background away is fetched in a tab, and the paper comes", async () => {
    const web = new FakeWeb()
    const p = { doi: "10.1111/0000406", title: "A Paper Only A Page Of The Site Gets" }
    refusesWorker(web, "onlinelibrary.wiley.com", p.doi, p.title)
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    const screen = await b.findPdf(id)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(web.log.filter((v) => v.url.includes("/doi/pdf/")).length).toBeGreaterThan(1)
  })
})

describe("a stalled publisher", () => {
  const stalled = { doi: "10.1145/0000701", title: "A Paper Whose PDF Never Answers In Its Tab" }
  const after = { doi: "10.1177/0000702", title: "A Paper Behind It In The Proxy's Line" }

  it("a fetch in a tab that nothing answers gives up, and the line behind it goes on", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    // The tab's fetch of the PDF never ends, whatever the page's own abort does
    refusesWorker(web, "dl.acm.org", stalled.doi, stalled.title)
    web.on(`dl.acm.org/doi/pdf/${stalled.doi}`, (visit) => (visit.from === "tab" ? stall(pdf(stalled.doi))(visit) : page(stalled.title, `<h1>${stalled.title}</h1>`, 403, `<meta name="citation_title" content="${stalled.title}">`)))
    atypon(web, "journals.sagepub.com", after.doi, after.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" }, times: { fetchMs: 150 } })
    const id = b.addPaper(stalled.doi, stalled.title)
    const next = b.addPaper(after.doi, after.title)
    const screen = await b.getPdfs()
    expect(screen.papers[next].hasPdf).toBe(true)
    expect(screen.papers[id].hasPdf).toBe(false)
    expect(screen.papers[id].word).toBe("Can't reach site")
  })
})

describe("a publisher's sign-in hop, off campus", () => {
  const els = { doi: "10.1016/j.chb.2024.108100", title: "A Paper Behind Elsevier's Institution Sign In" }
  const sage = { doi: "10.1177/0956797677", title: "A Paper Behind OpenAthens" }
  const science2 = { doi: "10.1126/science.abc4001", title: "A Paper Behind A Shibboleth Hop" }
  const direct = { doi: "10.2196/44099", title: "A JMIR Paper That Needs No Sign In" }
  const AUTH = "auth.elsevier.com/ShibAuth/institutionLogin?entityID=https%3A%2F%2Fidp.tsinghua.edu.cn"
  const ATHENS = "login.openathens.net/saml/2/sso/tsinghua.edu.cn/o/1/c/oafed"

  const campus = () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    return web
  }

  it("walks each hop in a tab, whichever kind it is, and the PDFs come", async () => {
    const web = campus()
    behindSso(web, "www.sciencedirect.com", els.doi, els.title, AUTH)
    behindSso(web, "journals.sagepub.com", sage.doi, sage.title, ATHENS)
    behindSso(web, "www.science.org", science2.doi, science2.title, "www.science.org/Shibboleth.sso/Login?entityID=https%3A%2F%2Fidp.tsinghua.edu.cn")
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = [els, sage, science2].map((p) => b.addPaper(p.doi, p.title))
    const screen = await b.getPdfs()
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true, true])
    expect(screen.waits).toEqual([])
  })

  it("a hop that doesn't go on waits under the paper's publisher, not the proxy, and opens the paper's own link", async () => {
    const web = campus()
    behindSso(web, "journals.sagepub.com", sage.doi, sage.title, ATHENS, { walks: false })
    atypon(web, "www.jmir.org", direct.doi, direct.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(sage.doi, sage.title)
    const other = b.addPaper(direct.doi, direct.title)
    const screen = await b.getPdfs()
    expect(screen.waits).toMatchObject([{ id: "pub:sage", kind: "check", papers: 1 }])
    expect(screen.waits[0].url).toContain(`${TLINK}/go?url=`)
    expect(screen.papers[id].heldAt).toBe("pub:sage")
    // The publisher's hold is its own: the proxy's other papers aren't under it
    expect(screen.papers[other].hasPdf).toBe(true)
  })

  it("a hop on the publisher's own sign-in host: the wait is named by the publisher, never by the hop", async () => {
    const web = campus()
    behindSso(web, "www.sciencedirect.com", els.doi, els.title, AUTH, { walks: false })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    b.addPaper(els.doi, els.title)
    expect((await b.getPdfs()).waits).toMatchObject([{ id: "pub:elsevier", kind: "check", host: "elsevier.com" }])
  })

  it("on a site the extension may not read: a tab still walks it", async () => {
    const web = campus()
    behindSso(web, "www.sciencedirect.com", els.doi, els.title, AUTH)
    const b = await start(web, { proxy: { preset: "tsinghua" }, denied: ["elsevier.com"] })
    const id = b.addPaper(els.doi, els.title)
    const screen = await b.getPdfs()
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
  })

  it("on a site the extension may not read, where the hop never goes on: the wait is the publisher's, not the proxy's", async () => {
    const web = campus()
    behindSso(web, "www.sciencedirect.com", els.doi, els.title, AUTH, { walks: false })
    atypon(web, "www.jmir.org", direct.doi, direct.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" }, denied: ["elsevier.com"] })
    const id = b.addPaper(els.doi, els.title)
    const other = b.addPaper(direct.doi, direct.title)
    const screen = await b.getPdfs()
    expect(screen.papers[id].heldAt).toBe("pub:elsevier")
    expect(screen.papers[other].hasPdf).toBe(true)
  })

  it("tlink's /gologin without a callback looks signed in and /go still asks: the wait says so, and the real sign-in ends it", async () => {
    const web = tlink(new FakeWeb(), TLINK, "id.tsinghua.edu.cn", { offCampus: true })
    const p = science(40)
    atypon(web, "www.science.org", p.doi, p.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(p.doi, p.title)
    expect(rowsOf(await b.getPdfs())).toEqual([["sign-in", 1, TLINK]])
    await b.openPage(`https://${TLINK}/gologin`)
    let screen = await b.pressDone(TLINK)
    expect(screen.waits).toMatchObject([{ kind: "sign-in", host: TLINK, papers: 1 }])
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Needs you to sign in to your library" })
    await b.clickWait("sign-in", TLINK)
    screen = await b.signIn(TLINK)
    if (screen.waits.length) screen = await b.pressDone(TLINK)
    expect(screen.papers[id].hasPdf).toBe(true)
  })
})

describe("a batch of papers (Get PDFs)", () => {
  // Ten papers as a real library has them: three the browser gets at once, two behind a check, two only
  // scripts read, one the publisher hasn't got, one paywalled, one at a site not yet allowed
  function mixed(web: FakeWeb) {
    const direct = [1, 2, 3].map((n) => ({ doi: `10.1177/09567976${n}`, title: `Direct Paper ${n} About Attention` }))
    for (const p of direct) atypon(web, "journals.sagepub.com", p.doi, p.title)
    const checked = [science(10), science(11)]
    for (const p of checked) atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const shells = [1, 2].map((n) => ({ doi: `10.1037/xge000${n}`, title: `Script Page Paper ${n}` }))
    for (const p of shells) psycnet(web, p.doi, p.title)
    const gone = { doi: "10.1080/0000404", title: "A Paper Whose Page Is Gone" }
    web.paper(gone.doi, gone.title, { url: `https://www.tandfonline.com/doi/full/${gone.doi}` })
    web.on(`www.tandfonline.com/doi/`, notFound())
    const paywalled = { doi: "10.1111/0000402", title: "A Paywalled Wiley Paper" }
    web.paper(paywalled.doi, paywalled.title, { url: `https://onlinelibrary.wiley.com/doi/${paywalled.doi}` })
    web.on(`onlinelibrary.wiley.com/doi/`, () => page(paywalled.title, `<h1>${paywalled.title}</h1><a href="/action/buy">Get access</a>`, 200, `<meta name="citation_title" content="${paywalled.title}">`))
    const unallowed = { doi: "10.25300/misq/2024/9", title: "A Paper At MISQ" }
    web.paper(unallowed.doi, unallowed.title, { url: `https://misq.umn.edu/article/${unallowed.doi}` })
    web.on(`misq.umn.edu/article/`, inBrowser(landing(unallowed.doi, unallowed.title, `https://misq.umn.edu/download/${unallowed.doi}.pdf`)))
    web.on(`misq.umn.edu/download/`, inBrowser(pdf(unallowed.doi)))
    return { direct, checked, shells, gone, paywalled, unallowed, all: [...direct, ...checked, ...shells, gone, paywalled, unallowed] }
  }

  it("of ten mixed papers ends as a summary of what needs the user, and fills in as they act", async () => {
    const web = new FakeWeb()
    const papers = mixed(web)
    const b = await start(web, { denied: ["umn.edu"] })
    const ids = papers.all.map((p) => b.addPaper(p.doi, p.title))
    let screen = await b.getPdfs()
    expect(screen.block).toMatchObject({ batch: true, total: 10, saved: 3, things: 2, running: false })
    expect(rowsOf(screen)).toEqual([
      ["check", 2, "science.org"],
      ["permission", 1, "umn.edu"],
      ["manual", 2],
      ["none", 2],
    ])
    await b.clickWait("check", "science.org")
    await b.passCheck("www.science.org")
    await b.clickWait("permission", "umn.edu")
    screen = await b.allow("umn.edu")
    expect(screen.block).toMatchObject({ total: 10, saved: 6, things: 0, running: false })
    expect(rowsOf(screen)).toEqual([
      ["manual", 2],
      ["none", 2],
    ])
    expect(ids.filter((id) => screen.papers[id].hasPdf)).toHaveLength(6)
    screen = await b.dismiss()
    expect(screen.block).toBeNull()
  })

  it("stopped while a check waits: the papers leave the queue, and the block goes", async () => {
    const web = new FakeWeb()
    const papers = [science(12), science(13)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    expect(rowsOf(await b.getPdfs())).toEqual([["check", 2, "science.org"]])
    const screen = await b.stop()
    expect(screen.block).toBeNull()
    expect(screen.waits).toEqual([])
    // Their cards no longer ask the user to verify anything
    for (const id of ids) expect(screen.papers[id]).toMatchObject({ hasPdf: false, state: "stopped" })
  })

  it("survives the window reloading: the batch is core's, and stays in view", async () => {
    const web = new FakeWeb()
    const papers = [science(14), science(15)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true })
    atypon(web, "journals.sagepub.com", "10.1177/0956797699", "Direct Paper About Habits")
    const b = await start(web)
    for (const p of papers) b.addPaper(p.doi, p.title)
    const direct = b.addPaper("10.1177/0956797699", "Direct Paper About Habits")
    expect((await b.getPdfs()).block).toMatchObject({ batch: true, total: 3, saved: 1 })
    let screen = await b.reloadRenderer()
    expect(screen.block).toMatchObject({ batch: true, total: 3, saved: 1 })
    expect(rowsOf(screen)).toEqual([["check", 2, "science.org"]])
    expect(screen.papers[direct].hasPdf).toBe(true)
    await b.clickWait("check", "science.org")
    screen = await b.passCheck("www.science.org")
    expect(Object.values(screen.papers).every((p) => p.hasPdf)).toBe(true)
  })
})

describe("Stop", () => {
  it("while a fetch is held: whatever comes back, the paper stays stopped and no wait comes up", async () => {
    const web = new FakeWeb()
    const p = science(50)
    atypon(web, "www.science.org", p.doi, p.title)
    web.on(`www.science.org/doi/pdf/${p.doi}`, (visit) => (visit.client === "browser" ? hang(() => cloudflareCheck())(visit) : page("Access denied", "", 403)))
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    await b.getPdfs()
    expect(web.hanging()).toBe(1)
    let screen = await b.stop()
    web.release()
    screen = await b.step("the held answer comes")
    expect(screen.waits).toEqual([])
    expect(screen.block).toBeNull()
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, state: "stopped" })
    screen = await b.restartCore()
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, state: "stopped" })
    expect(b.fetched()).toEqual([id])
  })

  it("with its block left up: a paper out at Stop is counted stopped once its answer comes", async () => {
    const web = new FakeWeb()
    const p = science(52)
    atypon(web, "www.science.org", p.doi, p.title)
    web.on(`www.science.org/doi/pdf/${p.doi}`, (visit) => (visit.client === "browser" ? hang(() => cloudflareCheck())(visit) : page("Access denied", "", 403)))
    const b = await start(web)
    b.addPaper(p.doi, p.title)
    await b.getPdfs()
    await b.stopKeepingBlock()
    web.release()
    const screen = await b.step("the held answer comes")
    expect(rowsOf(screen)).toEqual([["stopped", 1]])
    expect(screen.block).toMatchObject({ total: 1, running: false })
  })

  it("while a fetch is held, and the worker restarts: the stopped paper isn't handed out again", async () => {
    const web = new FakeWeb()
    const p = science(51)
    atypon(web, "www.science.org", p.doi, p.title)
    web.on(`www.science.org/doi/pdf/${p.doi}`, (visit) => (visit.client === "browser" ? hang(pdf(p.doi))(visit) : page("Access denied", "", 403)))
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    await b.getPdfs()
    await b.stop()
    const screen = await b.restartWorker()
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, state: "stopped" })
    expect(b.fetched()).toEqual([id])
  })
})

describe("a gate's kept tab", () => {
  const papers = [1, 2].map((n) => ({ doi: `10.1145/000080${n}`, title: `A Paper Only A Tab Of The Site Gets ${n}` }))

  it("clicked by the user between two papers: it is theirs, not loaded with the next paper nor closed", async () => {
    const web = new FakeWeb()
    for (const p of papers) refusesWorker(web, "dl.acm.org", p.doi, p.title)
    const b = await start(web, { times: { idleMs: 60_000 } })
    const first = b.addPaper(papers[0].doi, papers[0].title)
    let screen = await b.findPdf(first)
    expect(screen.papers[first].hasPdf).toBe(true)
    expect(screen.browser.tabs).toEqual([`https://dl.acm.org/doi/${papers[0].doi}`])
    // In front only for a moment: the click is what says it is theirs
    await b.clickTabAndLeave("dl.acm.org", "https://www.example.org/")
    const second = b.addPaper(papers[1].doi, papers[1].title)
    screen = await b.findPdf(second)
    expect(screen.papers[second].hasPdf).toBe(true)
    // Theirs stayed on the first paper's page; the second was fetched in a tab of the extension's
    expect(screen.browser.tabs).toContain(`https://dl.acm.org/doi/${papers[0].doi}`)
    // Long after, the extension's own is closed as idle, and theirs isn't
    screen = await b.sleep(2 * 60_000)
    expect(screen.browser.tabs.filter((tab) => tab.includes("acm.org"))).toEqual([`https://dl.acm.org/doi/${papers[0].doi}`])
  })
})

describe("a wait", () => {
  it("the user says they got through: what goes on is theirs, so a tab may open for it", async () => {
    const web = new FakeWeb()
    const p = { doi: "10.1145/0000901", title: "A Paper Behind A Check Only A Tab Passes" }
    checksWorker(web, "dl.acm.org", p.doi, p.title)
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    // Handed over by owlit's own look: nothing the user started, so no tab opens and a wait comes up
    let screen = await b.restartCore()
    expect(screen.waits).toMatchObject([{ id: "pub:acm", kind: "check", papers: 1 }])
    expect(screen.browser.tabs).toEqual([])
    screen = await b.pressDone("dl.acm.org")
    expect(screen.papers[id].hasPdf).toBe(true)
  })

  it("the user got through where the extension didn't see: its one try, a quarter of an hour on, gets the paper", async () => {
    const web = new FakeWeb()
    const p = science(80)
    atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    expect((await b.findPdf(id)).waits).toMatchObject([{ id: "pub:science", kind: "check" }])
    web.clear("www.science.org")
    const screen = await b.sleep(16 * 60_000)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
  })

  it("keeps what the user did across a crash: its page opened, from the notes on disk", async () => {
    const web = new FakeWeb()
    const p = science(81)
    atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    await b.findPdf(id)
    expect((await b.clickWait("check", "science.org")).waits).toMatchObject([{ opened: true }])
    const screen = await b.crashCore()
    expect(screen.waits).toMatchObject([{ id: "pub:science", opened: true }])
  })
})

describe("the worker", () => {
  it("restarted mid-fetch: the fetch is lost with it, the paper goes out again and comes", async () => {
    const web = new FakeWeb()
    const p = { doi: "10.1177/0956797691", title: "A Paper Fetched Across A Worker Restart" }
    atypon(web, "journals.sagepub.com", p.doi, p.title)
    let visits = 0
    web.on(`journals.sagepub.com/doi/pdf/${p.doi}`, inBrowser((visit) => (visits++ === 0 ? hang(pdf(p.doi))(visit) : pdf(p.doi)(visit))))
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    await b.findPdf(id)
    expect(web.hanging()).toBe(1)
    const screen = await b.restartWorker()
    expect(web.hanging()).toBe(0)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(b.fetched()).toEqual([id, id])
  })

  it("restarted at a wait: it still watches the tab, and passing the check there goes on", async () => {
    const web = new FakeWeb()
    const p = science(60)
    atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const id = b.addPaper(p.doi, p.title)
    await b.findPdf(id)
    await b.clickWait("check", "science.org")
    await b.restartWorker()
    const screen = await b.passCheck("www.science.org")
    expect(screen.papers[id].hasPdf).toBe(true)
  })
})

describe("a workspace switch", () => {
  it("mid hand-over: the old workspace's papers don't reach the new one's queues, and its wait stays", async () => {
    const web = new FakeWeb()
    const here = science(70)
    atypon(web, "www.science.org", here.doi, here.title, { check: true })
    const old = { doi: "10.1177/0956797681", title: "A Paper In The Workspace Left Behind" }
    atypon(web, "journals.sagepub.com", old.doi, old.title)
    const b = await start(web)
    await b.openWorkspace("other")
    const there = b.addPaper(here.doi, here.title)
    await b.findPdf(there)
    await b.openWorkspace("main")
    const id = b.addPaper(old.doi, old.title)
    // Core looks the paper's DOI up before it hands it over, and that answer is slow
    web.on((url) => url.hostname === "doi.org" && decodeURIComponent(url.pathname) === `/api/handles/${old.doi}`, (visit) => hang(() => new Response(JSON.stringify({ values: [{ type: "URL", data: { value: `https://journals.sagepub.com/doi/${old.doi}` } }] }), { headers: { "content-type": "application/json" } }))(visit))
    await b.call("library.fetchPdfs", { ids: [id] })
    await vi.waitFor(() => expect(web.hanging()).toBe(1))
    let screen = await b.openWorkspace("other")
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org", papers: 1 }])
    web.release()
    screen = await b.step("the old workspace's look comes back")
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org", papers: 1 }])
    expect(screen.papers[there].heldAt).toBe("pub:science")
    expect(b.fetched()).not.toContain(id)
  })
})

describe("owlit and the machine", () => {
  it("a PDF dropped while the workspace opens: the other papers in line stay with the browser", async () => {
    const web = new FakeWeb()
    const papers = [1, 2].map((n) => ({ doi: `10.1177/095679767${n}`, title: `A Paper In Line Across A Restart ${n}` }))
    for (const p of papers) atypon(web, "journals.sagepub.com", p.doi, p.title)
    // Only a browser gets these, and it is closed: they stay in line, in pdf-work.json alone
    const b = await start(web)
    const [dropped, kept] = papers.map((p) => b.addPaper(p.doi, p.title))
    await b.hold()
    await b.getPdfsNow([dropped, kept])
    await b.closeBrowser()
    const screen = await b.restartCore({ whileOpening: () => b.attachPdf(dropped, papers[0].doi) })
    expect(screen.papers[dropped].hasPdf).toBe(true)
    expect(screen.papers[kept]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open" })
    expect(screen.inLine).toBe(1)
  })

  it("restarted after the user said they got through with the browser closed: the papers say they wait for it", async () => {
    const web = tlink(new FakeWeb())
    const papers = [science(90), science(91)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    await b.getPdfs()
    await b.closeBrowser()
    await b.restartCore()
    await b.pressDone(TLINK)
    const screen = await b.restartCore()
    expect(screen.waits).toEqual([])
    for (const id of ids) expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open" })
  })

  it("restarted after a try got past the proxy's sign-in: the sign-in isn't asked for again", async () => {
    const web = tlink(new FakeWeb())
    const checked = science(92)
    const next = { doi: "10.2196/44092", title: "A JMIR Paper Behind The Same Sign-In" }
    atypon(web, "www.science.org", checked.doi, checked.title, { check: true, subscription: true })
    atypon(web, "www.jmir.org", next.doi, next.title, { subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const id = b.addPaper(checked.doi, checked.title)
    const other = b.addPaper(next.doi, next.title)
    // The other paper's try met the sign-in; handed over again, it is no longer one the user asked for
    await b.getPdfs([other])
    await b.restartCore()
    web.signIn(TLINK)
    await b.hold()
    await b.call("library.fetchPdf", { id })
    await b.askOnce()
    await b.closeBrowser()
    const screen = await b.restartCore()
    expect(screen.waits).toMatchObject([{ id: "pub:science", kind: "check", papers: 1 }])
    expect(screen.papers[other]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open" })
  })

  it("restarted while a check waits: the wait is back at once, and passing it gets the PDF", async () => {
    const web = new FakeWeb()
    const { doi, title } = science(16)
    atypon(web, "www.science.org", doi, title, { check: true })
    const b = await start(web)
    const id = b.addPaper(doi, title)
    await b.findPdf(id)
    let screen = await b.restartCore()
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org", papers: 1 }])
    expect(screen.papers[id].title).toBe("Needs you to verify you're human on science.org")
    await b.clickWait("check", "science.org")
    screen = await b.passCheck("www.science.org")
    expect(screen.papers[id].hasPdf).toBe(true)
  })

  it("a workspace switch mid-batch: back in it, every paper of the batch is got once the user acts", async () => {
    const web = tlink(new FakeWeb())
    web.signIn(TLINK)
    const papers = [science(17), science(18), science(19)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true, subscription: true })
    const b = await start(web, { proxy: { preset: "tsinghua" } })
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    expect(rowsOf(await b.getPdfs())).toEqual([["check", 3, "science.org"]])
    expect((await b.openWorkspace("other")).waits).toEqual([])
    let screen = await b.openWorkspace("main")
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org" }])
    await b.clickWait("check", "science.org")
    screen = await b.passCheck("www.science.org")
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true, true])
  })

  it("the browser closed mid-batch: its papers say they wait for it, and go on once it opens", async () => {
    const web = new FakeWeb()
    const papers = [1, 2].map((n) => ({ doi: `10.1177/095679766${n}`, title: `A Paper Fetched Across A Quit ${n}` }))
    for (const p of papers) atypon(web, "journals.sagepub.com", p.doi, p.title)
    // The first PDF doesn't come until the browser is back; the second waits its turn behind it
    let visits = 0
    web.on(`journals.sagepub.com/doi/pdf/${papers[0].doi}`, (visit) => (visit.client === "browser" && visits++ === 0 ? hang(pdf(papers[0].doi))(visit) : pdf(papers[0].doi)(visit)))
    const b = await start(web)
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    await b.getPdfs()
    let screen = await b.closeBrowser()
    for (const id of ids) expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open", word: "Waiting for Chrome" })
    expect(rowsOf(screen)).toEqual([["closed", 2]])
    expect(screen.block).toMatchObject({ running: false })
    web.release()
    screen = await b.openBrowser()
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true])
    expect(screen.block).toMatchObject({ total: 2, saved: 2, rows: [] })
  })

  it("restarted while papers wait behind a check: every one of them is under it at once, not only the one that met it", async () => {
    const web = new FakeWeb()
    const papers = [science(20), science(21), science(22)]
    for (const p of papers) atypon(web, "www.science.org", p.doi, p.title, { check: true })
    const b = await start(web)
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    expect(rowsOf(await b.getPdfs())).toEqual([["check", 3, "science.org"]])
    // The browser stays closed: nothing asks for work, so only what owlit kept says where they are
    await b.closeBrowser()
    const screen = await b.restartCore()
    expect(screen.waits).toMatchObject([{ kind: "check", host: "science.org", papers: 3 }])
    for (const id of ids) expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Needs you to verify you're human on science.org" })
  })

  it("restarted with the browser closed mid-batch: the papers it had say they wait for it, and go on once it opens", async () => {
    const web = new FakeWeb()
    const papers = [3, 4].map((n) => ({ doi: `10.1177/095679766${n}`, title: `A Paper Fetched Across A Restart ${n}` }))
    for (const p of papers) atypon(web, "journals.sagepub.com", p.doi, p.title)
    // The first PDF doesn't come while the browser is closed; owlit's own look after the restart is
    // turned away, as from any reader without the user's access
    let visits = 0
    web.on(`journals.sagepub.com/doi/pdf/${papers[0].doi}`, inBrowser((visit) => (visits++ === 0 ? hang(pdf(papers[0].doi))(visit) : pdf(papers[0].doi)(visit))))
    const b = await start(web)
    const ids = papers.map((p) => b.addPaper(p.doi, p.title))
    await b.getPdfs()
    await b.closeBrowser()
    let screen = await b.restartCore()
    for (const id of ids) expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open", word: "Waiting for Chrome" })
    web.release()
    screen = await b.openBrowser()
    expect(ids.map((id) => screen.papers[id].hasPdf)).toEqual([true, true])
  })

  it("a paper added while the browser is closed: owlit's own look misses, and it waits for the browser, then comes", async () => {
    const web = new FakeWeb()
    const doi = "10.1177/0956797643"
    const title = "A Paper Added While The Browser Was Closed"
    atypon(web, "journals.sagepub.com", doi, title)
    // Only the user's browser gets it
    web.on(`journals.sagepub.com/doi/pdf/${doi}`, inBrowser(pdf(doi)))
    const b = await start(web)
    await b.closeBrowser()
    const id = b.addPaper(doi, title)
    let screen = await b.findPdf(id)
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Waiting for Chrome to open", word: "Waiting for Chrome" })
    screen = await b.openBrowser()
    expect(screen.papers[id].hasPdf).toBe(true)
  })

  it("asleep mid-fetch: the fetch is asked for again on waking, and the first one's PDF, coming late, is kept", async () => {
    const web = new FakeWeb()
    const doi = "10.1177/0956797642"
    const title = "A Paper Fetched Across A Sleep"
    atypon(web, "journals.sagepub.com", doi, title)
    // The first fetch's PDF doesn't come until the machine wakes; by then the site turns the browser away
    let visits = 0
    web.on(`journals.sagepub.com/doi/pdf/${doi}`, (visit) => (visit.client === "browser" && visits++ === 0 ? hang(pdf(doi))(visit) : page("Access denied", "", 403)))
    const b = await start(web)
    const id = b.addPaper(doi, title)
    let screen = await b.findPdf(id)
    expect(web.hanging()).toBe(1)
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Finding a PDF…" })
    // Away longer than core counts the extension connected: on waking the paper is handed out again,
    // and that fetch finds no copy
    screen = await b.sleep(6 * 60_000)
    expect(b.fetched()).toEqual([id, id])
    expect(screen.papers[id]).toMatchObject({ hasPdf: false, title: "Needs you to download it" })
    web.release()
    screen = await b.step("the first answer comes")
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.waits).toEqual([])
  })
})
