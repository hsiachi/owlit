// Which pieces of a page make one figure. MinerU often cuts a figure into pieces (the panels of a
// grid, a chart and its legend), each its own block with no caption, and hangs the caption on one of
// them, not always the right one: between two stacked figures it goes to the lower. So pieces are
// grouped by where the captions sit, which only MinerU's layout (middle json) records, not by order:
//
// - a piece belongs to the nearest numbered caption below it in its column, with no other numbered
//   caption in between; failing that, to one right above it (some styles caption a figure on top);
// - a caption reaches across its column (the whole width when it straddles the middle of the page),
//   but only halfway to a caption beside it, so figures set side by side stay apart;
// - pieces that would take body text inside their joint box are not joined: that is two figures.
//
// Checked by eye on 132 papers (2026-10-13): about one figure in five comes in pieces. Still missed,
// and left out rather than misplaced: captions beside a figure, rotated pages, unnumbered figures.

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

// One page of MinerU's layout, as much of it as grouping reads
export interface LayoutPage {
  page_idx: number
  page_size: [number, number]
  para_blocks: LayoutBlock[]
}

export interface LayoutBlock {
  type: string
  bbox: [number, number, number, number]
  blocks?: LayoutBlock[]
  lines?: { spans?: { type?: string; content?: string; image_path?: string }[] }[]
}

export interface PlannedFigure {
  kind: "figure" | "table"
  // "Figure 3", "Table S2": the caption's own number
  label: string
  caption: string
  page: number
  // The figure's box in PDF points, top-left origin
  box: Box
  // MinerU's picture of each piece (images/<hash>.jpg), in reading order
  images: string[]
}

const FIGURE = /^\s*(?:supplementary\s+)?(?:f\s*i\s*g\s*(?:u\s*r\s*e)?|f\s*i\s*u\s*r\s*e)\s*\.?\s*([sa]\s*)?(\d+|[ivx]+)\b/i
const TABLE = /^\s*(?:supplementary\s+)?t\s*a\s*b\s*(?:l\s*e)?\s*\.?\s*([sa]\s*)?(\d+|[ivx]+)\b/i

// "Figure 3" from a caption that starts with its number (OCR gaps like "Fi ure 6" included)
export function captionLabel(text: string, kind: "figure" | "table"): string | undefined {
  const m = (kind === "figure" ? FIGURE : TABLE).exec(text.replace(/<[^>]+>/g, ""))
  if (!m) return undefined
  const prefix = m[1] ? m[1].replace(/\s/g, "").toUpperCase() : ""
  return `${kind === "figure" ? "Figure" : "Table"} ${prefix}${m[2].toUpperCase()}`
}

const textOf = (b: LayoutBlock): string =>
  b.lines ? b.lines.flatMap((l) => l.spans ?? []).map((s) => s.content ?? "").join(" ").replace(/\s+/g, " ").trim() : (b.blocks ?? []).map(textOf).join(" ").trim()

const imagesOf = (b: LayoutBlock): string[] => (b.lines ?? []).flatMap((l) => l.spans ?? []).flatMap((s) => (s.image_path ? [s.image_path] : []))

const box = (b: [number, number, number, number]): Box => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] })
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
const overlap = (a: Box, b: Box) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) })
// How much of the narrower of two spans the other covers, across
const across = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0))

interface Caption {
  box: Box
  text: string
  label: string
}

interface Piece {
  box: Box
  images: string[]
  caption?: Caption
}

export function groupPage(page: LayoutPage): PlannedFigure[] {
  const [width] = page.page_size
  const pieces: Piece[] = []
  const captions: Caption[] = []
  const words: { box: Box; text: string }[] = []
  const out: PlannedFigure[] = []

  for (const block of page.para_blocks) {
    if (block.type === "image" || block.type === "chart") {
      for (const part of block.blocks ?? []) {
        if (part.type.endsWith("_body")) pieces.push({ box: box(part.bbox), images: imagesOf(part) })
        else if (part.type.endsWith("_caption") || part.type.endsWith("_footnote")) {
          const text = textOf(part)
          const label = captionLabel(text, "figure")
          if (label) captions.push({ box: box(part.bbox), text, label })
        }
      }
    } else if (block.type === "table") {
      // A table comes whole, its caption inside its own block (above or below it)
      const body = block.blocks?.find((p) => p.type === "table_body")
      const caption = block.blocks?.filter((p) => p.type === "table_caption").map(textOf).join(" ").trim() ?? ""
      const label = captionLabel(caption, "table")
      if (body && label) out.push({ kind: "table", label, caption, page: page.page_idx, box: box(body.bbox), images: imagesOf(body) })
    } else if (block.type === "text" || block.type === "title") {
      const text = textOf(block)
      const label = captionLabel(text, "figure")
      if (label) captions.push({ box: box(block.bbox), text, label })
      else words.push({ box: box(block.bbox), text })
    }
  }

  // The span a caption speaks for: its column, up to halfway to a caption at the same height
  const reach = (c: Caption) => {
    let lo = c.box.x0 < width / 2 && width / 2 < c.box.x1 ? 0 : c.box.x1 <= width / 2 ? 0 : width / 2
    let hi = c.box.x0 < width / 2 && width / 2 < c.box.x1 ? width : c.box.x1 <= width / 2 ? width / 2 : width
    const mid = (c.box.x0 + c.box.x1) / 2
    for (const o of captions) {
      if (o === c || Math.min(c.box.y1, o.box.y1) <= Math.max(c.box.y0, o.box.y0)) continue
      if ((o.box.x0 + o.box.x1) / 2 < mid) lo = Math.max(lo, (o.box.x1 + c.box.x0) / 2)
      else hi = Math.min(hi, (c.box.x1 + o.box.x0) / 2)
    }
    return { x0: lo, x1: hi }
  }
  const speaksFor = (c: Caption, b: Box) => across(c.box, b) > 0.3 || across(reach(c), b) > 0.8
  const captionBetween = (top: number, bottom: number, b: Box, except: Caption) =>
    captions.some((c) => c !== except && top <= (c.box.y0 + c.box.y1) / 2 && (c.box.y0 + c.box.y1) / 2 <= bottom && speaksFor(c, b))

  for (const piece of pieces) {
    const b = piece.box
    const below = captions.filter((c) => c.box.y0 >= b.y1 - 5 && speaksFor(c, b)).sort((p, q) => p.box.y0 - q.box.y0)
    const nearest = below[0]
    if (nearest && !captionBetween(b.y1, nearest.box.y0, b, nearest)) piece.caption = nearest
    else {
      const above = captions.filter((c) => c.box.y1 <= b.y0 + 5 && speaksFor(c, b) && b.y0 - c.box.y1 < 40)
      piece.caption = above.sort((p, q) => q.box.y1 - p.box.y1)[0]
    }
  }

  for (const caption of captions) {
    const mine = pieces.filter((p) => p.caption === caption)
    if (!mine.length) continue
    const joint: Box = { x0: Math.min(...mine.map((p) => p.box.x0)), y0: Math.min(...mine.map((p) => p.box.y0)), x1: Math.max(...mine.map((p) => p.box.x1)), y1: Math.max(...mine.map((p) => p.box.y1)) }
    // Body text inside the joint box: the pieces aren't one figure. A label set inside a figure
    // (a panel's few words) overlaps a piece and doesn't count.
    const swallows =
      mine.length > 1 &&
      words.some((w) => w.text.split(/\s+/).length > 8 && area(w.box) > 0 && overlap(w.box, joint) / area(w.box) > 0.5 && !mine.some((p) => overlap(w.box, p.box) > 0))
    if (swallows) {
      // Each piece alone then, the one nearest the caption taking it
      const nearest = mine.reduce((p, q) => (Math.abs(q.box.y1 - caption.box.y0) < Math.abs(p.box.y1 - caption.box.y0) ? q : p))
      out.push({ kind: "figure", label: caption.label, caption: caption.text, page: page.page_idx, box: nearest.box, images: nearest.images })
      continue
    }
    out.push({ kind: "figure", label: caption.label, caption: caption.text, page: page.page_idx, box: joint, images: mine.flatMap((p) => p.images) })
  }
  return out
}

// Every figure and table of a paper, in page order, each label once (a continued table keeps its first part)
export function groupLayout(pages: LayoutPage[]): PlannedFigure[] {
  const seen = new Set<string>()
  const out: PlannedFigure[] = []
  for (const page of [...pages].sort((a, b) => a.page_idx - b.page_idx)) {
    for (const f of groupPage(page).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)) {
      if (seen.has(f.label)) continue
      seen.add(f.label)
      out.push(f)
    }
  }
  return out
}
