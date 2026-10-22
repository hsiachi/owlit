import { isProjectMark } from "./projects.ts"

// How docs are named and where paths point. Core names files on disk with these rules and the app
// predicts the same names while it waits for core, so both sides must agree: they live here.
// Paths are workspace-relative and "/"-separated; "" is the workspace root.

export const isMarkdown = (path: string) => /\.md$/i.test(path)

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

// Whether `path` is `folder` or somewhere under it
export const isWithin = (path: string, folder: string) => path === folder || path.startsWith(folder + "/")

// ".md" for Markdown (whatever its case on disk), else the extension as written, else ""
export const extOf = (path: string) => {
  const name = baseName(path)
  if (isMarkdown(name)) return ".md"
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot) : ""
}

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

// Where a doc whose name follows its first line should be now, or null if it should stay. Its first line
// names it; an empty one, the time it was created. A doc already numbered because its name was taken
// ("Notes 2") keeps its number.
// The project mark's file name is the one fixed name: the mark keeps it whatever its first line says (that
// line names the project), and no doc takes it by following its own first line ("# Project"), which would
// make its folder a project unasked.
export function followFirstLine(path: string, content: string, createdAt: number, taken: (path: string) => boolean) {
  if (isProjectMark(path)) return null
  const busy = (p: string) => isProjectMark(p) || taken(p)
  const stem = nameFromFirstLine(content) || timeName(createdAt)
  const folder = parentPath(path)
  const current = baseName(path).slice(0, -extOf(path).length || undefined)
  const numbered = current.startsWith(stem + " ") && /^\d+$/.test(current.slice(stem.length + 1)) && busy(joinPath(folder, stem + ".md"))
  if (stem === current || numbered) return null
  return uniquePath(folder, stem, ".md", busy)
}
