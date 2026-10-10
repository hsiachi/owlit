import { describe, expect, it } from "vitest"
import { extractText, toMarkdown, UnreadablePdf } from "./extract.ts"
import { makePdf, paragraph } from "./make-pdf.ts"

// A two-column page: a centred title, a heading on the left margin, then a left and a right column
const twoColumns = makePdf([
  [
    { x: 196, y: 80, size: 18, text: "A Study of Reading Order" },
    { x: 72, y: 140, size: 10, text: "1 Introduction", bold: true },
    ...paragraph(72, 160, [
      "The left column starts the paper and runs",
      "down the page for a while before it stops",
      "and the reader moves to the right column.",
    ]),
    ...paragraph(320, 160, [
      "The right column continues the argument",
      "with its own sentences that come after",
      "everything written in the left column.",
    ]),
  ],
])

describe("extractText", () => {
  it("keeps reading order column by column and finds the heading", async () => {
    const text = await extractText(twoColumns)
    expect(text.source).toBe("pdfium")
    expect(text.needsOcr).toBeUndefined()
    const [page] = text.pages
    expect(page).toMatchObject({ index: 0, width: 612, height: 792 })
    expect(page.blocks.map((b) => [b.kind, b.lines[0].text])).toEqual([
      ["heading", "A Study of Reading Order"],
      ["heading", "1 Introduction"],
      ["paragraph", "The left column starts the paper and runs"],
      ["paragraph", "The right column continues the argument"],
    ])
    expect(toMarkdown(text)).toBe(
      [
        "<!-- page 1 -->",
        "## A Study of Reading Order",
        "## 1 Introduction",
        "The left column starts the paper and runs down the page for a while before it stops and the reader moves to the right column.",
        "The right column continues the argument with its own sentences that come after everything written in the left column.",
      ].join("\n\n") + "\n",
    )
  })

  it("puts each line where it is drawn, in points from the page's top-left", async () => {
    const text = await extractText(twoColumns)
    const line = text.pages[0].blocks[2].lines[0]
    // The baseline is at 160 from the top; a 10pt line sits above it
    expect(line.rect.x).toBeCloseTo(72, 0)
    expect(line.rect.y).toBeGreaterThan(148)
    expect(line.rect.y).toBeLessThan(153)
    expect(line.rect.y + line.rect.h).toBeGreaterThan(160)
    expect(line.rect.y + line.rect.h).toBeLessThan(164)
    expect(line.rect.w).toBeGreaterThan(150)
    expect(line.rect.w).toBeLessThan(240)
  })

  it("keeps a hyphen that ends a line and joins the word in the Markdown", async () => {
    const text = await extractText(makePdf([paragraph(72, 100, ["a state-of-the-", "art method for inter-", "esting results"])]))
    expect(toMarkdown(text)).toMatch(/state-of-the-?art method for inter-?esting results/)
  })

  it("marks a page without a text layer as needing OCR", async () => {
    const text = await extractText(makePdf([[], []]))
    expect(text.needsOcr).toBe(true)
    expect(text.pages).toHaveLength(2)
    expect(text.pages.every((p) => p.blocks.length === 0)).toBe(true)
  })

  it("says plainly when the file isn't a PDF it can read", async () => {
    await expect(extractText(Buffer.from("%PDF-1.4\nnot really"))).rejects.toBeInstanceOf(UnreadablePdf)
  })

  it("reads a 300-page book without holding core up, reporting each page", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1} of a long book, set in ten point type with some words.`)
    const book = makePdf(Array.from({ length: 300 }, () => paragraph(72, 72, lines)))
    // Work queued at one page gets its turn before the next page is read: checked by order, which
    // a busy machine (the whole suite running) can't change
    const turns: number[] = []
    let longestStall = 0
    let last = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      longestStall = Math.max(longestStall, now - last)
      last = now
    }, 1)
    const started = performance.now()
    const text = await extractText(book, {
      onPage: (done) => {
        expect(turns).toHaveLength(done - 1)
        setImmediate(() => turns.push(done))
      },
    })
    const took = performance.now() - started
    clearInterval(ticker)
    expect(text.pages).toHaveLength(300)
    expect(turns).toHaveLength(300)
    // No stretch takes a large share of the read (the book in one go would take all of it). Not a
    // fixed limit: a busy machine stretches a page's few milliseconds past 200ms, and the read with it.
    expect(longestStall).toBeLessThan(took / 4)
    console.log(`300 pages in ${Math.round(took)}ms, longest stall ${Math.round(longestStall)}ms`)
  }, 60_000)

  it("stops when cancelled", async () => {
    const book = makePdf(Array.from({ length: 50 }, () => paragraph(72, 72, ["text"])))
    const controller = new AbortController()
    const pending = extractText(book, { signal: controller.signal, onPage: (done) => done === 3 && controller.abort(new Error("stop")) })
    await expect(pending).rejects.toThrow("stop")
  })
})
