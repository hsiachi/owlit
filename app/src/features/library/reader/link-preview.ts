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
  top: number
  bottom: number
  text: string
}

// How far below the destination the lines are read, in PDF points: more than any one entry runs
const BAND = 200
// Room around the lines, so no glyph touches the card's edge
const PAD = 3
// A preview never runs longer than this many lines; a longer entry is cut, a click shows the rest
const MAX_LINES = 8
// Lines after a lone first line (a heading), so "Section 3" shows what the section opens with
const AFTER_HEADING = 4
// How much of the page a figure or table takes when its caption doesn't say where it ends, in PDF points
const FLOAT_HEIGHT = 240
// How far below the destination a figure's caption is looked for: a figure seldom fills more of a page
const CAPTION_REACH = 560
// A caption this close under the destination is where the anchor sits, not below a figure
const CAPTION_AT = 24
// The narrowest blank strip down the middle of the page that reads as the gutter between two columns
const GUTTER = 8
// A numbered entry's own number opens its first line: "[12]", "12."
const ENTRY_NUMBER = /^\s*(\[\d+[a-z]?\]|\d+\.)\s/
// A caption's opening words
const CAPTION = /^\s*(fig(ure)?|tab(le)?)\.?\s*[A-Z]?\d/i
// The words before a link's number that make it a figure's or table's: "Figure 2", "Tab. 3"; with \ref
// only the number is the link, so the words before it are read too
const FLOAT_LINK = /(fig(ure)?s?|tab(le)?s?)\.?\s*~?\s*[A-Z]?\d*\s*$/i
// How many characters before the link are read for those words
const LINK_LEAD = 12

const textRead = new WeakMap<PdfDocumentObject, Map<number, Promise<PdfTextRectObject[]>>>()

function pageText(engine: PdfEngine, doc: PdfDocumentObject, pageIndex: number): Promise<PdfTextRectObject[]> {
  let byPage = textRead.get(doc)
  if (!byPage) textRead.set(doc, (byPage = new Map()))
  let rects = byPage.get(pageIndex)
  if (!rects) {
    // A page whose text does not read gets the float-sized cut
    rects = engine
      .getPageTextRects(doc, doc.pages[pageIndex])
      .toPromise()
      .then((all) => all.filter((r) => r.content.trim()))
      .catch(() => [])
    byPage.set(pageIndex, rects)
  }
  return rects
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

// Text rects into lines, top to bottom: rects that overlap vertically are one line
export function linesOf(rects: PdfTextRectObject[]): Line[] {
  const lines: Line[] = []
  for (const r of [...rects].sort((a, b) => top(a) - top(b) || a.rect.origin.x - b.rect.origin.x)) {
    const line = lines.at(-1)
    if (line && top(r) < line.bottom - r.rect.size.height / 2) {
      line.bottom = Math.max(line.bottom, bottom(r))
      if (r.rect.origin.x < line.x) {
        line.x = r.rect.origin.x
        line.text = `${r.content} ${line.text}`
      } else line.text = `${line.text} ${r.content}`
    } else lines.push({ x: r.rect.origin.x, top: top(r), bottom: bottom(r), text: r.content })
  }
  return lines
}

// The lines of one entry, from the first: it ends at a wider gap than the lines' own spacing, at a line
// that starts a new entry (its own number, or back at the first line's x after an indented second line),
// or at MAX_LINES
export function entryOf(lines: Line[]): Line[] {
  const [first, second] = lines
  const height = first.bottom - first.top
  const hanging = second !== undefined && second.x - first.x > 2
  const entry = [first]
  for (const line of lines.slice(1)) {
    const prev = entry.at(-1)!
    if (line.top - prev.bottom > height * 0.6) break
    if (ENTRY_NUMBER.test(line.text) || (hanging && Math.abs(line.x - first.x) < 1.5)) break
    entry.push(line)
    if (entry.length === MAX_LINES) break
  }
  return entry
}

type Box = Omit<PreviewBox, "pageIndex">

// A figure or table: from the destination down to the end of its caption. An anchor on the caption itself
// leaves the float's other end unknown: a figure is above its caption, a table below.
function floatBox(rects: PdfTextRectObject[], pageWidth: number, at: number, table: boolean): Box {
  const all: [number, number] = [Math.min(...rects.map((r) => r.rect.origin.x)), Math.max(...rects.map((r) => r.rect.origin.x + r.rect.size.width))]
  const caption = rects.filter((r) => middle(r) > at && top(r) < at + CAPTION_REACH && CAPTION.test(r.content)).sort((a, b) => top(a) - top(b))[0]
  if (!caption) return { x: all[0] - PAD, y: at, w: all[1] - all[0] + 2 * PAD, h: FLOAT_HEIGHT }
  const near = rects.filter((r) => middle(r) > top(caption) - 1 && top(r) < top(caption) + BAND)
  const column = columnOf(near, pageWidth, caption.rect.origin.x)
  const lines = linesOf(inColumn(near, column))
  const end = entryOf(lines).at(-1)!.bottom
  const x = column[0] - PAD
  const w = column[1] - column[0] + 2 * PAD
  if (top(caption) - at > CAPTION_AT) return { x, y: at, w, h: end - at + PAD }
  if (table) return { x, y: top(caption) - PAD, w, h: FLOAT_HEIGHT }
  return { x, y: top(caption) - FLOAT_HEIGHT, w, h: FLOAT_HEIGHT + end - top(caption) + PAD }
}

// An entry, a heading or an equation: its lines in the destination's column
function textBox(band: PdfTextRectObject[], pageWidth: number, at: number, x: number | undefined): Box | null {
  const column = columnOf(band, pageWidth, x)
  const lines = linesOf(inColumn(band, column))
  if (!lines.length) return null
  let entry = entryOf(lines)
  if (entry.length === 1 && lines.length > 1) entry = [entry[0], ...entryOf(lines.slice(1)).slice(0, AFTER_HEADING)]
  const first = entry[0]
  return { x: column[0] - PAD, y: Math.max(at, first.top - PAD), w: column[1] - column[0] + 2 * PAD, h: entry.at(-1)!.bottom - first.top + 2 * PAD }
}

async function previewBox(engine: PdfEngine, doc: PdfDocumentObject, link: PageLink): Promise<PreviewBox | null> {
  const { destination } = link
  const page = doc.pages[destination.pageIndex]
  // Fit modes name a page, not a place on it; a rotated page would need its rects rotated
  if (!page || page.rotation !== 0 || destination.zoom.mode !== PdfZoomMode.XYZ) return null
  const { x, y } = destination.zoom.params
  if (!(y > 0)) return null
  // Destinations are in PDF user space (origin bottom-left); text rects are from the top-left
  const at = page.size.height - y
  const [rects, words] = await Promise.all([pageText(engine, doc, destination.pageIndex), linkWords(engine, doc, link).catch(() => "")])
  if (!rects.length) return null

  const float = FLOAT_LINK.exec(words)
  let box: Box | null
  if (float) box = floatBox(rects, page.size.width, at, /^tab/i.test(float[1]))
  else {
    // By the text's middle: hyperref raises its anchors a line above the target, so the line before it
    // reaches just past the destination
    const band = rects.filter((r) => middle(r) > at && middle(r) < at + BAND)
    box = band.length ? textBox(band, page.size.width, at, x > 0 ? x : undefined) : null
  }
  if (!box) return null
  const bx = Math.max(0, box.x)
  const by = Math.max(0, box.y)
  return { pageIndex: destination.pageIndex, x: bx, y: by, w: Math.min(page.size.width, box.x + box.w) - bx, h: Math.min(page.size.height, box.y + box.h) - by }
}

// The preview's largest on screen, so a full-width reference list or a figure still fits beside the text
const MAX_WIDTH = 512
const MAX_HEIGHT = 400

export interface Preview {
  box: PreviewBox
  // The image's size on screen, in CSS pixels
  width: number
  height: number
  url: string
}

// One per link and zoom for the document's life: the box takes tens of milliseconds, the drawing far
// longer while the reader draws its own pages, so it is started as the pointer arrives and is ready, or
// nearly, when the card opens
const made = new WeakMap<PdfDestinationObject, Map<number, Promise<Preview | null>>>()

// The destination's part of its page at the reader's own zoom, so its words are the size being read,
// made smaller to fit MAX_WIDTH × MAX_HEIGHT. null when the destination has no place to show.
export function linkPreview(engine: PdfEngine, doc: PdfDocumentObject, link: PageLink, zoom: number): Promise<Preview | null> {
  let byZoom = made.get(link.destination)
  if (!byZoom) made.set(link.destination, (byZoom = new Map()))
  let preview = byZoom.get(zoom)
  if (!preview) {
    preview = (async () => {
      const box = await previewBox(engine, doc, link)
      if (!box) return null
      const scale = Math.min(zoom, MAX_WIDTH / box.w, MAX_HEIGHT / box.h)
      const blob = await engine
        .renderPageRect(doc, doc.pages[box.pageIndex], { origin: { x: box.x, y: box.y }, size: { width: box.w, height: box.h } }, { scaleFactor: scale, dpr: window.devicePixelRatio })
        .toPromise()
      return { box, width: box.w * scale, height: box.h * scale, url: URL.createObjectURL(blob) }
    })().catch(() => null)
    byZoom.set(zoom, preview)
  }
  return preview
}
