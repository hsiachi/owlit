import { baseName, isMarkdown, joinPath } from "../types"

// Characters that can't sit in a file name on common systems, plus the ones that break wikilinks
const INVALID = /[\\/:*?"<>|#^[\]]/g
const MAX = 80

const pad = (n: number) => String(n).padStart(2, "0")

// "2026-10-08 21.35": the name of a doc whose first line is still empty
export function timeName(t: number) {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}

// YAML front matter at the very top of a file: "---", fields, "---". Returns where the body starts.
export function frontmatterEnd(content: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)
  return m ? m[0].length : 0
}

// The file name a doc gets from its first line (after any front matter): its words without Markdown marks
export function nameFromFirstLine(content: string): string {
  let line = content.slice(frontmatterEnd(content)).split("\n", 1)[0] ?? ""
  line = line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~=]/g, "")
    .replace(INVALID, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
  if (line.length > MAX) {
    const cut = line.slice(0, MAX)
    const space = cut.lastIndexOf(" ")
    line = (space > MAX / 2 ? cut.slice(0, space) : cut).trim()
  }
  return line
}

// A name typed by the user, made safe for the disk
export function cleanName(name: string) {
  return name.replace(INVALID, " ").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "")
}

// "name.md", or "name 2.md" when the folder already has one
export function uniquePath(folder: string, stem: string, ext: string, taken: (path: string) => boolean) {
  let path = joinPath(folder, stem + ext)
  for (let n = 2; taken(path); n++) path = joinPath(folder, `${stem} ${n}${ext}`)
  return path
}

export const extOf = (path: string) => {
  const name = baseName(path)
  if (isMarkdown(name)) return ".md"
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot) : ""
}
