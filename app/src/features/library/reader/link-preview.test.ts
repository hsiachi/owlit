import type { PdfTextRectObject } from "@embedpdf/models"
import { describe, expect, it } from "vitest"
import { columnOf, entryOf, linesOf } from "./link-preview"

const PAGE = 595

const run = (x: number, y: number, w: number, content: string, h = 10): PdfTextRectObject => ({
  font: { family: "Times", size: 10 },
  content,
  rect: { origin: { x, y }, size: { width: w, height: h } },
})

// Two lines of a two-column page: left column 70–290, right column 305–525
const twoColumns = [run(70, 100, 220, "left one"), run(305, 100, 220, "right one"), run(70, 112, 220, "left two"), run(305, 112, 220, "right two")]

describe("columnOf", () => {
  it("finds the gutter of a two-column page and takes the destination's side", () => {
    expect(columnOf(twoColumns, PAGE, 310)).toEqual([305, 525])
    expect(columnOf(twoColumns, PAGE, 72)).toEqual([70, 290])
  })

  it("takes the left column when the destination names no x", () => {
    expect(columnOf(twoColumns, PAGE, undefined)).toEqual([70, 290])
  })

  it("isn't fooled by the page number standing in the gutter", () => {
    expect(columnOf([...twoColumns, run(293, 780, 9, "10")], PAGE, 310)).toEqual([305, 525])
  })

  it("is the whole width under a caption that spans the page", () => {
    expect(columnOf([...twoColumns, run(70, 124, 455, "Figure 2: a wide figure")], PAGE, 310)).toEqual([70, 525])
  })
})

describe("entryOf", () => {
  it("ends a hanging-indent reference where the next one starts at the margin", () => {
    const lines = linesOf([run(70, 100, 220, "Smith, J. 2020. A paper"), run(80, 112, 210, "in a venue."), run(70, 124, 220, "Wu, K. 2021. Another")])
    expect(entryOf(lines).map((l) => l.text)).toEqual(["Smith, J. 2020. A paper", "in a venue."])
  })

  it("ends a numbered reference at the next number", () => {
    const lines = linesOf([run(70, 100, 220, "[3] Smith, J. A paper"), run(70, 112, 220, "in a venue."), run(70, 124, 220, "[4] Wu, K. Another")])
    expect(entryOf(lines)).toHaveLength(2)
  })

  it("ends at a gap wider than the lines' own spacing", () => {
    const lines = linesOf([run(70, 100, 220, "First line"), run(70, 112, 220, "second line"), run(70, 140, 220, "Next paragraph")])
    expect(entryOf(lines)).toHaveLength(2)
  })

  it("joins the runs of one line in reading order", () => {
    expect(linesOf([run(150, 100, 60, "venue."), run(70, 100, 75, "In a")]).map((l) => l.text)).toEqual(["In a venue."])
  })
})
