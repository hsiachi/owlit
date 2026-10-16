import { describe, expect, it } from "vitest"
import type { Paper } from "@owlit/protocol"
import { needsYou, pdfWait, waitsOnYou } from "./pdf-wait"

const paper = (noPdf?: Paper["noPdf"], pdf = false) => ({ pdf, noPdf }) as unknown as Paper
const looked = { tried: [], at: 1 }

describe("pdfWait", () => {
  it("reads where a paper without its PDF stands", () => {
    expect(pdfWait(paper(undefined, true))).toBeUndefined()
    expect(pdfWait(paper())).toBe("not-yet")
    expect(pdfWait(paper(looked))).toBe("not-found")
    expect(pdfWait(paper({ ...looked, needs: "browser" }))).toBe("browser")
    expect(pdfWait(paper({ ...looked, needs: "browser", noAccess: { refused: true, at: 1 } }))).toBe("no-access")
    expect(pdfWait(paper({ ...looked, needs: "browser", noAccess: { refused: false, missing: true, at: 1 } }))).toBe("missing")
    expect(pdfWait(paper({ ...looked, needs: "browser", fromBrowser: { state: "waiting" } }))).toBe("run-stopped")
    expect(pdfWait(paper({ ...looked, needs: "browser", fromBrowser: { state: "missed" } }))).toBe("missed")
  })

  it("puts a file to confirm before the run's own state", () => {
    expect(pdfWait(paper({ ...looked, offered: "x.pdf", fromBrowser: { state: "page" } }))).toBe("offered")
  })

  it("counts a page open to save from whatever sent the paper there", () => {
    const sentFromNotFound = paper({ ...looked, fromBrowser: { state: "page" } })
    expect(waitsOnYou(pdfWait(sentFromNotFound))).toBe(true)
    expect(needsYou(sentFromNotFound)).toBe(true)
  })

  it("keeps a run's papers under Needs you while it works, without them waiting on the user", () => {
    const queued = paper({ ...looked, needs: "browser", fromBrowser: { state: "queued" } })
    expect(waitsOnYou(pdfWait(queued))).toBe(false)
    expect(needsYou(queued)).toBe(true)
  })

  it("leaves what was tried and turned away to its card", () => {
    expect(needsYou(paper({ ...looked, needs: "browser", fromBrowser: { state: "missed" } }))).toBe(false)
    expect(needsYou(paper({ ...looked, needs: "browser", noAccess: { refused: true, at: 1 } }))).toBe(false)
  })
})
