import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium"
import type { PaperText, Rect, TextBlock, TextLine, TextPage } from "@owlit/protocol"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// A PDF's text layer, as lines with where they sit, grouped into blocks (paragraphs, headings) in the
// order the file draws them, which for typeset papers is reading order, column by column. pdfium does
// the reading; this decides lines and blocks. It runs in core's own thread and gives way after every
// page, so a long book never holds core up for more than a page's worth of work.

// Pages with fewer characters than this on average have no real text layer: a scan
const OCR_THRESHOLD = 20

let pdfium: Promise<WrappedPdfiumModule> | undefined

// pdfium, loaded once. The desktop app passes the wasm it ships beside main; elsewhere it comes from
// the package.
export function loadPdfium(wasmPath?: string) {
  pdfium ??= (async () => {
    const file = wasmPath ?? fileURLToPath(import.meta.resolve("@embedpdf/pdfium/pdfium.wasm"))
    const module = await init({ wasmBinary: await readFile(file) } as never)
    module.PDFiumExt_Init()
    module.FPDF_InitLibrary()
    return module
  })()
  return pdfium
}

// A file pdfium can't open (encrypted, damaged)
export class UnreadablePdf extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnreadablePdf"
  }
}

interface Char {
  code: number
  generated: boolean
  hyphen: boolean
  size: number
  bold: boolean
  // Loose box (font ascent to descent), top-left origin
  left: number
  top: number
  right: number
  bottom: number
}

interface Line extends TextLine {
  size: number
  bold: boolean
}

export interface ReadOptions {
  wasmPath?: string
  signal?: AbortSignal
  onPage?: (done: number, total: number) => void
  // Only the first pages (what identifying a dropped file needs)
  maxPages?: number
}

// What the file says about itself (its Info dictionary), often empty or a word processor's leftovers
export interface PdfMeta {
  title?: string
  author?: string
}

export async function extractText(bytes: Uint8Array, options: ReadOptions = {}): Promise<PaperText> {
  return (await readPdf(bytes, options)).text
}

export async function readPdf(bytes: Uint8Array, options: ReadOptions = {}): Promise<{ text: PaperText; meta: PdfMeta; pageCount: number }> {
  const m = await loadPdfium(options.wasmPath)
  const ptr = m.pdfium.wasmExports.malloc(bytes.length)
  // Emscripten's heap view; the package's types leave it out
  ;(m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, ptr)
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "")
  if (!doc) {
    m.pdfium.wasmExports.free(ptr)
    throw new UnreadablePdf(m.FPDF_GetLastError() === 4 ? "The PDF is password-protected." : "The PDF can't be read.")
  }
  const box = m.pdfium.wasmExports.malloc(16)
  const nameBuffer = m.pdfium.wasmExports.malloc(128)
  const pages: { index: number; width: number; height: number; lines: Line[] }[] = []
  let meta: PdfMeta = {}
  let count = 0
  try {
    count = m.FPDF_GetPageCount(doc)
    meta = { title: metaText(m, doc, "Title"), author: metaText(m, doc, "Author") }
    const last = Math.min(count, options.maxPages ?? count)
    for (let index = 0; index < last; index++) {
      options.signal?.throwIfAborted()
      const page = m.FPDF_LoadPage(doc, index)
      if (!page) continue
      const width = m.FPDF_GetPageWidthF(page)
      const height = m.FPDF_GetPageHeightF(page)
      const text = m.FPDFText_LoadPage(page)
      const chars: Char[] = []
      const n = text ? m.FPDFText_CountChars(text) : 0
      for (let i = 0; i < n; i++) {
        m.FPDFText_GetLooseCharBox(text, i, box)
        // FS_RECTF: left, top, right, bottom as floats, PDF space (origin bottom-left)
        const [left, top, right, bottom] = [0, 4, 8, 12].map((o) => m.pdfium.getValue(box + o, "float"))
        chars.push({
          code: m.FPDFText_GetUnicode(text, i),
          generated: m.FPDFText_IsGenerated(text, i) === 1,
          hyphen: m.FPDFText_IsHyphen(text, i) === 1,
          size: m.FPDFText_GetFontSize(text, i),
          bold: isBold(m, text, i, nameBuffer),
          left,
          top: height - top,
          right,
          bottom: height - bottom,
        })
      }
      if (text) m.FPDFText_ClosePage(text)
      m.FPDF_ClosePage(page)
      pages.push({ index, width, height, lines: toLines(chars) })
      options.onPage?.(index + 1, last)
      // Give way between pages
      await new Promise((resolve) => setImmediate(resolve))
    }
  } finally {
    m.pdfium.wasmExports.free(box)
    m.pdfium.wasmExports.free(nameBuffer)
    m.FPDF_CloseDocument(doc)
    m.pdfium.wasmExports.free(ptr)
  }

  const body = bodySize(pages.flatMap((p) => p.lines))
  const characters = pages.reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.text.replace(/\s/g, "").length, 0), 0)
  const result: PaperText = {
    version: 1,
    source: "pdfium",
    pages: pages.map(({ index, width, height, lines }): TextPage => ({ index, width, height, blocks: toBlocks(lines, body, width, index) })),
  }
  if (characters < OCR_THRESHOLD * Math.max(1, pages.length)) result.needsOcr = true
  return { text: result, meta, pageCount: count }
}

// One entry of the Info dictionary, as UTF-16LE pdfium hands back
function metaText(m: WrappedPdfiumModule, doc: number, tag: string) {
  const length = m.FPDF_GetMetaText(doc, tag, 0, 0)
  if (length <= 2) return undefined
  const buffer = m.pdfium.wasmExports.malloc(length)
  try {
    m.FPDF_GetMetaText(doc, tag, buffer, length)
    return m.pdfium.UTF16ToString(buffer).trim() || undefined
  } finally {
    m.pdfium.wasmExports.free(buffer)
  }
}

// The font's weight, or its name when the weight isn't given (the standard fonts: Helvetica-Bold)
function isBold(m: WrappedPdfiumModule, text: number, index: number, nameBuffer: number) {
  const weight = m.FPDFText_GetFontWeight(text, index)
  if (weight > 0) return weight >= 600
  const length = m.FPDFText_GetFontInfo(text, index, nameBuffer, 128, 0)
  return length > 1 && /bold|black|heavy|semibold|demi/i.test(m.pdfium.UTF8ToString(nameBuffer))
}

// Lines as pdfium breaks them (it inserts \r\n where a line ends)
function toLines(chars: Char[]): Line[] {
  const lines: Line[] = []
  let current: Char[] = []
  const flush = () => {
    const shown = current.filter((c) => !c.generated && c.code > 0x20 && c.right > c.left)
    if (shown.length) {
      let text = ""
      for (const c of current) {
        if (c.code === 0x0d || c.code === 0x0a) continue
        if (c.code === 0x09 || c.code === 0x20 || c.code === 0xa0) text += text.endsWith(" ") ? "" : " "
        // A hyphen that only breaks a word across lines stays a soft hyphen, so it can be mended
        else if (c.code === 0x02 || c.hyphen) text += "\u00ad"
        else if (c.code >= 0x20) text += String.fromCodePoint(c.code)
      }
      const left = Math.min(...shown.map((c) => c.left))
      const top = Math.min(...shown.map((c) => c.top))
      const right = Math.max(...shown.map((c) => c.right))
      const bottom = Math.max(...shown.map((c) => c.bottom))
      lines.push({
        text: text.trim(),
        rect: round({ x: left, y: top, w: right - left, h: bottom - top }),
        size: median(shown.map((c) => c.size)),
        bold: shown.filter((c) => c.bold).length > shown.length / 2,
      })
    }
    current = []
  }
  for (const c of chars) {
    if (c.code === 0x0d || c.code === 0x0a) {
      if (current.length) flush()
      continue
    }
    current.push(c)
  }
  flush()
  return joinSameRow(lines.filter((l) => l.text))
}

// pdfium breaks a line where the baseline jumps (a superscript, a footnote mark, an inline formula);
// a piece on the same row, to the right of the last, goes back into it
function joinSameRow(lines: Line[]): Line[] {
  const joined: Line[] = []
  for (const line of lines) {
    const prev = joined.at(-1)
    if (prev && sameRow(prev.rect, line.rect) && line.rect.x >= prev.rect.x + prev.rect.w - prev.size * 0.5) {
      const big = prev.size >= line.size ? prev : line
      joined[joined.length - 1] = {
        text: `${prev.text}${line.rect.x - (prev.rect.x + prev.rect.w) > prev.size * 0.15 ? " " : ""}${line.text}`,
        rect: round(union([prev.rect, line.rect])),
        size: big.size,
        bold: big.bold,
      }
    } else joined.push(line)
  }
  return joined
}

function sameRow(a: Rect, b: Rect) {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlap > Math.min(a.h, b.h) * 0.5
}

// Consecutive lines that belong together: same size, close below one another, in the same column. A
// new paragraph starts at a gap, a change of size, a jump to another column, or an indented line
// after a short one.
function toBlocks(lines: Line[], body: number, pageWidth: number, pageIndex: number): TextBlock[] {
  const blocks: { lines: Line[]; size: number }[] = []
  for (const line of lines) {
    const block = blocks.at(-1)
    const prev = block?.lines.at(-1)
    if (!block || !prev || breaksAt(block.lines, prev, line, block.size)) {
      blocks.push({ lines: [line], size: line.size })
      continue
    }
    block.lines.push(line)
  }
  // Where the columns start: the left edges of the page's real paragraphs
  const paragraphs = blocks.filter((b) => b.lines.length >= 3)
  const margins = paragraphs.map((b) => Math.min(...b.lines.map((l) => l.rect.x)))
  const columnWidth = median(paragraphs.map((b) => union(b.lines.map((l) => l.rect)).w))
  return blocks.map(({ lines, size }, i) => {
    const rect = round(union(lines.map((l) => l.rect)))
    let kind = kindOf(lines, size, body)
    // A bold heading is shorter than the column; a bold line that fills it is emphasis in the text
    if (kind === "heading" && size < body * 1.15 && columnWidth && rect.w > columnWidth * 0.8) kind = "paragraph"
    // Text set sideways (an arXiv stamp in the margin)
    if (lines.every((l) => l.rect.h > l.rect.w * 1.5 && l.text.length > 3)) kind = "other"
    // A heading starts a column or is centred; big words elsewhere are a figure's labels
    if (kind === "heading" && margins.length) {
      const atMargin = margins.some((m) => Math.abs(rect.x - m) < 6)
      const centred = Math.abs(rect.x + rect.w / 2 - pageWidth / 2) < 24
      if (!atMargin && !centred) kind = "other"
    }
    // A heading leads into text: it is numbered, or something of more than one line follows it, or it
    // is on the first page (title, authors). A label inside a figure or a bold table row is not.
    if (kind === "heading" && pageIndex > 0 && !/^(\d+(\.\d+)*|[A-Z]|[IVX]+)\.?\s/.test(lines[0].text) && (blocks[i + 1]?.lines.length ?? 0) < 2) {
      kind = "other"
    }
    return { kind, rect, lines: lines.map(({ text, rect }) => ({ text, rect })) }
  })
}

function breaksAt(block: Line[], prev: Line, line: Line, size: number) {
  if (Math.abs(line.size - size) > size * 0.15) return true
  // Each item of a list is its own block
  if (/^[•◦▪‣∙·]\s?/.test(line.text)) return true
  if (line.bold !== prev.bold && (line.bold || prev.bold) && block.length <= 2) return true
  const gap = line.rect.y - (prev.rect.y + prev.rect.h)
  if (gap > prev.rect.h * 0.8 || gap < -prev.rect.h * 1.5) return true
  // A different column: no horizontal overlap with the block so far
  const left = Math.min(...block.map((l) => l.rect.x))
  const right = Math.max(...block.map((l) => l.rect.x + l.rect.w))
  if (line.rect.x > right || line.rect.x + line.rect.w < left) return true
  // An indented line after a short one starts a paragraph
  const indented = line.rect.x - left > size * 0.8
  const prevShort = prev.rect.x + prev.rect.w < right - size * 2
  return indented && prevShort
}

function kindOf(lines: Line[], size: number, body: number): TextBlock["kind"] {
  const text = lines.map((l) => l.text).join(" ")
  if (lines.length <= 4 && size >= body * 1.15) return "heading"
  if (lines.length <= 2 && lines.every((l) => l.bold) && text.length < 90 && !/[.:,;]$/.test(text)) return "heading"
  return "paragraph"
}

// The size most of the text is set in
function bodySize(lines: Line[]) {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2
    weight.set(size, (weight.get(size) ?? 0) + line.text.length)
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

const round = (r: Rect): Rect => ({ x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h) })
const r2 = (v: number) => Math.round(v * 100) / 100

// The same text as Markdown for agents and search: <!-- page N --> before each page, headings as ##,
// paragraphs joined into one line each, words broken across lines mended (a soft hyphen goes, a real
// one stays without a space: "state-of-the-" + "art")
export function toMarkdown(text: PaperText): string {
  const parts: string[] = []
  for (const page of text.pages) {
    parts.push(`<!-- page ${page.index + 1} -->`)
    for (const block of page.blocks) {
      let joined = ""
      for (const line of block.lines) {
        if (!joined) joined = line.text
        else if (joined.endsWith("\u00ad")) joined = joined.slice(0, -1) + line.text
        else if (joined.endsWith("-")) joined += line.text
        else joined += " " + line.text
      }
      joined = joined.replace(/\u00ad/g, "")
      // Running heads, page numbers and labels in figures are left out of the reading text
      if (block.kind === "other") continue
      if (block.kind === "heading") parts.push(`## ${joined}`)
      else if (block.kind === "table") parts.push(tableMarkdown(block.lines.map((l) => l.text)))
      else if (block.kind === "code") parts.push(["```", ...block.lines.map((l) => l.text), "```"].join("\n"))
      else if (block.kind === "list") parts.push(block.lines.map((l) => (/^(\d+[.)]|[-*+])\s/.test(l.text) ? l.text : `- ${l.text.replace(/^[•·▪◦]\s*/, "")}`)).join("\n"))
      else if (block.kind === "figure") parts.push(`*${joined}*`)
      else parts.push(joined)
    }
  }
  return parts.join("\n\n") + "\n"
}

// Each page's size in points, as pdfium sees it (what MinerU's thousandths are of)
export async function pageSizes(bytes: Uint8Array, wasmPath?: string): Promise<{ width: number; height: number }[]> {
  const m = await loadPdfium(wasmPath)
  const ptr = m.pdfium.wasmExports.malloc(bytes.length)
  ;(m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, ptr)
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "")
  if (!doc) {
    m.pdfium.wasmExports.free(ptr)
    throw new UnreadablePdf("The PDF can't be read.")
  }
  try {
    const sizes: { width: number; height: number }[] = []
    for (let i = 0; i < m.FPDF_GetPageCount(doc); i++) {
      const page = m.FPDF_LoadPage(doc, i)
      sizes.push(page ? { width: m.FPDF_GetPageWidthF(page), height: m.FPDF_GetPageHeightF(page) } : { width: 612, height: 792 })
      if (page) m.FPDF_ClosePage(page)
    }
    return sizes
  } finally {
    m.FPDF_CloseDocument(doc)
    m.pdfium.wasmExports.free(ptr)
  }
}

// Rows as "| a | b |" (MinerU's tables, a | in a cell escaped) become a Markdown table under its
// caption; the first row heads it
function tableMarkdown(lines: string[]) {
  const isRow = (l: string) => l.length > 1 && l.startsWith("|") && l.endsWith("|")
  const caption = lines.filter((l) => !isRow(l))
  const rows = lines.filter(isRow).map((l) => l.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()))
  if (!rows.length) return caption.join("\n")
  const width = Math.max(...rows.map((r) => r.length))
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`
  const table = [row(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(row)].join("\n")
  return caption.length ? `${caption.join(" ")}\n\n${table}` : table
}
