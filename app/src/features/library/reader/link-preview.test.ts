import type { PdfTextRectObject } from "@embedpdf/models"
import { describe, expect, it } from "vitest"
import { captionOf, columnOf, continuationOf, entryOf, equationOf, gutterOf, linesOf, sectionOf } from "./link-preview"

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
  it("keeps a link that breaks after a slash with the rest of it on the next line", () => {
    const lines = linesOf([run(76, 100, 150, "https://huggingface.co/datasets/", 8), run(70, 110, 120, "explodinggradients/WikiEval", 8), run(70, 140, 220, "Body text after it.")])
    expect(entryOf(lines)).toHaveLength(2)
  })

  it("ends a paragraph where a smaller footnote follows close under it", () => {
    const small = (x: number, y: number, w: number, content: string): PdfTextRectObject => ({ ...run(x, y, w, content), font: { family: "Times", size: 8 } })
    const lines = linesOf([run(70, 100, 220, "The section opens and runs on"), run(70, 112, 220, "to the foot of the page"), small(76, 125, 214, "4 We follow Liu et al. (2023a).")])
    expect(entryOf(lines)).toHaveLength(2)
  })

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

  it("keeps an author-year entry's inner line that opens with the year", () => {
    const lines = linesOf([run(70, 100, 220, "Jean Kaddour, Joshua Harris, Maximilian"), run(80, 112, 210, "2023. Challenges and applications."), run(70, 124, 220, "Wu, K. 2021. Another")])
    expect(entryOf(lines)).toHaveLength(2)
  })

  it("joins a line's runs left to right when one sits a little higher", () => {
    const lines = linesOf([run(70, 100.4, 100, "Smith. 2020. A paper."), run(175, 100, 60, "In Venue,"), run(240, 100.2, 50, "2020.")])
    expect(lines.map((l) => l.text)).toEqual(["Smith. 2020. A paper. In Venue, 2020."])
  })

  it("keeps a raised footnote mark on its line", () => {
    const lines = linesOf([run(80, 98, 4, "1", 6), run(85, 100, 200, "Code and dataset can be found at"), run(70, 112, 220, "https://github.com/x.")])
    expect(lines.map((l) => l.text)).toEqual(["1 Code and dataset can be found at", "https://github.com/x."])
  })

  it("ends a one-line entry that stops short after a full stop, in a list without indents or gaps", () => {
    const lines = linesOf([run(70, 100, 160, "A Vaswani. Attention is all you need. NeurIPS, 2017."), run(70, 112, 220, "HP Vinutha and others. A long title that"), run(70, 124, 220, "runs on to a second line.")])
    expect(entryOf(lines)).toHaveLength(1)
  })

  it("goes on past an author list that ends with its year", () => {
    const lines = linesOf([run(70, 100, 220, "Jon Saad-Falcon, Omar Khattab,"), run(80, 112, 150, "Christopher Potts. 2023."), run(80, 124, 210, "ARES: an automated evaluation framework.")])
    expect(entryOf(lines)).toHaveLength(3)
  })

  it("ends a footnote where the next one starts at its indent", () => {
    const lines = linesOf([run(80, 98, 4, "2", 6), run(85, 100, 200, "Our code and data are"), run(70, 112, 220, "released for research use only."), run(80, 122, 4, "3", 6), run(85, 124, 200, "The second footnote.")])
    expect(entryOf(lines)).toHaveLength(2)
  })

  it("joins the runs of one line in reading order", () => {
    expect(linesOf([run(150, 100, 60, "venue."), run(70, 100, 75, "In a")]).map((l) => l.text)).toEqual(["In a venue."])
  })
})

describe("continuationOf", () => {
  it("takes the indented lines at the top of the next column, up to the next entry", () => {
    const lines = linesOf([run(80, 60, 210, "2024. The llama 3 herd of models."), run(80, 72, 210, "arXiv preprint."), run(70, 84, 220, "Wu, K. 2021. Another")])
    expect(continuationOf(lines, 8).map((l) => l.text)).toEqual(["2024. The llama 3 herd of models.", "arXiv preprint."])
  })

  it("skips a running head that stands apart above the text", () => {
    const lines = linesOf([run(200, 20, 100, "Preprint."), run(80, 60, 210, "the rest of it."), run(70, 72, 220, "Wu, K. 2021. Another")])
    expect(continuationOf(lines, 8).map((l) => l.text)).toEqual(["the rest of it."])
  })

  it("takes nothing when the next column opens at the margin", () => {
    const lines = linesOf([run(70, 60, 220, "Wu, K. 2021. Another"), run(80, 72, 210, "in a venue.")])
    expect(continuationOf(lines, 8)).toEqual([])
  })

  it("takes nothing when the next column opens with a new numbered entry", () => {
    const lines = linesOf([run(70, 60, 220, "[13] Wu, K. Another"), run(70, 72, 220, "in a venue.")])
    expect(continuationOf(lines, 8)).toEqual([])
  })
})

describe("sectionOf", () => {
  it("takes a heading, its subheading and the opening lines of the text", () => {
    const lines = linesOf([
      run(70, 100, 120, "5 Experiments", 12),
      run(70, 124, 100, "5.1 Settings", 11),
      ...[0, 1, 2, 3, 4, 5].map((i) => run(70, 144 + 12 * i, 220, `line ${i} of the running text`)),
    ])
    expect(sectionOf(lines).map((l) => l.text)).toEqual(["5 Experiments", "5.1 Settings", "line 0 of the running text", "line 1 of the running text", "line 2 of the running text", "line 3 of the running text"])
  })

  it("takes a numbered heading that ends with a full stop for a heading", () => {
    const lines = linesOf([run(70, 100, 140, "A.1 Reflection Tokens.", 11), run(70, 124, 220, "We define four reflection tokens that"), run(70, 136, 220, "the critic predicts for each passage.")])
    expect(sectionOf(lines)).toHaveLength(3)
  })

  it("keeps a heading that wraps to two lines", () => {
    const lines = linesOf([run(70, 100, 220, "4 Memorization Depends on Popularity and"), run(70, 112, 120, "Relationship Type"), run(70, 136, 220, "We find that the text starts here.")])
    expect(sectionOf(lines)).toHaveLength(3)
  })
})

describe("equationOf", () => {
  const running = (y: number) => run(70, y, 220, "where the score of each passage is given by")
  it("takes the lines of a display above its numbered line, not the text around it", () => {
    const lines = linesOf([running(100), run(120, 116, 120, "S(x) = sum over i"), run(130, 130, 160, "= exp(z) / Z (16)"), running(146)])
    expect(equationOf(lines, 128, [70, 290]).map((l) => l.text)).toEqual(["S(x) = sum over i", "= exp(z) / Z (16)"])
  })

  it("stops at the next equation's number", () => {
    const lines = linesOf([run(120, 100, 160, "a = b + c (2)"), run(120, 116, 160, "d = e + f (3)")])
    expect(equationOf(lines, 98, [70, 290]).map((l) => l.text)).toEqual(["a = b + c (2)"])
  })
})

describe("gutterOf", () => {
  it("takes no word gap in a lone caption for a gutter", () => {
    expect(gutterOf([run(150, 400, 140, "Figure 2: RAG Systems"), run(294, 400, 150, "Evaluation on NQ")], PAGE)).toBeNull()
  })

  const page = (extra: PdfTextRectObject[] = []) => [...Array.from({ length: 40 }, (_, i) => [run(70, 80 + 14 * i, 220, "left"), run(305, 80 + 14 * i, 220, "right")]).flat(), ...extra]

  it("finds the strip between two columns", () => {
    const g = gutterOf(page(), PAGE)
    expect(g?.[0]).toBeGreaterThanOrEqual(288)
    expect(g?.[1]).toBeLessThanOrEqual(308)
  })

  it("still finds it under a caption across the page", () => {
    const g = gutterOf(page([run(70, 700, 455, "Figure 3: a figure as wide as the page"), run(70, 712, 455, "and its caption's second line")]), PAGE)
    expect(g?.[0]).toBeGreaterThanOrEqual(288)
    expect(g?.[1]).toBeLessThanOrEqual(308)
  })

  it("is null on a one-column page", () => {
    expect(gutterOf(Array.from({ length: 40 }, (_, i) => run(70, 80 + 14 * i, 455, "a line across the page")), PAGE)).toBeNull()
  })
})

describe("captionOf", () => {
  it("reads a caption longer than a reference may run, to its gap", () => {
    const lines = linesOf([...Array.from({ length: 11 }, (_, i) => run(70, 100 + 12 * i, 220, `caption line ${i}`)), run(70, 250, 220, "Body text after it.")])
    expect(captionOf(lines)).toHaveLength(11)
  })

  it("ends where the lines step further apart, when a font's boxes overlap from line to line", () => {
    const caption = Array.from({ length: 3 }, (_, i) => run(108, 100 + 11 * i, 396, `Figure 3: caption line ${i}`, 12))
    const body = Array.from({ length: 6 }, (_, i) => run(108, 138 + 11 * i, 396, `body line ${i}`, 12))
    expect(captionOf(linesOf([...caption, ...body]))).toHaveLength(3)
  })
})
