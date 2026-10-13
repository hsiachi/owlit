import { mkdir, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import type { PaperFigure, PaperText } from "@owlit/protocol"
import { readJson, writeFileAtomic, writeJsonAtomic } from "../../fs-util.ts"
import { paperDir } from "../paths.ts"
import { workspaceFileUrl } from "../state.ts"
import { captionLabel, groupLayout, type LayoutPage, type PlannedFigure } from "./group.ts"
import { renderCrops } from "./render.ts"

// A paper's figures and tables as pictures: library/papers/<id>/figures/<figure-3>.jpg|png and
// figures.json listing them. A figure MinerU kept whole is its own picture; one it cut into pieces
// is drawn again from the PDF as one. Regenerable like the rest of library/papers/<id>/.

export interface FigureRecord {
  id: string
  kind: "figure" | "table"
  label: string
  caption: string
  page: number
  rect: { x: number; y: number; w: number; h: number }
  // The picture's name in figures/
  file: string
}

export interface FiguresFile {
  version: 1
  // Where the boxes came from: MinerU's layout (captions placed) or text.json alone (each figure
  // block with a numbered caption, unjoined)
  source: "layout" | "text"
  at: number
  figures: FigureRecord[]
  // Looking for them failed (the PDF unreadable, the cloud unreachable): none, and why
  error?: string
}

const FIGURES_JSON = "figures.json"
const FIGURES_DIR = "figures"

export const idOfLabel = (label: string) => label.toLowerCase().replace(/\s+/g, "-")

export async function readFigures(root: string, id: string): Promise<FiguresFile | undefined> {
  return readJson<FiguresFile>(path.join(paperDir(root, id), FIGURES_JSON)).catch(() => undefined)
}

export function toPaperFigures(paperId: string, file: FiguresFile | undefined): PaperFigure[] {
  return (file?.figures ?? []).map((f) => ({
    id: f.id,
    kind: f.kind,
    label: f.label,
    caption: f.caption,
    page: f.page,
    rect: f.rect,
    url: workspaceFileUrl(path.posix.join("library/papers", paperId, FIGURES_DIR, f.file)),
  }))
}

// From MinerU's layout and the pictures that came with it (images/<hash>.jpg → bytes)
export async function writeFiguresFromLayout(root: string, id: string, pages: LayoutPage[], images: Map<string, Uint8Array>, pdf: Uint8Array, wasmPath?: string) {
  return place(root, id, "layout", groupLayout(pages), images, pdf, wasmPath)
}

// Without MinerU's layout (a reading from before it was kept, its job gone): each figure or table
// block of text.json whose caption starts with its number, drawn from the PDF
export async function writeFiguresFromText(root: string, id: string, text: PaperText, pdf: Uint8Array, wasmPath?: string) {
  const planned: PlannedFigure[] = []
  const seen = new Set<string>()
  for (const page of text.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "figure" && block.kind !== "table") continue
      const caption = block.lines[0]?.text ?? ""
      const label = captionLabel(caption, block.kind)
      if (!label || seen.has(label)) continue
      seen.add(label)
      const r = block.rect
      planned.push({ kind: block.kind, label, caption: block.kind === "figure" ? block.lines.map((l) => l.text).join(" ") : caption, page: page.index, box: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, images: [] })
    }
  }
  return place(root, id, "text", planned, new Map(), pdf, wasmPath)
}

async function place(root: string, id: string, source: FiguresFile["source"], planned: PlannedFigure[], images: Map<string, Uint8Array>, pdf: Uint8Array, wasmPath?: string) {
  const dir = path.join(paperDir(root, id), FIGURES_DIR)
  // A figure kept whole uses MinerU's picture (named by file name, with or without its folder); the
  // rest are drawn from the PDF in one pass
  const whole = (f: PlannedFigure) => (f.images.length === 1 ? images.get(path.basename(f.images[0])) : undefined)
  const drawn = planned.filter((f) => !whole(f))
  const crops = drawn.length ? await renderCrops(pdf, drawn.map((f) => ({ page: f.page, box: f.box })), wasmPath) : []
  const pictures = new Map(drawn.map((f, i) => [f, crops[i]]))

  // The folder is rebuilt: a figure gone from a new reading leaves no picture behind
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const figures: FigureRecord[] = []
  for (const f of planned) {
    const figureId = idOfLabel(f.label)
    const kept = whole(f)
    const file = `${figureId}.${kept ? extOf(f.images[0]) : "png"}`
    const bytes = kept ?? pictures.get(f)
    if (!bytes) continue
    await writeFileAtomic(path.join(dir, file), bytes)
    figures.push({
      id: figureId,
      kind: f.kind,
      label: f.label,
      caption: f.caption,
      page: f.page,
      rect: { x: round(f.box.x0), y: round(f.box.y0), w: round(f.box.x1 - f.box.x0), h: round(f.box.y1 - f.box.y0) },
      file,
    })
  }
  const record: FiguresFile = { version: 1, source, at: Date.now(), figures }
  await writeJsonAtomic(path.join(paperDir(root, id), FIGURES_JSON), record)
  return record
}

// No figures, and why: the reading note goes ahead without them
export async function noFigures(root: string, id: string, error: string) {
  const record: FiguresFile = { version: 1, source: "text", at: Date.now(), figures: [], error }
  await writeJsonAtomic(path.join(paperDir(root, id), FIGURES_JSON), record)
}

// Removes a paper's figures (its PDF changed, so they are of the old file)
export async function removeFigures(root: string, id: string) {
  const dir = paperDir(root, id)
  await rm(path.join(dir, FIGURES_DIR), { recursive: true, force: true })
  await rm(path.join(dir, FIGURES_JSON), { force: true })
}

// The bytes of each figure's picture, for an agent that sees images
export async function figurePictures(root: string, id: string, file: FiguresFile): Promise<{ figure: FigureRecord; data: Buffer; mimeType: string }[]> {
  const dir = path.join(paperDir(root, id), FIGURES_DIR)
  const names = new Set(await readdir(dir).catch(() => [] as string[]))
  const out: { figure: FigureRecord; data: Buffer; mimeType: string }[] = []
  for (const figure of file.figures) {
    if (!names.has(figure.file)) continue
    out.push({ figure, data: await readFile(path.join(dir, figure.file)), mimeType: figure.file.endsWith(".png") ? "image/png" : "image/jpeg" })
  }
  return out
}

const extOf = (name: string) => (/\.(png|jpe?g|webp)$/i.exec(name)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg")
const round = (v: number) => Math.round(v * 100) / 100
