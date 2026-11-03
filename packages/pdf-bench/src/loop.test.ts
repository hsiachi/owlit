import { afterEach, expect, it, vi } from "vitest"
import { FakeWeb } from "../../core/src/extension/test/fake-web.ts"
import { startBench, type Bench } from "./adapter.ts"
import { atypon } from "./sites.ts"

// The three layers run together: core's own routes miss, the extension fetches, the window sees the PDF

let bench: Bench | undefined
afterEach(async () => {
  await bench?.dispose()
  bench = undefined
  vi.restoreAllMocks()
})

it("runs core, the extension's fetching and the window's reading as one", async () => {
  const web = new FakeWeb()
  atypon(web, "journals.sagepub.com", "10.1177/0002", "A Paywalled Paper About Memory")
  bench = await startBench(web)
  const id = bench.addPaper("10.1177/0002", "A Paywalled Paper About Memory")
  const screen = await bench.findPdf(id)
  expect(screen.papers[id].hasPdf).toBe(true)
  expect(bench.fetched()).toEqual([id])
  // owlit's own fetch tried first and was turned away; the browser's got it
  expect(web.log.filter((l) => l.url.includes("/doi/pdf/")).map((l) => l.client)).toEqual(["core", "browser"])
})
