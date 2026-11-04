import fc from "fast-check"
import { expect, vi } from "vitest"
import { FakeWeb, tlink } from "../../core/src/extension/test/fake-web.ts"
import { startBench, type Bench, type Screen } from "./adapter.ts"
import { checkInvariants, livenessErrors, watchErrors } from "./invariants.ts"
import { atypon, behindSso, psycnet, refusesWorker } from "./sites.ts"

// Random sequences of what a user and their machine do, on one small library, against a model of what
// should become of each paper. After every event the screen must agree with itself (invariants) and with
// the model (expectationErrors). Then the browser closes and owlit restarts from what it kept: the same
// screen. Then the user does everything still asked of them, and nothing may be left that won't move
// (livenessErrors), with each paper as the model says. A failing sequence is shrunk by fast-check to the
// shortest that still breaks one, and printed with the seed to replay it. The suite runs one fixed seed,
// so it is the same sequences every time; PDF_BENCH_SEED, PDF_BENCH_RUNS and PDF_BENCH_EVENTS explore
// others, and PDF_BENCH_NO_SHRINK stops at the first failure.

const TLINK = "tlink.lib.tsinghua.edu.cn"
const SAGE = "journals.sagepub.com"
const SCIENCE = "www.science.org"
const TANDF = "www.tandfonline.com"
const JMIR = "www.jmir.org"
const SCIENCE_DIRECT = "www.sciencedirect.com"
const AUTH = "auth.elsevier.com/ShibAuth/institutionLogin?entityID=https%3A%2F%2Fidp.tsinghua.edu.cn"

type Kind = "direct" | "check" | "blocked" | "manual" | "tab" | "hop" | "allow" | "flaky"

const PAPERS: { doi: string; title: string; kind: Kind; host?: string }[] = [
  { doi: "10.1177/0956797601", title: "Direct Paper About Attention", kind: "direct", host: SAGE },
  { doi: "10.1126/science.abc2001", title: "Science Paper Behind A Check One", kind: "check", host: SCIENCE },
  { doi: "10.1126/science.abc2002", title: "Science Paper Behind A Check Two", kind: "check", host: SCIENCE },
  { doi: "10.1080/0000501", title: "Paper Behind A Firewall Block", kind: "blocked", host: TANDF },
  { doi: "10.1037/xge0501", title: "Script Page Paper", kind: "manual" },
  { doi: "10.1111/0000501", title: "Paper Only A Page Of The Site Gets", kind: "tab" },
  { doi: "10.1016/j.chb.2024.100501", title: "Paper Behind An Institution Sign In", kind: "hop" },
  { doi: "10.25300/misq/2024/501", title: "Paper At A Site Not Yet Allowed", kind: "allow" },
  { doi: "10.2196/44501", title: "Paper At A Host That Comes And Goes", kind: "flaky", host: JMIR },
]

function world(proxy: boolean) {
  const web = new FakeWeb()
  if (proxy) tlink(web)
  const subscription = proxy ? { subscription: true } : {}
  for (const p of PAPERS) {
    if (p.kind === "manual") psycnet(web, p.doi, p.title)
    else if (p.kind === "tab") refusesWorker(web, "onlinelibrary.wiley.com", p.doi, p.title)
    else if (p.kind === "hop") behindSso(web, SCIENCE_DIRECT, p.doi, p.title, AUTH)
    else if (p.kind === "allow") atypon(web, "misq.umn.edu", p.doi, p.title, subscription)
    else atypon(web, p.host!, p.doi, p.title, { ...subscription, ...(p.kind === "check" ? { check: true } : {}), ...(p.kind === "blocked" ? { blocked: true } : {}) })
  }
  web.block(TANDF)
  return web
}

// What the model holds of each paper, by what the user did
interface Want {
  // The user asked for it and hasn't stopped it since
  asked: boolean
  // Stopped while it was with the extension
  stopped: boolean
  // The user dropped its PDF on it
  dropped: boolean
}

// What must be true of the papers at any rest, whatever else is going on
function expectationErrors(screen: Screen, ids: string[], wants: Want[]): string[] {
  const errors: string[] = []
  ids.forEach((id, i) => {
    const p = screen.papers[id]
    // Another workspace is open
    if (!p) return
    const want = wants[i]
    const name = `${id} (${PAPERS[i].kind})`
    if (want.dropped && !p.hasPdf) errors.push(`${name}: the user dropped its PDF, and it has none`)
    // Nothing fetches what no one asked for: owlit hands over by itself only what it looked at (looksAtAll)
    if (!want.asked && !want.dropped && !want.stopped && (p.hasPdf || p.heldAt || p.inLine)) errors.push(`${name}: no one asked for it, and it reads ${p.hasPdf ? "saved" : `"${p.title}"`}`)
    // A stopped paper stays stopped until asked for again; only a PDF already on its way outlives it
    if (want.stopped && !p.hasPdf && p.state !== "stopped") errors.push(`${name}: the user stopped it, and it reads "${p.title}"`)
    if (want.stopped && (p.heldAt || p.inLine)) errors.push(`${name}: the user stopped it, and it is still ${p.heldAt ? `under ${p.heldAt}` : "in line"}`)
    if (PAPERS[i].kind === "manual" && p.hasPdf && !want.dropped) errors.push(`${name}: only the user can get it, and it reads saved`)
  })
  // A wait is at the gate that can stop a fetch: the proxy's sign-in is the proxy's, and in this library
  // no publisher asks for one; a check or a block is a publisher's
  for (const w of screen.waits) {
    if (w.kind === "sign-in" && !w.id.startsWith("proxy:")) errors.push(`the sign-in wait ${w.id} isn't the proxy's`)
    if ((w.kind === "check" || w.kind === "blocked") && w.id.startsWith("proxy:")) errors.push(`the ${w.kind} wait ${w.id} is the proxy's`)
  }
  return errors
}

// Everything but the clock's words: the same screen says "trying again at 4:02 PM" a minute apart
const kept = (screen: Screen) => ({
  waits: screen.waits.map(({ id, kind, host, papers, opened, retried, askedFor }) => ({ id, kind, host, papers, opened, retried, askedFor })).sort((a, b) => a.id.localeCompare(b.id)),
  papers: Object.entries(screen.papers).map(([id, p]) => ({ id, hasPdf: p.hasPdf, state: p.state, heldAt: p.heldAt, inLine: !!p.inLine, title: p.title.replace(/\d+:\d+ [AP]M/, "…") })),
  block: screen.block && { batch: screen.block.batch, total: screen.block.total, saved: screen.block.saved, rows: screen.block.rows.map((r) => [r.kind, r.papers, r.wait ?? r.host].join(" ")).sort() },
})

// owlit opening a workspace looks at every paper without a PDF, and what its routes miss goes to the
// extension by itself: from then on each is as good as asked for, but one the user stopped
const looksAtAll = (wants: Want[]) => {
  for (const want of wants) if (!want.stopped && !want.dropped) want.asked = true
}

type Run = { b: Bench; web: FakeWeb; ids: string[]; wants: Want[]; last: Screen }
type Event = { name: string; run: (r: Run) => Promise<Screen> }
const event = (name: string, run: Event["run"]): Event => ({ name, run })
const paper = fc.integer({ min: 0, max: PAPERS.length - 1 })

function noteAsked({ b, ids, wants }: Run) {
  for (const id of b.asked) Object.assign(wants[ids.indexOf(id)], { asked: true, stopped: false })
  b.asked = []
}

// Stop on the block: what was still with the extension is stopped; nothing else of the run changes
async function stop(r: Run) {
  const run = r.last.block?.batch ? r.last.block.ids : []
  const held = run.filter((id) => r.last.papers[id] && !r.last.papers[id].hasPdf && (r.last.papers[id].heldAt || r.last.papers[id].inLine))
  // Marked first: the step after Stop checks them
  for (const id of held) Object.assign(r.wants[r.ids.indexOf(id)], { asked: false, stopped: true })
  return r.b.stop()
}

const getPdfs = async (r: Run) => {
  await r.b.getPdfsAsked()
  noteAsked(r)
  return r.b.step("Get PDFs")
}

// A step of the user's: what it says, with the model told before the checks run
const events = fc.oneof(
  { weight: 3, arbitrary: fc.constant(event("Get PDFs", getPdfs)) },
  { weight: 2, arbitrary: paper.map((i) => event(`Find PDF ${i}`, async (r) => (await r.b.findPdfAsked(r.ids[i]), noteAsked(r), r.b.step(`find ${i}`)))) },
  fc.constant(event("click the first wait", ({ b, last }) => (last.waits[0] ? b.clickWait(last.waits[0].kind, last.waits[0].host) : b.step("nothing to click")))),
  fc.constant(event("press done on the first wait", ({ b, last }) => (last.waits[0] ? b.pressDone(last.waits[0].host) : b.step("nothing to press")))),
  fc.constant(event("pass the check at science.org", ({ b }) => b.passCheck(SCIENCE))),
  fc.constant(event("sign in at tlink", ({ b }) => b.signIn(TLINK))),
  fc.constant(event("another network for tandfonline", ({ b }) => b.changeNetwork(TANDF))),
  fc.constant(event("allow umn.edu", ({ b }) => b.allow("umn.edu"))),
  fc.constant(event("the host comes and goes", async ({ b, web }) => (web.down(JMIR), b.step("the host went")))),
  fc.constant(event("the host is back", ({ b }) => b.reach(JMIR))),
  fc.constant(event("Stop", stop)),
  fc.constant(event("Get PDFs, Stop while a fetch is held", async (r) => {
    r.web.holdNext(SAGE)
    r.last = await getPdfs(r)
    r.last = await stop(r)
    r.web.release()
    return r.b.step("the held answer comes")
  })),
  fc.constant(event("Dismiss", ({ b }) => b.dismiss())),
  paper.map((i) => event(`drop the PDF of ${i}`, async (r) => {
    if (r.last.papers[r.ids[i]]?.hasPdf) return r.b.step("already has it")
    Object.assign(r.wants[i], { dropped: true, stopped: false })
    return r.b.dropPdf(r.ids[i], PAPERS[i].doi)
  })),
  fc.constant(event("restart owlit", ({ b, wants }) => (looksAtAll(wants), b.restartCore()))),
  fc.constant(event("reload the window", ({ b }) => b.reloadRenderer())),
  fc.constant(event("the worker restarts", ({ b }) => b.restartWorker())),
  fc.constant(event("the worker restarts with a fetch out", async (r) => {
    r.web.holdNext(SAGE)
    r.last = await getPdfs(r)
    return r.b.restartWorker()
  })),
  fc.constant(event("close the browser", ({ b }) => b.closeBrowser())),
  fc.constant(event("open the browser", ({ b }) => b.openBrowser())),
  fc.constant(event("close the browser right after Get PDFs", async (r) => {
    if (r.b.browserClosed) return r.b.step("the browser is closed already")
    await r.b.getPdfsNow(Object.keys(r.last.papers).filter((id) => { const p = r.last.papers[id]; return !p.hasPdf && !p.heldAt && !p.inLine && p.state !== "manual" && p.state !== "skipped" }))
    noteAsked(r)
    return r.b.closeBrowser()
  })),
  fc.constant(event("sleep 20 minutes", ({ b }) => b.sleep(20 * 60_000))),
  fc.constant(event("open another workspace and come back", async ({ b, wants }) => (looksAtAll(wants), await b.openWorkspace("other"), b.openWorkspace("main")))),
)

// The user acts on every wait the window shows, as its row says, until none is left, with time for what
// backs off; then Look again on anything asked for that has nothing to show
async function doEverything(r: Run) {
  const { b, web } = r
  web.release()
  web.up(JMIR)
  r.last = await b.openBrowser()
  const seen: string[] = []
  for (let round = 0; round < 12; round++) {
    for (const wait of r.last.waits) {
      await b.clickWait(wait.kind, wait.host)
      if (wait.kind === "permission") await b.allow("umn.edu")
      else if (wait.kind === "blocked") await b.changeNetwork(TANDF)
      else if (wait.kind === "sign-in") await b.signIn(TLINK)
      else await b.passCheck(SCIENCE)
      const landed = await fetchedTo(web, wait.url)
      seen.push(...watchErrors(wait, landed))
    }
    r.last = await b.step("the user acted")
    // A sign-in can end on a page that still looks like one: the row's button says the user is done.
    // Anything else ends by the extension seeing the user past it.
    for (const wait of r.last.waits) if (wait.kind === "sign-in") r.last = await b.pressDone(wait.host)
    r.last = await b.sleep(20 * 60_000)
    if (!r.last.waits.length && !r.last.queued) break
  }
  expect(seen).toEqual([])
  expect(livenessErrors(r.last)).toEqual([])
  for (const [i, id] of r.ids.entries()) {
    const p = r.last.papers[id]
    if (r.wants[i].asked && !p.hasPdf && PAPERS[i].kind !== "manual") {
      await b.findPdfAsked(id)
      noteAsked(r)
    }
  }
  r.last = await b.step("look again on what has nothing")
  for (let round = 0; round < 6 && (r.last.waits.length || r.last.queued); round++) {
    for (const wait of r.last.waits) await b.clickWait(wait.kind, wait.host)
    r.last = await b.sleep(20 * 60_000)
  }
  expect(livenessErrors(r.last)).toEqual([])
}

// Where the browser ends up from this address, redirects and sign-in steps walked
async function fetchedTo(web: FakeWeb, url: string) {
  try {
    return new URL((await web.fetchFor("browser")(url)).url).hostname
  } catch {
    return undefined
  }
}

export async function modelRun(proxy: boolean, sequence: Event[]) {
  const wants: Want[] = PAPERS.map(() => ({ asked: false, stopped: false, dropped: false }))
  const ids: string[] = []
  const check = (screen: Screen, step: string) => {
    checkInvariants(screen, step)
    const errors = ids.length ? expectationErrors(screen, ids, wants) : []
    if (errors.length) throw new Error(`After "${step}":\n- ${errors.join("\n- ")}`)
  }
  const web = world(proxy)
  const bench = await startBench(web, { check, denied: ["umn.edu"], ...(proxy ? { proxy: { preset: "tsinghua" as const } } : {}) })
  try {
    ids.push(...PAPERS.map((p) => bench.addPaper(p.doi, p.title)))
    const r: Run = { b: bench, web, ids, wants, last: await bench.screen() }
    for (const e of sequence) r.last = await e.run(r)
    // What was kept is what was on the screen, once owlit has looked at every paper
    web.release()
    looksAtAll(wants)
    r.last = await bench.restartCore()
    // What the user did about a wait is kept too
    if (r.last.waits[0]) await bench.clickWait(r.last.waits[0].kind, r.last.waits[0].host)
    await bench.closeBrowser()
    const before = kept(await bench.step("the browser is closed"))
    expect(kept(await bench.restartCore())).toEqual(before)
    await doEverything(r)
    for (const [i, id] of ids.entries()) {
      const p = r.last.papers[id]
      if (wants[i].stopped || !wants[i].asked) continue
      if (PAPERS[i].kind === "manual") expect(p.hasPdf || p.state === "manual", `${id}: "${p.title}"`).toBe(true)
      else expect(p.hasPdf, `${id} was asked for, and reads "${p.title}"`).toBe(true)
    }
  } finally {
    await bench.dispose()
    vi.restoreAllMocks()
  }
}

export function modelTest(proxy: boolean, seed: number) {
  return fc.assert(
    fc.asyncProperty(fc.array(events, { minLength: 1, maxLength: Number(process.env.PDF_BENCH_EVENTS) || 20 }), (sequence) => modelRun(proxy, sequence)),
    { numRuns: Number(process.env.PDF_BENCH_RUNS) || 30, seed: Number(process.env.PDF_BENCH_SEED) || seed, endOnFailure: !!process.env.PDF_BENCH_NO_SHRINK },
  )
}
