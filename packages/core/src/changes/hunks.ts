import type { TextHunk } from "@owlit/protocol"
import { diffArrays } from "diff"

// The one place owlit diffs text (jsdiff), so the library can be swapped here alone. An open editor
// takes a write as these hunks too (fs.write), so the app has no diff of its own for core's writes.

export type Hunk = TextHunk

// Latin words and each space or mark are tokens; Chinese and Japanese, written without spaces, are
// diffed character by character, so a change inside a sentence stays the size it was
const TOKEN = /[^\s\p{P}\p{S}\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]+|[\s\S]/gu

// What turns a into b, as replacements of a's text, in order
export function hunks(a: string, b: string): Hunk[] {
  const out: Hunk[] = []
  let at = 0
  let open: Hunk | null = null
  for (const part of diffArrays(a.match(TOKEN) ?? [], b.match(TOKEN) ?? [])) {
    const text = part.value.join("")
    if (!part.added && !part.removed) {
      if (open) out.push(open)
      open = null
      at += text.length
      continue
    }
    open ??= { from: at, to: at, insert: "" }
    if (part.removed) {
      open.to += text.length
      at += text.length
    } else open.insert += text
  }
  if (open) out.push(open)
  return out
}

// Two lists (a doc's paragraphs) compared item by item, as runs kept, added or removed, in order
export function diffLists(a: string[], b: string[]): { value: string[]; added?: boolean; removed?: boolean }[] {
  return diffArrays(a, b)
}

// Both sets of hunks of the same text, applied together: `wanted` where it fits, and all of `since`. A
// wanted hunk is left out when it overlaps one of since's, when either only inserts inside the other, or
// when both insert at one place (their order can't be told). An insert at the edge of a replacement goes
// on that side of it. The text, and the hunks left out.
export function merge(base: string, wanted: Hunk[], since: Hunk[]): { text: string; left: Hunk[] } {
  const inside = (p: number, h: Hunk) => h.from < p && p < h.to
  const empty = (h: Hunk) => h.from === h.to
  const clash = (a: Hunk, b: Hunk) =>
    empty(a) ? inside(a.from, b) || (empty(b) && a.from === b.from) : empty(b) ? inside(b.from, a) : a.from < b.to && b.from < a.to
  const left = wanted.filter((h) => since.some((s) => clash(h, s)))
  const all = [...wanted.filter((h) => !left.includes(h)), ...since].sort((a, b) => a.from - b.from || a.to - b.to)
  let text = ""
  let at = 0
  for (const h of all) {
    text += base.slice(at, h.from) + h.insert
    at = h.to
  }
  return { text: text + base.slice(at), left }
}
