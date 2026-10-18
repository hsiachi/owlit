import type { PaperText } from "@owlit/protocol"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { writeFileAtomic, writeJsonAtomic } from "../../fs-util.ts"
import { paperDir } from "../paths.ts"
import { toMarkdown } from "./extract.ts"

// library/papers/<id>/text.json and text.md, always written together

export async function readText(root: string, id: string): Promise<PaperText | undefined>
export async function readText(root: string, id: string, options: { withTime: true }): Promise<{ text: PaperText; at: number } | undefined>
export async function readText(root: string, id: string, options?: { withTime: true }) {
  const file = path.join(paperDir(root, id), "text.json")
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)])
    const text = JSON.parse(raw) as PaperText
    if (!Array.isArray(text?.pages)) return undefined
    return options?.withTime ? { text, at: info.mtimeMs } : text
  } catch {
    return undefined
  }
}

// Whether the paper has its text, without reading it (text.json is a few hundred KB, and written whole)
export const hasText = (root: string, id: string) =>
  stat(path.join(paperDir(root, id), "text.json")).then(
    (info) => info.size > 0,
    () => false,
  )

// text.md first: a reader of text.json then always finds the Markdown that goes with it
export async function writeText(root: string, id: string, text: PaperText) {
  const dir = paperDir(root, id)
  await writeFileAtomic(path.join(dir, "text.md"), toMarkdown(text), { parents: false })
  await writeJsonAtomic(path.join(dir, "text.json"), text, { parents: false })
}
