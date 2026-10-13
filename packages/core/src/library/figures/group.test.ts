import { describe, expect, it } from "vitest"
import { captionLabel, groupPage, type LayoutBlock, type LayoutPage } from "./group.ts"

// Pages as MinerU lays them out (points, top-left origin), with only what grouping reads
const text = (content: string) => ({ lines: [{ spans: [{ content }] }] })
const body = (bbox: [number, number, number, number], image: string): LayoutBlock => ({ type: "image_body", bbox, lines: [{ spans: [{ type: "image", image_path: image }] }] })
const caption = (bbox: [number, number, number, number], content: string): LayoutBlock => ({ type: "image_caption", bbox, ...text(content) })
const image = (...blocks: LayoutBlock[]): LayoutBlock => ({ type: "image", bbox: blocks[0].bbox, blocks })
const page = (...para_blocks: LayoutBlock[]): LayoutPage => ({ page_idx: 3, page_size: [612, 792], para_blocks })
const summary = (p: LayoutPage) => groupPage(p).map((f) => [f.label, f.images])

describe("captionLabel", () => {
  it("reads the number a caption starts with, OCR gaps and supplements included", () => {
    expect(captionLabel("Figure 3: A chart", "figure")).toBe("Figure 3")
    expect(captionLabel("Fig. 12. Results", "figure")).toBe("Figure 12")
    expect(captionLabel("Fi ure 6: Likert", "figure")).toBe("Figure 6")
    expect(captionLabel("Figure S2: More", "figure")).toBe("Figure S2")
    expect(captionLabel("Supplementary Figure 4", "figure")).toBe("Figure 4")
    expect(captionLabel("Table 2. Means", "table")).toBe("Table 2")
    expect(captionLabel("Figures show how", "figure")).toBeUndefined()
    expect(captionLabel("As Figure 3 shows", "figure")).toBeUndefined()
  })
})

describe("groupPage", () => {
  it("joins the panels above a caption into one figure", () => {
    const p = page(image(body([72, 100, 290, 300], "a")), image(body([310, 100, 540, 300], "b"), caption([72, 310, 540, 330], "Figure 1: Two panels.")))
    expect(summary(p)).toEqual([["Figure 1", ["a", "b"]]])
    expect(groupPage(p)[0]).toMatchObject({ page: 3, box: { x0: 72, y0: 100, x1: 540, y1: 300 } })
  })

  it("keeps stacked figures apart when MinerU hangs the caption between them on the lower one", () => {
    // Figure 8's caption sits between the two, but came attached to the lower picture
    const p = page(image(body([100, 100, 500, 280], "top")), image(caption([100, 290, 500, 305], "Figure 8: Scenario 4"), body([100, 320, 500, 500], "bottom")), image(caption([100, 510, 500, 525], "Figure 9: Scenario 5")))
    expect(summary(p)).toEqual([
      ["Figure 8", ["top"]],
      ["Figure 9", ["bottom"]],
    ])
  })

  it("keeps figures set side by side apart, each with its caption", () => {
    const p = page(
      image(body([60, 100, 290, 250], "left"), caption([60, 260, 290, 290], "Figure 3: Boxplots of baseline ratings.")),
      image(body([320, 100, 550, 250], "right"), caption([320, 260, 550, 290], "Figure 4: Boxplot of social ratings.")),
    )
    expect(summary(p)).toEqual([
      ["Figure 3", ["left"]],
      ["Figure 4", ["right"]],
    ])
  })

  it("reaches the outer panels of a figure under a short centred caption", () => {
    const p = page(image(body([60, 100, 200, 220], "a")), image(body([230, 100, 380, 220], "b")), image(body([410, 100, 550, 220], "c"), caption([260, 230, 350, 242], "Fig. 4. Data efficiency.")))
    expect(summary(p)).toEqual([["Figure 4", ["a", "b", "c"]]])
  })

  it("doesn't join pieces that would take body text inside", () => {
    // A logo in the margin and the figure in the other column, with the abstract between
    const p = page(
      image(body([60, 700, 120, 730], "logo")),
      { type: "text", bbox: [60, 380, 290, 690], ...text("This paper studies how groups coordinate their work through shared displays and what they say to each other.") },
      image(body([60, 300, 550, 370], "figure"), caption([60, 375, 550, 380], "Figure 1: The system.")),
    )
    // The logo isn't under any caption: it stays out; the figure stands alone
    expect(summary(p)).toEqual([["Figure 1", ["figure"]]])
  })

  it("takes a table whole with the caption inside its block", () => {
    const p = page({ type: "table", bbox: [72, 100, 540, 300], blocks: [{ type: "table_caption", bbox: [72, 100, 540, 115], ...text("Table 2: Means") }, { type: "table_body", bbox: [72, 120, 540, 300], lines: [{ spans: [{ type: "table", image_path: "t" }] }] }] })
    expect(groupPage(p)).toMatchObject([{ kind: "table", label: "Table 2", images: ["t"] }])
  })
})
