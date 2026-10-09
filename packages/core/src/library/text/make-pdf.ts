// Builds small PDFs for tests: text items at exact positions (top-left origin, points), in Helvetica or
// Helvetica-Bold, page after page. A page with no items has only a drawn box: a scan without text.

export interface PdfItem {
  x: number
  // Baseline, from the top of the page
  y: number
  size: number
  text: string
  bold?: boolean
}

export function makePdf(pages: PdfItem[][], width = 612, height = 792): Buffer {
  const objects: string[] = []
  const add = (body: string) => objects.push(body)
  add("<< /Type /Catalog /Pages 2 0 R >>")
  const pageIds = pages.map((_, i) => 5 + i * 2)
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`)
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
  for (const items of pages) {
    const content = items.length
      ? items
          .map((item) => `BT /${item.bold ? "F2" : "F1"} ${item.size} Tf ${item.x} ${height - item.y} Td (${escape(item.text)}) Tj ET`)
          .join("\n")
      : `0.5 g 72 72 ${width - 144} ${height - 144} re f`
    const contentId = objects.length + 2
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`)
    add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`)
  }
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, "latin1")
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`)

// Lines of a paragraph set from top to bottom
export const paragraph = (x: number, top: number, lines: string[], size = 10, leading = 12): PdfItem[] =>
  lines.map((text, i) => ({ x, y: top + i * leading, size, text }))
