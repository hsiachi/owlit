import fc from "fast-check"
import { expect, it, vi } from "vitest"
import { FakeWeb, tlink } from "../../core/src/extension/test/fake-web.ts"
import { startBench, type Bench, type Screen } from "./adapter.ts"
import { checkInvariants } from "./invariants.ts"
import { atypon, psycnet } from "./sites.ts"

// Random sequences of what a user and their machine do, on one small library, with the bench's
// invariants checked after every event. A failing sequence is shrunk by fast-check to the shortest that
// still breaks one, and printed with the seed to replay it. The suite runs one fixed seed, so it is the
// same run every time; PDF_BENCH_SEED (and PDF_BENCH_RUNS) explore others.

const TLINK = "tlink.lib.tsinghua.edu.cn"

const PAPERS = [
  { doi: "10.1177/0956797601", title: "Direct Paper About Attention", at: "journals.sagepub.com", gate: {} },
  { doi: "10.1126/science.abc2001", title: "Science Paper Behind A Check One", at: "www.science.org", gate: { check: true } },
  { doi: "10.1126/science.abc2002", title: "Science Paper Behind A Check Two", at: "www.science.org", gate: { check: true } },
  { doi: "10.1080/0000501", title: "Paper Behind A Firewall Block", at: "www.tandfonline.com", gate: { blocked: true } },
  { doi: "10.1037/xge0501", title: "Script Page Paper", at: "psycnet", gate: {} },
]

function world(proxy: boolean) {
  const web = new FakeWeb()
  if (proxy) tlink(web)
  for (const p of PAPERS) {
    if (p.at === "psycnet") psycnet(web, p.doi, p.title)
    else atypon(web, p.at, p.doi, p.title, proxy ? { ...p.gate, subscription: true } : p.gate)
  }
  web.block("www.tandfonline.com")
  return web
}

type Event = { name: string; run: (b: Bench, ids: string[], last: Screen) => Promise<Screen> }

const event = (name: string, run: Event["run"]): Event => ({ name, run })
const paper = fc.integer({ min: 0, max: PAPERS.length - 1 })

const events = fc.oneof(
  fc.constant(event("Get PDFs", (b) => b.getPdfs())),
  paper.map((i) => event(`Find PDF ${i}`, (b, ids) => b.findPdf(ids[i]))),
  fc.constant(event("click the first wait", (b, _, s) => (s.waits[0] ? b.clickWait(s.waits[0].kind, s.waits[0].host) : b.step("nothing to click")))),
  fc.constant(event("press done on the first wait", (b, _, s) => (s.waits[0] ? b.pressDone(s.waits[0].host) : b.step("nothing to press")))),
  fc.constant(event("pass the check at science.org", (b) => b.passCheck("www.science.org"))),
  fc.constant(event("sign in at tlink", (b) => b.signIn(TLINK))),
  fc.constant(event("another network for tandfonline", (b) => b.changeNetwork("www.tandfonline.com"))),
  fc.constant(event("Stop", (b) => b.stop())),
  fc.constant(event("Dismiss", (b) => b.dismiss())),
  paper.map((i) => event(`drop the PDF of ${i}`, (b, ids, s) => (s.papers[ids[i]]?.hasPdf ? b.step("already has it") : b.dropPdf(ids[i], PAPERS[i].doi)))),
  fc.constant(event("restart owlit", (b) => b.restartCore())),
  fc.constant(event("reload the window", (b) => b.reloadRenderer())),
  fc.constant(event("sleep 20 minutes", (b) => b.sleep(20 * 60_000))),
  fc.constant(event("open another workspace and come back", async (b) => (await b.openWorkspace("other"), b.openWorkspace("main")))),
)

it("keeps the screen consistent through any sequence of what the user and the machine do", { timeout: 600_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.array(events, { minLength: 1, maxLength: 8 }), async (proxy, sequence) => {
      const bench = await startBench(world(proxy), { check: checkInvariants, ...(proxy ? { proxy: { preset: "tsinghua" as const } } : {}) })
      try {
        const ids = PAPERS.map((p) => bench.addPaper(p.doi, p.title))
        let screen = await bench.screen()
        for (const e of sequence) screen = await e.run(bench, ids, screen)
        // Every paper is somewhere the user can see: saved, or with words on its card
        for (const id of ids) expect(screen.papers[id].hasPdf || screen.papers[id].title.length > 0).toBe(true)
      } finally {
        await bench.dispose()
        vi.restoreAllMocks()
      }
    }),
    { numRuns: Number(process.env.PDF_BENCH_RUNS) || 25, seed: Number(process.env.PDF_BENCH_SEED) || 20261103 },
  )
})
