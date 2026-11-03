import { afterEach, describe, expect, it, vi } from "vitest"
import { FakeWeb, hang, landing, notFound, page, pdf, tlink, ezproxy } from "../../core/src/extension/test/fake-web.ts"
import { startBench, type Bench, type BenchSetup, type Row, type Screen } from "./adapter.ts"
import { checkInvariants } from "./invariants.ts"
import { atypon, elsevier, inBrowser, openAccess, psycnet } from "./sites.ts"

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
    expect(screen.block).toMatchObject({ running: true })
    await b.reach("journals.sagepub.com")
    screen = await b.sleep(2 * 60_000)
    expect(screen.papers[id].hasPdf).toBe(true)
    expect(screen.block).toMatchObject({ total: 3, saved: 3, running: false, rows: [] })
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

describe("owlit and the machine", () => {
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
