import { crc32, deflateSync } from "node:zlib"
import { loadPdfium, UnreadablePdf } from "../text/extract.ts"
import type { Box } from "./group.ts"

// Part of a PDF page as a PNG, drawn by pdfium: a figure MinerU cut into pieces, joined again, or a
// figure whose picture MinerU didn't keep. Drawn at 2× (144 dpi), about what MinerU's own pictures
// are, so a figure looks the same whichever way it came.

const SCALE = 2
// Room around the box, in PDF points: MinerU's boxes sit tight on the ink
const PAD = 6
// FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER (RGBA rather than BGRA)
const FLAGS = 0x01 | 0x10
const FORMAT_BGRA = 4

export interface Crop {
  page: number
  box: Box
}

export async function renderCrops(bytes: Uint8Array, crops: Crop[], wasmPath?: string): Promise<Buffer[]> {
  const m = await loadPdfium(wasmPath)
  const heap = () => (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8
  const ptr = m.pdfium.wasmExports.malloc(bytes.length)
  heap().set(bytes, ptr)
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "")
  if (!doc) {
    m.pdfium.wasmExports.free(ptr)
    throw new UnreadablePdf("The PDF can't be read.")
  }
  try {
    const out: Buffer[] = []
    for (const crop of crops) {
      const page = m.FPDF_LoadPage(doc, crop.page)
      if (!page) throw new Error(`The PDF has no page ${crop.page + 1}.`)
      try {
        const pw = m.FPDF_GetPageWidthF(page)
        const ph = m.FPDF_GetPageHeightF(page)
        const x0 = Math.max(0, crop.box.x0 - PAD)
        const y0 = Math.max(0, crop.box.y0 - PAD)
        const x1 = Math.min(pw, crop.box.x1 + PAD)
        const y1 = Math.min(ph, crop.box.y1 + PAD)
        const w = Math.max(1, Math.round((x1 - x0) * SCALE))
        const h = Math.max(1, Math.round((y1 - y0) * SCALE))
        const bitmap = m.FPDFBitmap_CreateEx(w, h, FORMAT_BGRA, 0, 0)
        try {
          m.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff)
          // The whole page drawn at the scale, shifted so the box lands on the bitmap
          m.FPDF_RenderPageBitmap(bitmap, page, -Math.round(x0 * SCALE), -Math.round(y0 * SCALE), Math.round(pw * SCALE), Math.round(ph * SCALE), 0, FLAGS)
          const stride = m.FPDFBitmap_GetStride(bitmap)
          const start = m.FPDFBitmap_GetBuffer(bitmap)
          out.push(png(heap().slice(start, start + stride * h), w, h, stride))
        } finally {
          m.FPDFBitmap_Destroy(bitmap)
        }
      } finally {
        m.FPDF_ClosePage(page)
      }
    }
    return out
  } finally {
    m.FPDF_CloseDocument(doc)
    m.pdfium.wasmExports.free(ptr)
  }
}

// RGBA rows → an RGB PNG (the page is opaque, so alpha only costs bytes)
export function png(rgba: Uint8Array, width: number, height: number, stride = width * 4): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const from = y * stride + x * 4
      const to = row + 1 + x * 3
      raw[to] = rgba[from]
      raw[to + 1] = rgba[from + 1]
      raw[to + 2] = rgba[from + 2]
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "latin1"), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, sum])
}
