import { PdfZoomMode, type PdfDestinationObject, type PdfDocumentObject, type PdfEngine, type PdfTextRectObject } from "@embedpdf/models"
import { glyphAt } from "@embedpdf/plugin-selection"
import type { Rect } from "@owlit/protocol"

// What hovering an internal link shows: the part of the destination page it points at, cut from the page
// itself. For a citation that is its reference entry; for "Section 3", the heading and the start of its
// paragraph; for "Figure 2", the figure down to the end of its caption. Read from the text's own layout,
// since a destination names only a point: the entry runs down from there until a new one starts.

// A box on a page, in PDF points from its top-left
export interface PreviewBox {
  pageIndex: number
  x: number
  y: number
  w: number
  h: number
}

// A link as the page has it: where it sits (PDF points from the top-left) and where it goes
export interface PageLink {
  pageIndex: number
  rect: Rect
  destination: PdfDestinationObject
}

interface Line {
  x: number
  right: number
  top: number
  bottom: number
  text: string
  // The largest font size on the line, in points
  size: number
  // It opens with a raised mark smaller than its words: a footnote's number
  marked: boolean
}

// How far below the destination the lines are read, in PDF points: more than any one entry runs
const BAND = 200
// Room around the lines, so no glyph touches the card's edge
const PAD = 3
// A preview never runs longer than this many lines; a longer entry is cut, a click shows the rest
const MAX_LINES = 8
// Lines after a lone first line (a heading), so "Section 3" shows what the section opens with
const AFTER_HEADING = 4
// How much of the page a figure or table takes when no caption says where it is, in PDF points
const FLOAT_HEIGHT = 240
// A wider gap than any between a table's rows: the space before what follows it, in PDF points
const FLOAT_GAP = 24
// A line of running text spans its column; a figure's own labels seldom do
const RUNNING_TEXT = 0.85
// How far above a table's anchor its caption may start: the anchor can sit on the rows under it
const CAPTION_ABOVE = 120
// A caption may run long; past this it is cut, and a click shows the rest
const MAX_CAPTION_LINES = 16
// A caption this close under the destination is where the anchor sits, not below a figure
const CAPTION_AT = 24
// How much text, summed down the page in PDF points, makes a column beside a gutter: a few lines
const COLUMN_DEPTH = 40
// How far above and below the destination a gutter is looked for when the whole page shows none
const NEAR_GUTTER = 200
// The narrowest blank strip down the middle of the page that reads as the gutter between two columns
const GUTTER = 8
// A numbered entry's own number opens its first line: "[12]", "12."; never four digits, which open an
// author-year entry's inner line ("2023. Title…")
const ENTRY_NUMBER = /^\s*(\[\d+[a-z]?\]|\d{1,3}\.)\s/
// A heading doesn't end like a sentence; a one-line reference or footnote does, and stands alone
const SENTENCE_END = /[.:]\s*$/
// An author-year entry's author list ends with its year ("Christopher Potts. 2023."): the entry goes on
const AUTHORS_END = /\.\s+(19|20)\d{2}[a-z]?\.\s*$/
const endsSentence = (text: string) => SENTENCE_END.test(text) && !AUTHORS_END.test(text)
// A heading's own number: "3.2.1 Training", "A.1 Reflection", "§ 5 Results"
const NUMBERED_HEADING = /^\s*(§\s*)?(\d+(\.\d+)*|[A-Z](\.\d+)+)\.?\s+[A-Z]/
// An appendix heading by its letter alone, with no full stop inside it: "B Calculation of Scores"; never
// "A Vaswani. Attention is all you need."
const LETTER_HEADING = /^\s*[A-Z]\s+[A-Z][^.]*\.?\s*$/
// The number at a displayed equation's right: "(12)"
const EQUATION_NUMBER = /\(\d+[a-z]?\)\s*$/
// How far short of its column's edge a line that ends a sentence stops when it ends a paragraph or an
// entry, in PDF points; justified lines inside one reach the edge
const SHORT_LINE = 15
// A reference's last line may end in its link, with no full stop
const ENDS_IN_LINK = /(https?:|www\.|doi|arxiv)\S*\s*$/i
// A link broken after a slash or a hyphen runs on in the next line
const endsInLink = (text: string) => ENDS_IN_LINK.test(text) && !/[/\-_]\s*$/.test(text)
// A caption's opening words
const CAPTION = /^\s*(fig(ure)?|tab(le)?|alg(orithm)?)\.?\s*[A-Z]?\d/i
// The words before a link's number that make it a figure's, table's or algorithm's: "Figure 2", "Tab. 3",
// "Figure 4a,"; with \ref only the number is the link, so the words before it are read too, and the
// punctuation after it often reads as part of the link
const FLOAT_LINK = /(fig(ure)?s?|tab(le)?s?|alg(orithm)?s?)\.?[\s~]*[A-Z]?\d*[a-z]?(?:(?:,|\s+and|\s*&)\s*[A-Z]?\d+[a-z]?)*[\s.,;:)]*$/i
// The words that make a link an equation's: "Equation 8", "Eq. (3)", "(12)"
const EQUATION_LINK = /(eq(uation)?s?\.?[\s~]*\(?\d+[a-z]?\)?|\(\d+[a-z]?\))[\s.,;:)]*$/i
// An equation's lines stand apart from running text, which starts at the margin with words in it
const WORD = /\b[A-Za-z]{3,}\b/g
const MAX_EQUATION_LINES = 6
// How many characters before the link are read for those words: enough for "Figures 16 and " when only
// the "17" after it is the link
const LINK_LEAD = 24
// The number a float link ends on, and a caption's kind and number: "Table 3:", "Figure 5."; a line of
// running text that opens with "Table 3 shows" has no colon or full stop after the number
const LINKED_NUMBER = /([A-Z]?\d+)[a-z]?[\s.,;:)]*$/
// The opening of an algorithm's step: its number or a keyword
const ALGORITHM_LINE = /^\s*(\d+:|require|ensure|input|output|return|end\b|procedure|function)/i
const NUMBERED_CAPTION = /^\s*(fig|tab|alg)[a-z]*\.?\s*([A-Z]?\d+)\s*[:.|]/i

const textRead = new WeakMap<PdfDocumentObject, Map<number, Promise<PdfTextRectObject[]>>>()

function pageText(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number): Promise<PdfTextRectObject[]> {
  let byPage = textRead.get(doc)
  if (!byPage) textRead.set(doc, (byPage = new Map()))
  let rects = byPage.get(pageIndex)
  if (!rects) {
    rects = readRuns(engine, doc, pageIndex).catch(() => [])
    byPage.set(pageIndex, rects)
  }
  return rects
}

// The page's runs of text with their words. Not getPageTextRects: its words often carry stray characters
// past their end ("github.io/s arA"), and whether a line ends like a sentence decides where a cut ends.
// A page whose text does not read gets the float-sized cut.
async function readRuns(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number): Promise<PdfTextRectObject[]> {
  const geo = await engine.getPageGeometry(doc, doc.pages[pageIndex]).toPromise()
  const runs = geo.runs.filter((r) => r.glyphs.length)
  const words = await engine.getTextSlices(doc, runs.map((r) => ({ pageIndex, charIndex: r.charStart, charCount: r.glyphs.length }))).toPromise()
  return runs
    .map((r, i) => ({ font: { family: "", size: r.fontSize ?? 0 }, content: words[i] ?? "", rect: { origin: { x: r.rect.x, y: r.rect.y }, size: { width: r.rect.width, height: r.rect.height } } }))
    .filter((r) => r.content.trim())
}

// The link's words with the few before them, as the source page has them
async function linkWords(engine: PdfEngine, doc: PdfDocumentObject, link: PageLink): Promise<string> {
  const geo = await engine.getPageGeometry(doc, doc.pages[link.pageIndex]).toPromise()
  const y = link.rect.y + link.rect.h / 2
  const from = glyphAt(geo, { x: link.rect.x + 1, y })
  const to = glyphAt(geo, { x: link.rect.x + link.rect.w - 1, y })
  if (from < 0 || to < from) return ""
  const start = Math.max(0, from - LINK_LEAD)
  const [text] = await engine.getTextSlices(doc, [{ pageIndex: link.pageIndex, charIndex: start, charCount: to - start + 1 }]).toPromise()
  return text ?? ""
}

const top = (r: PdfTextRectObject) => r.rect.origin.y
const bottom = (r: PdfTextRectObject) => r.rect.origin.y + r.rect.size.height
const middle = (r: PdfTextRectObject) => r.rect.origin.y + r.rect.size.height / 2

// The column at x across these rects, as [left, right]: a blank strip down the page's middle third is
// the gutter of a two-column page; text across it (a caption under a wide figure) makes it one column
export function columnOf(rects: PdfTextRectObject[], pageWidth: number, x: number | undefined): [number, number] {
  // A short piece across the page's middle (the page number under a two-column page) doesn't close the
  // gutter; a caption or a line of a one-column page is far wider
  const centred = (r: PdfTextRectObject) => r.rect.size.width < pageWidth * 0.1 && r.rect.origin.x < pageWidth / 2 && r.rect.origin.x + r.rect.size.width > pageWidth / 2
  const spans = rects
    .filter((r) => !centred(r))
    .map((r) => [r.rect.origin.x, r.rect.origin.x + r.rect.size.width] as const)
    .sort((a, b) => a[0] - b[0])
  if (!spans.length) return [0, pageWidth]
  const left = spans[0][0]
  const right = Math.max(...spans.map((s) => s[1]))
  let reach = spans[0][1]
  for (const [from, to] of spans) {
    if (from - reach >= GUTTER && reach > pageWidth / 3 && from < (pageWidth * 2) / 3) {
      // Without an x the destination is a column's own start, so the left one
      return x !== undefined && x >= from - GUTTER ? [from, right] : [left, reach]
    }
    reach = Math.max(reach, to)
  }
  return [left, right]
}

const inColumn = (rects: PdfTextRectObject[], [left, right]: [number, number]) =>
  rects.filter((r) => {
    const mid = r.rect.origin.x + r.rect.size.width / 2
    return mid >= left && mid <= right
  })

// Text rects into lines, top to bottom: rects that overlap vertically are one line. A line's words are
// joined left to right once it is whole: an italic or superscript run sits a little higher than its
// neighbours, and joined in the order the rects come, a line ended on a word from its middle.
export function linesOf(rects: PdfTextRectObject[]): Line[] {
  const groups: PdfTextRectObject[][] = []
  let band = { top: 0, bottom: -Infinity }
  for (const r of [...rects].sort((a, b) => top(a) - top(b) || a.rect.origin.x - b.rect.origin.x)) {
    // Half the smaller one's height in common: a raised footnote mark or a superscript sits on its line
    const common = Math.min(bottom(r), band.bottom) - Math.max(top(r), band.top)
    if (groups.length && common >= Math.min(r.rect.size.height, band.bottom - band.top) / 2) {
      groups.at(-1)!.push(r)
      band = { top: Math.min(band.top, top(r)), bottom: Math.max(band.bottom, bottom(r)) }
    } else {
      groups.push([r])
      band = { top: top(r), bottom: bottom(r) }
    }
  }
  return groups.map((g) => {
    const runs = g.sort((a, b) => a.rect.origin.x - b.rect.origin.x)
    const size = Math.max(...runs.map((r) => r.font.size))
    return {
      x: runs[0].rect.origin.x,
      right: Math.max(...runs.map((r) => r.rect.origin.x + r.rect.size.width)),
      top: Math.min(...runs.map(top)),
      bottom: Math.max(...runs.map(bottom)),
      text: runs.map((r) => r.content).join(" "),
      size,
      marked: runs.length > 1 && /^\s*[\d*†‡§]+\s*$/.test(runs[0].content) && runs[0].font.size < size * 0.8,
    }
  })
}

// Running text starts at its column's margin, spans the column and has words in it; a figure's labels,
// a table's rows and an equation's lines seldom do all three. Given the page's body size, it is also set
// in it: a prompt in a figure or a table's rows are mostly set smaller.
function isRunning(line: Line, [left, right]: [number, number], body?: number) {
  return (
    line.x - left < 16 &&
    line.right - line.x >= (right - left) * RUNNING_TEXT &&
    (line.text.match(WORD)?.length ?? 0) >= 5 &&
    (body === undefined || Math.abs(line.size - body) < 0.6)
  )
}

// The page's body size: the commonest size among its lines with words in them
function bodySize(lines: Line[]): number | undefined {
  const count = new Map<number, number>()
  for (const l of lines) if ((l.text.match(WORD)?.length ?? 0) >= 5) count.set(Math.round(l.size * 2) / 2, (count.get(Math.round(l.size * 2) / 2) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
}

// The lines of one entry, from the first: it ends at a wider gap than the lines' own spacing, at a line
// that starts a new entry (its own number, or back at the first line's x after an indented second line),
// after a line that ends a sentence well short of the column's edge (a list with neither numbers, indents
// nor gaps), or at MAX_LINES
export function entryOf(lines: Line[]): Line[] {
  const [first, second] = lines
  const height = first.bottom - first.top
  // An indent either way: hung under the first line (a reference), or the first line indented (a footnote
  // after its number, a paragraph); a line back at the first one's x starts the next
  const hanging = second !== undefined && Math.abs(second.x - first.x) > 2
  const edge = Math.max(...lines.map((l) => l.right))
  const entry = [first]
  for (const line of lines.slice(1)) {
    const prev = entry.at(-1)!
    // A footnote under a paragraph is set smaller
    if (line.top - prev.bottom > height * 0.6 || Math.abs(line.size - first.size) > 1.5) break
    if ((endsSentence(prev.text) || endsInLink(prev.text)) && edge - prev.right > SHORT_LINE) break
    if (ENTRY_NUMBER.test(line.text) || (hanging && Math.abs(line.x - first.x) < 1.5)) break
    entry.push(line)
    if (entry.length === MAX_LINES) break
  }
  return entry
}

type Box = Omit<PreviewBox, "pageIndex">

// The gutter of a two-column page, as [left, right], or null for one column: where the page's text
// thins out down its middle. Read from the whole page, so a wide float or a caption across the middle
// doesn't hide it, and a table's gaps between its own columns don't make one.
export function gutterOf(rects: PdfTextRectObject[], pageWidth: number): [number, number] | null {
  const BIN = 2
  const cover = new Array<number>(Math.ceil(pageWidth / BIN) + 1).fill(0)
  for (const r of rects) {
    for (let b = Math.max(0, Math.floor(r.rect.origin.x / BIN)); b <= Math.min(cover.length - 1, Math.floor((r.rect.origin.x + r.rect.size.width) / BIN)); b++) cover[b] += r.rect.size.height
  }
  const peak = (from: number, to: number) => Math.max(...cover.slice(Math.floor((pageWidth * from) / BIN), Math.ceil((pageWidth * to) / BIN)))
  // Two columns are each covered all down the page; the strip between them by little more than captions
  const sides = Math.min(peak(0.1, 0.4), peak(0.6, 0.9))
  // A column is lines on lines; a lone centred caption beside nothing else is none
  if (sides < COLUMN_DEPTH) return null
  const thin = sides * 0.2
  const lo = Math.floor((pageWidth * 0.4) / BIN)
  const hi = Math.ceil((pageWidth * 0.6) / BIN)
  let best = lo
  for (let b = lo; b <= hi; b++) if (cover[b] < cover[best]) best = b
  if (cover[best] > thin) return null
  let left = best
  let right = best
  while (left > 0 && cover[left - 1] <= thin) left--
  while (right < cover.length - 1 && cover[right + 1] <= thin) right++
  // Narrower is the space between two words of one line
  if ((right + 1 - left) * BIN < GUTTER) return null
  return [left * BIN, (right + 1) * BIN]
}

// The page's gutter, or one near the destination: a float as wide as the page elsewhere on it fills the
// middle with its labels, while here a column runs beside the other
const gutterNear = (rects: PdfTextRectObject[], pageWidth: number, at: number) =>
  gutterOf(rects, pageWidth) ?? gutterOf(rects.filter((r) => Math.abs(middle(r) - at) < NEAR_GUTTER), pageWidth)

// A caption's lines: to the first gap wider than its own spacing; longer than a reference may run. A
// font's boxes can be taller than its lines are apart, so the gap is also read from line to line:
// wider than the page's usual step is the space after the caption.
export function captionOf(lines: Line[]): Line[] {
  const height = lines[0].bottom - lines[0].top
  // Read from lines set like the caption: a table's rows below may be set smaller and closer
  const step = Math.min(stepOf(lines.filter((l) => Math.abs(l.size - lines[0].size) < 0.5)), lines[1] ? lines[1].top - lines[0].top : Infinity)
  const out = [lines[0]]
  for (const line of lines.slice(1, MAX_CAPTION_LINES)) {
    const prev = out.at(-1)!
    if (line.top - prev.bottom > height * 0.6 || line.top - prev.top > step * 1.3) break
    out.push(line)
  }
  return out
}

// The most common distance from one line's top to the next one's, to the half point
function stepOf(lines: Line[]): number {
  const count = new Map<number, number>()
  for (let i = 1; i < lines.length; i++) {
    const step = Math.round((lines[i].top - lines[i - 1].top) * 2) / 2
    if (step > 0) count.set(step, (count.get(step) ?? 0) + 1)
  }
  let best = Infinity
  let most = 0
  for (const [step, n] of count) if (n > most || (n === most && step < best)) [best, most] = [step, n]
  return best
}

// A figure, table or algorithm: from the destination down to the end of its caption. An anchor on the
// caption itself leaves the float's other end to be found: a figure stands above its caption, below the
// nearest line of running text; a table or an algorithm runs below it to running text or a wide gap. A
// table's anchor may also sit under its caption, on the rows. The float is as wide as its column, or as
// the page when anything of it crosses the gutter.
function floatBox(rects: PdfTextRectObject[], pageWidth: number, at: number, below: boolean, x: number | undefined, named?: { kind: string; number: string }): Box {
  const all: [number, number] = [Math.min(...rects.map((r) => r.rect.origin.x)), Math.max(...rects.map((r) => r.rect.origin.x + r.rect.size.width))]
  const gutter = gutterNear(rects, pageWidth, at)
  const centre = gutter ? (gutter[0] + gutter[1]) / 2 : pageWidth / 2
  const leftSide = (r: PdfTextRectObject) => r.rect.origin.x < centre
  // On the destination's side of the page first: the other column's float may come sooner
  const sameSide = (r: PdfTextRectObject) => !gutter || x === undefined || leftSide(r) === x < centre
  const captions = rects.filter((r) => CAPTION.test(r.content))
  // The caption that names the linked float decides; the nearest one may be the float's before it
  const mine = named && captions.filter((r) => {
    const m = NUMBERED_CAPTION.exec(r.content)
    return m && m[1].toLowerCase() === named.kind && m[2] === named.number
  }).sort((a, b) => Math.abs(top(a) - at) - Math.abs(top(b) - at))[0]
  const above = mine ? (below && top(mine) <= at + CAPTION_AT ? mine : undefined) : below ? captions.filter((r) => top(r) >= at - CAPTION_ABOVE && top(r) <= at + CAPTION_AT && sameSide(r)).sort((a, b) => top(b) - top(a))[0] : undefined
  const caption = mine ?? above ?? captions.filter((r) => middle(r) > at).sort((a, b) => Number(!sameSide(a)) - Number(!sameSide(b)) || top(a) - top(b))[0]
  if (!caption) return { x: all[0] - PAD, y: at, w: all[1] - all[0] + 2 * PAD, h: FLOAT_HEIGHT }

  let column: [number, number] = gutter ? (leftSide(caption) ? [all[0], gutter[0]] : [gutter[1], all[1]]) : all
  // A caption whose own line runs on across the gutter belongs to a float as wide as the page
  if (gutter && leftSide(caption)) {
    let reach = caption.rect.origin.x + caption.rect.size.width
    for (const r of rects.filter((q) => Math.abs(middle(q) - middle(caption)) < caption.rect.size.height / 2).sort((a, b) => a.rect.origin.x - b.rect.origin.x)) {
      if (r.rect.origin.x >= reach - 1 && r.rect.origin.x - reach < 6) reach = Math.max(reach, r.rect.origin.x + r.rect.size.width)
    }
    if (reach > gutter[1]) column = all
  }
  const from = above ? top(caption) : Math.min(at, top(caption))
  const lines = linesOf(inColumn(rects, column))
  const body = bodySize(linesOf(rects))
  // From the caption's own line: a figure's label just above can have a box that reaches into it
  const captionLines = lines.filter((l) => (l.top + l.bottom) / 2 > top(caption))
  const end = captionLines.length ? captionOf(captionLines).at(-1)!.bottom : bottom(caption)

  let y: number
  let bottomEdge = end
  if (top(caption) - at > CAPTION_AT && !above) y = at
  else if (below) {
    y = from
    let last = end
    const algorithm = /^\s*alg/i.test(caption.content)
    for (const line of lines.filter((l) => l.top >= end)) {
      // An algorithm's steps run the column's width like running text, but are numbered or open with a keyword
      const running = isRunning(line, column, body) && !(algorithm && ALGORITHM_LINE.test(line.text))
      // A section heading set larger than the text is no row of a table
      const heading = body !== undefined && line.size > body + 0.5 && NUMBERED_HEADING.test(line.text)
      // The first gap may be the one between the caption and the rows
      if (running || heading || CAPTION.test(line.text) || (line.top - last > FLOAT_GAP && last > end)) break
      last = line.bottom
    }
    bottomEdge = last
  } else {
    const text = lines.filter((l) => l.bottom <= top(caption) && isRunning(l, column, body)).at(-1)
    y = text ? text.bottom + PAD : Math.min(...rects.map(top)) - PAD
  }
  // Anything of the float across the gutter: it spans both columns
  if (gutter && column !== all && rects.some((r) => middle(r) > y && middle(r) < bottomEdge && r.rect.origin.x < gutter[0] && r.rect.origin.x + r.rect.size.width > gutter[1])) column = all
  return { x: column[0] - PAD, y: y - PAD, w: column[1] - column[0] + 2 * PAD, h: bottomEdge - y + 2 * PAD }
}

// A block of a line or two that is a heading: numbered ("3.2.1 Training", "A.1 Reflection Tokens.", "I
// Implementation Details."), or not ending like a sentence. A footnote opens with its raised number and
// is none; nor is a reference cut off at the page's foot, whose first line runs to the text's edge.
const isHeading = (block: Line[], edge: number) => {
  const first = block[0].text
  const last = block.at(-1)!.text
  if (block.length > 2 || block[0].marked) return false
  if (NUMBERED_HEADING.test(first) || LETTER_HEADING.test(first)) return true
  return block.length === 1 || edge - block[0].right > SHORT_LINE ? !SENTENCE_END.test(last) && !ENDS_IN_LINK.test(last) : false
}

// A heading with what follows it: the blocks after it up to the first one of running text, of which the
// opening lines ("4 Results" over "4.1 Setup" over the start of its paragraph)
export function sectionOf(lines: Line[]): Line[] {
  const out: Line[] = []
  let rest = lines
  const edge = Math.max(...lines.map((l) => l.right))
  while (rest.length && out.length < MAX_LINES) {
    const block = entryOf(rest)
    const heading = isHeading(block, edge)
    out.push(...(heading ? block : block.slice(0, AFTER_HEADING)))
    if (!heading) break
    rest = rest.slice(block.length)
  }
  return out.slice(0, MAX_LINES)
}

// A displayed equation: the line the anchor is on, and the lines above and below it that are part of the
// same display, close by and not running text. The anchor sits on the numbered line, which is often the
// last of a long equation.
export function equationOf(lines: Line[], at: number, column: [number, number]): Line[] {
  const i = lines.findIndex((l) => (l.top + l.bottom) / 2 > at)
  if (i < 0) return []
  // A fraction's numerator and denominator read as lines of their own, further apart than text's
  const reach = 3 * (lines[i].bottom - lines[i].top)
  if (isRunning(lines[i], column)) return [lines[i]]
  // Words ("where x is…") or a heading end the display; so does another equation's number
  const wordy = (l: Line) => (l.text.match(WORD)?.length ?? 0) >= 4
  let from = i
  let to = i
  while (from > 0 && to - from + 1 < MAX_EQUATION_LINES && !wordy(lines[from - 1]) && !EQUATION_NUMBER.test(lines[from - 1].text) && lines[from].top - lines[from - 1].bottom <= reach) from--
  while (!EQUATION_NUMBER.test(lines[to].text) && to + 1 < lines.length && to - from + 1 < MAX_EQUATION_LINES && !wordy(lines[to + 1]) && lines[to + 1].top - lines[to].bottom <= reach) to++
  return lines.slice(from, to + 1)
}

// Lines that tell where a column's text starts: a running head above the text stands apart by a wide gap
function bodyFrom(lines: Line[]): Line[] {
  let start = 0
  while (start < Math.min(2, lines.length - 1) && lines[start + 1].top - lines[start].bottom > lines[start].bottom - lines[start].top) start++
  return lines.slice(start)
}

// The rest of an entry that a column's foot cut off, from the top of the next column: the lines at the
// list's hanging indent, up to the next entry back at the margin. A next column that opens at the margin
// opens with another entry, or with something else (a heading, a figure), and continues nothing.
export function continuationOf(lines: Line[], room: number): Line[] {
  const body = bodyFrom(lines)
  if (!body.length) return []
  const margin = Math.min(...body.map((l) => l.x))
  if (body[0].x - margin <= 2 || ENTRY_NUMBER.test(body[0].text)) return []
  const height = body[0].bottom - body[0].top
  const rest = [body[0]]
  for (const line of body.slice(1, room)) {
    const prev = rest.at(-1)!
    if (line.top - prev.bottom > height * 0.6 || ENTRY_NUMBER.test(line.text) || line.x - margin < 1.5) break
    rest.push(line)
  }
  return rest
}

const boxOf = (lines: Line[], all: Line[], column: [number, number]): Box => {
  const first = lines[0]
  const last = lines.at(-1)!
  // Tight leading puts the lines either side within PAD: the cut stops halfway, never on a sliver of them
  const next = all[all.indexOf(last) + 1]
  const before = all[all.indexOf(first) - 1]
  const end = next ? Math.min(last.bottom + PAD, (last.bottom + next.top) / 2) : last.bottom + PAD
  const y = Math.max(first.top - PAD, before ? (before.bottom + first.top) / 2 : -Infinity)
  return { x: column[0] - PAD, y, w: column[1] - column[0] + 2 * PAD, h: end - y }
}

function equationBox(rects: PdfTextRectObject[], pageWidth: number, at: number, x: number | undefined): Box | null {
  const column = columnOf(
    rects.filter((r) => Math.abs(middle(r) - at) < BAND / 2),
    pageWidth,
    x,
  )
  const lines = linesOf(inColumn(rects, column))
  const equation = equationOf(lines, at, column)
  return equation.length ? boxOf(equation, lines, column) : null
}

// An entry or a heading: its lines in the destination's column. An entry that ends mid-sentence
// at the column's foot goes on at the top of the next column, or of the next page's first one.
async function textBoxes(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number, rects: PdfTextRectObject[], at: number, x: number | undefined): Promise<PreviewBox[]> {
  const page = doc.pages[pageIndex]
  // By the text's middle: hyperref raises its anchors a line above the target, so the line before it
  // reaches just past the destination
  const below = rects.filter((r) => middle(r) > at)
  const column = columnOf(
    below.filter((r) => middle(r) < at + BAND),
    page.size.width,
    x,
  )
  const lines = linesOf(inColumn(below, column))
  if (!lines.length) return []
  let entry = entryOf(lines)
  const section = isHeading(entry, Math.max(...lines.map((l) => l.right)))
  if (section) entry = sectionOf(lines)
  const boxes = [{ pageIndex, ...boxOf(entry, lines, column) }]

  const last = entry.at(-1)!
  const next = lines[lines.indexOf(last) + 1]
  const height = last.bottom - last.top
  // Nothing below in the column but a page number or a footer
  const atFoot = !next || (next.top - last.bottom > height && lines.slice(lines.indexOf(last) + 1).every((l) => l.right - l.x < (column[1] - column[0]) / 3))
  // Only an entry of a list runs on: numbered, or its second line hung under its first; and a section
  // whose opening lines a column's foot cut off. A footnote or a paragraph at the foot is whole where it
  // stops, and the next column's indent is a paragraph's.
  const listed = ENTRY_NUMBER.test(entry[0].text) || (entry.length > 1 && entry[1].x - entry[0].x > 2)
  if (!(listed || section) || entry.length >= MAX_LINES || !atFoot || endsSentence(last.text) || endsInLink(last.text)) return boxes
  const room = MAX_LINES
  // A section's paragraph runs on from the next column's first line, at its margin
  const restOf = (all: Line[]) => (section ? entryOf(bodyFrom(all)).slice(0, Math.min(AFTER_HEADING, MAX_LINES - entry.length)) : continuationOf(all, room))
  // The right column of this page, else the next page's first column
  const right = rects.filter((r) => r.rect.origin.x > column[1] + GUTTER / 2)
  if (column[1] < page.size.width / 2 + GUTTER && right.length) {
    const col = columnOf(right, page.size.width, column[1] + GUTTER)
    const all = linesOf(inColumn(right, col))
    const rest = all.length ? restOf(all) : []
    if (rest.length) boxes.push({ pageIndex, ...boxOf(rest, all, col) })
    return boxes
  }
  if (pageIndex + 1 >= doc.pageCount) return boxes
  const nextRects = await pageText(engine, doc, pageIndex + 1)
  if (!nextRects.length) return boxes
  const col = columnOf(nextRects.filter((r) => top(r) < BAND), doc.pages[pageIndex + 1].size.width, undefined)
  const all = linesOf(inColumn(nextRects, col))
  const rest = all.length ? restOf(all) : []
  if (rest.length) boxes.push({ pageIndex: pageIndex + 1, ...boxOf(rest, all, col) })
  return boxes
}

// Below this in any channel a pixel is ink: a chart's pale fills count, the page's white does not
const INK = 245

// A float's sides widened to its drawing: a figure drawn in paths or as an image has no text, so its axes
// and panels can stand wider than its caption and labels. Read from the band rendered at a pixel a point,
// out from the box's edges until a blank strip as wide as a gutter.
async function inkWide(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number, box: Box, gutter: [number, number] | null): Promise<Box> {
  const page = doc.pages[pageIndex]
  const y = Math.max(0, box.y)
  const h = Math.min(page.size.height, box.y + box.h) - y
  if (h <= 0) return box
  const band = { origin: { x: 0, y }, size: { width: page.size.width, height: h } }
  const image = await engine.renderPageRectRaw(doc, page, band, { scaleFactor: 1, dpr: 1 }).toPromise().catch(() => null)
  if (!image) return box
  const { data, width, height } = image
  const perPoint = width / page.size.width
  const inked = Array.from({ length: width }, (_, col) => {
    for (let row = 0; row < height; row++) {
      const i = (row * width + col) * 4
      if (data[i + 3] > 128 && (data[i] < INK || data[i + 1] < INK || data[i + 2] < INK)) return true
    }
    return false
  })
  const reach = (from: number, step: number) => {
    let edge = from
    let blank = 0
    for (let col = from + step; col >= 0 && col < width; col += step) {
      if (inked[col]) [edge, blank] = [col, 0]
      else if (++blank > GUTTER * perPoint) break
    }
    return edge
  }
  // A float in one column of two widens no further than the gutter's middle: past it is the other
  // column's text, whose words stand closer than any gutter
  const centre = gutter ? (gutter[0] + gutter[1]) / 2 : undefined
  const oneColumn = centre !== undefined && (box.x + box.w <= gutter![1] || box.x >= gutter![0])
  const [from, to] = oneColumn ? (box.x + box.w / 2 < centre ? [0, centre] : [centre, page.size.width]) : [0, page.size.width]
  const left = Math.max(0, Math.floor(box.x * perPoint))
  const right = Math.min(width - 1, Math.ceil((box.x + box.w) * perPoint))
  const x = Math.min(box.x, Math.max(from, reach(left, -1) / perPoint - PAD))
  return { ...box, x, w: Math.max(box.x + box.w, Math.min(to, (reach(right, 1) + 1) / perPoint + PAD)) - x }
}

async function previewBoxes(engine: PdfEngine, doc: PdfDocumentObject, link: PageLink): Promise<PreviewBox[]> {
  const { destination } = link
  const page = doc.pages[destination.pageIndex]
  // Fit modes name a page, not a place on it; a rotated page would need its rects rotated
  if (!page || page.rotation !== 0 || destination.zoom.mode !== PdfZoomMode.XYZ) return []
  const { x, y } = destination.zoom.params
  if (!(y > 0)) return []
  // Destinations are in PDF user space (origin bottom-left); text rects are from the top-left
  const at = page.size.height - y
  const [rects, words] = await Promise.all([pageText(engine, doc, destination.pageIndex), linkWords(engine, doc, link).catch(() => "")])
  if (!rects.length) return []

  const { pageIndex } = destination
  const float = FLOAT_LINK.exec(words)
  // A float named by its number alone ("summarized in 1.") still has its caption at the target
  const caption = float ? undefined : rects.find((r) => middle(r) > at && top(r) - at < CAPTION_AT && CAPTION.test(r.content))
  let boxes: PreviewBox[]
  if (float || caption) {
    const number = float && LINKED_NUMBER.exec(words)?.[1]
    const named = float && number ? { kind: float[1].slice(0, 3).toLowerCase(), number } : undefined
    const box = floatBox(rects, page.size.width, at, /^\s*(tab|alg)/i.test(float ? float[1] : caption!.content), x > 0 ? x : undefined, named)
    boxes = [{ pageIndex, ...(await inkWide(engine, doc, pageIndex, box, gutterNear(rects, page.size.width, at))) }]
  }
  else if (EQUATION_LINK.test(words)) {
    const box = equationBox(rects, page.size.width, at, x > 0 ? x : undefined)
    boxes = box ? [{ pageIndex, ...box }] : []
  } else boxes = await textBoxes(engine, doc, pageIndex, rects, at, x > 0 ? x : undefined)
  return boxes.map((b) => {
    const size = doc.pages[b.pageIndex].size
    const bx = Math.max(0, b.x)
    const by = Math.max(0, b.y)
    return { pageIndex: b.pageIndex, x: bx, y: by, w: Math.min(size.width, b.x + b.w) - bx, h: Math.min(size.height, b.y + b.h) - by }
  })
}

// The preview's largest on screen, so a full-width reference list or a figure still fits beside the text
const MAX_WIDTH = 512
const MAX_HEIGHT = 520

// One piece of the preview: a box and its image
export interface PreviewPart {
  box: PreviewBox
  // The image's size on screen, in CSS pixels
  width: number
  height: number
  url: string
}

// One per link and zoom for the document's life: the boxes take tens of milliseconds, the drawing far
// longer while the reader draws its own pages, so it is started as the pointer arrives and is ready, or
// nearly, when the card opens
const made = new WeakMap<PdfDestinationObject, Map<number, Promise<PreviewPart[]>>>()

// The destination's part of its page at the reader's own zoom, so its words are the size being read,
// made smaller to fit MAX_WIDTH × MAX_HEIGHT; two parts when an entry runs on into the next column. Empty
// when the destination has no place to show.
export function linkPreview(engine: PdfEngine, doc: PdfDocumentObject, link: PageLink, zoom: number): Promise<PreviewPart[]> {
  let byZoom = made.get(link.destination)
  if (!byZoom) made.set(link.destination, (byZoom = new Map()))
  let preview = byZoom.get(zoom)
  if (!preview) {
    preview = (async () => {
      const boxes = await previewBoxes(engine, doc, link)
      if (!boxes.length) return []
      const scale = Math.min(zoom, MAX_WIDTH / Math.max(...boxes.map((b) => b.w)), MAX_HEIGHT / boxes.reduce((h, b) => h + b.h, 0))
      return Promise.all(
        boxes.map(async (box) => {
          const blob = await engine
            .renderPageRect(doc, doc.pages[box.pageIndex], { origin: { x: box.x, y: box.y }, size: { width: box.w, height: box.h } }, { scaleFactor: scale, dpr: window.devicePixelRatio })
            .toPromise()
          return { box, width: box.w * scale, height: box.h * scale, url: URL.createObjectURL(blob) }
        }),
      )
    })().catch(() => [])
    byZoom.set(zoom, preview)
  }
  return preview
}
