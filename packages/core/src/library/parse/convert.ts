import type { PaperText, Rect, TextBlock } from "@owlit/protocol"

// MinerU's content_list.json as a PaperText: its blocks in reading order, each with a bbox given in
// thousandths of the page (0–1000 on each axis, top-left origin), which becomes PDF points with the
// page sizes the PDF itself gives. MinerU reports blocks, not lines, so each line carries its block's
// rect.

export interface ContentBlock {
  type: string
  text?: string
  text_level?: number
  bbox?: [number, number, number, number]
  page_idx?: number
  list_items?: string[]
  table_body?: string
  table_caption?: string[]
  image_caption?: string[]
  img_caption?: string[]
  code_body?: string
  code_caption?: string[]
}

export function contentListToText(blocks: ContentBlock[], pages: { width: number; height: number }[]): PaperText {
  const byPage = new Map<number, TextBlock[]>()
  for (const block of blocks) {
    const index = block.page_idx ?? 0
    const size = pages[index]
    if (!size) continue
    const converted = toBlocks(block, size)
    if (!converted.length) continue
    const list = byPage.get(index) ?? []
    list.push(...converted)
    byPage.set(index, list)
  }
  return {
    version: 1,
    source: "mineru",
    pages: pages.map((size, index) => ({ index, width: size.width, height: size.height, blocks: byPage.get(index) ?? [] })),
  }
}

function toBlocks(block: ContentBlock, size: { width: number; height: number }): TextBlock[] {
  const one = toBlock(block, size)
  return one ? (Array.isArray(one) ? one : [one]) : []
}

function toBlock(block: ContentBlock, size: { width: number; height: number }): TextBlock | TextBlock[] | undefined {
  const rect = toRect(block.bbox, size)
  const lines = (texts: (string | undefined)[]) =>
    texts
      .map((t) => t?.replace(/\s+/g, " ").trim())
      .filter((t): t is string => !!t)
      .map((text) => ({ text, rect }))
  switch (block.type) {
    case "text": {
      const found = lines([block.text])
      if (!found.length) return undefined
      return { kind: block.text_level ? "heading" : "paragraph", rect, lines: found }
    }
    case "list":
      return nonEmpty({ kind: "list", rect, lines: lines(block.list_items ?? []) })
    // The vlm model gives each reference its own block
    case "ref_text":
      return nonEmpty({ kind: "paragraph", rect, lines: lines([block.text]) })
    case "code":
    case "algorithm": {
      // The caption reads as a paragraph; the code keeps its line breaks and indentation
      const code = (block.code_body ?? block.text ?? "")
        .split("\n")
        .map((t) => t.replace(/\s+$/, ""))
        .filter((t) => t.trim())
        .map((text) => ({ text, rect }))
      return [nonEmpty({ kind: "paragraph", rect, lines: lines(block.code_caption ?? []) }), nonEmpty({ kind: "code", rect, lines: code })].filter(
        (b): b is TextBlock => !!b,
      )
    }
    case "table":
      return nonEmpty({ kind: "table", rect, lines: [...lines(block.table_caption ?? []), ...tableRows(block.table_body ?? "").map((text) => ({ text, rect }))] })
    case "equation":
    case "interline_equation":
      return nonEmpty({ kind: "formula", rect, lines: lines([block.text]) })
    case "image":
    case "chart":
      return nonEmpty({ kind: "figure", rect, lines: lines(block.image_caption ?? block.img_caption ?? []) })
    default:
      // page_number, header, footer, page_footnote, aside_text, …
      return nonEmpty({ kind: "other", rect, lines: lines([block.text, ...(block.list_items ?? [])]) })
  }
}

const nonEmpty = (block: TextBlock) => (block.lines.length ? block : undefined)

function toRect(bbox: ContentBlock["bbox"], size: { width: number; height: number }): Rect {
  const [x0, y0, x1, y1] = bbox ?? [0, 0, 0, 0]
  const sx = size.width / 1000
  const sy = size.height / 1000
  return { x: round(x0 * sx), y: round(y0 * sy), w: round((x1 - x0) * sx), h: round((y1 - y0) * sy) }
}

const round = (v: number) => Math.round(v * 100) / 100

// <tr><td>a</td><td>b</td></tr> → "| a | b |", one Markdown row per table row: empty cells keep their
// place and a | inside a cell is escaped, so the columns survive (toMarkdown reads them back)
function tableRows(html: string) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (row) =>
      `| ${[...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => decode(cell[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"))
        .join(" | ")} |`,
  )
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
