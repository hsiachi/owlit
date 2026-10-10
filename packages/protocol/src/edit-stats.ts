// How much an edit changed, said the same way by core (a reply's result card) and the app (a step's row).
// Prose is counted in words, since a paragraph of a doc is one line and "+1 −1" says nothing of how much
// of it changed: a run of letters or digits is one word, and so is each CJK character, as the doc's own
// word count reads them. Anything else (code, data) is counted in lines.

export interface EditStats {
  unit: "words" | "lines"
  added: number
  removed: number
  // Most of what was there is gone: said as "Rewritten" rather than two large numbers
  rewritten: boolean
}

// Several changed parts of one file, reported apart by the agent, kept as one diff: each part on both sides,
// with this line between them, which the preview shows as a gap
export const HUNK_GAP = "⋯"

const PROSE = /\.(md|markdown|txt)$/i

// A doc counts as rewritten once more than half its words went, if it had enough to say so of
const REWRITTEN_SHARE = 0.5
const REWRITTEN_MIN = 40

const WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu

export function words(text: string) {
  return text.match(WORD) ?? []
}

const linesOf = (text: string) => text.split("\n").filter((l) => l.trim() && l !== HUNK_GAP)

export function editStats(path: string, before: string, after: string): EditStats {
  const unit = PROSE.test(path) ? "words" : "lines"
  const a = linesOf(before)
  const b = linesOf(after)
  const size = (line: string) => (unit === "words" ? words(line).length : 1)
  let added = 0
  let removed = 0
  for (const block of changedBlocks(a, b)) {
    // In prose a line is a paragraph: one that was only touched up counts the words that changed in it.
    // Paired in order with the line that took its place, when the two still share enough at their ends.
    const pairs = unit === "words" ? Math.min(block.removed.length, block.added.length) : 0
    for (let i = 0; i < pairs; i++) {
      const touched = touchedUp(block.removed[i], block.added[i])
      if (touched) {
        // Inside the span, held in place by both ends, the words it keeps can be trusted as kept
        const out = words(touched.removed)
        const into = words(touched.added)
        const kept = keptIn(out, into)
        removed += out.length - kept
        added += into.length - kept
      } else {
        removed += size(block.removed[i])
        added += size(block.added[i])
      }
    }
    for (const line of block.removed.slice(pairs)) removed += size(line)
    for (const line of block.added.slice(pairs)) added += size(line)
  }
  const total = a.reduce((n, line) => n + size(line), 0)
  return { unit, added, removed, rewritten: unit === "words" && total >= REWRITTEN_MIN && removed > total * REWRITTEN_SHARE }
}

// The span two versions of a paragraph differ in, between what they share at both ends; null when they
// share too little there to be read as one paragraph touched up. Counting by the ends, not by every
// word the two have in common, keeps a rewritten paragraph from passing as kept: two sentences on one
// subject share many characters (的, 是, the), in no useful order.
function touchedUp(oldLine: string, newLine: string) {
  let p = 0
  while (p < oldLine.length && p < newLine.length && oldLine[p] === newLine[p]) p++
  let s = 0
  while (s < oldLine.length - p && s < newLine.length - p && oldLine[oldLine.length - 1 - s] === newLine[newLine.length - 1 - s]) s++
  if (p + s < Math.min(oldLine.length, newLine.length) * 0.4) return null
  return { removed: oldLine.slice(p, oldLine.length - s), added: newLine.slice(p, newLine.length - s) }
}

// How many words two short spans share in order; a span too long to compare keeps none
function keptIn(a: string[], b: string[]) {
  if (!a.length || !b.length || a.length * b.length > 250_000) return 0
  let row = new Uint32Array(b.length + 1)
  for (let i = a.length - 1; i >= 0; i--) {
    const next = new Uint32Array(b.length + 1)
    for (let j = b.length - 1; j >= 0; j--) next[j] = a[i] === b[j] ? row[j + 1] + 1 : Math.max(row[j], next[j + 1])
    row = next
  }
  return row[0]
}

// Lines that differ, grouped by where they sit: each run of lines taken out and lines put in between two
// lines both texts keep (a longest-common-subsequence diff). Past MAX_CELLS, the texts are compared
// whole: every line counts as changed.
const MAX_CELLS = 4_000_000

function changedBlocks(a: string[], b: string[]) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const x = a.slice(start, a.length - end)
  const y = b.slice(start, b.length - end)
  if (x.length * y.length > MAX_CELLS) return [{ removed: x, added: y }]
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const blocks: { removed: string[]; added: string[] }[] = []
  let block = { removed: [] as string[], added: [] as string[] }
  const close = () => {
    if (block.removed.length || block.added.length) blocks.push(block)
    block = { removed: [], added: [] }
  }
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      close()
      i++
      j++
    } else if (j < y.length && (i >= x.length || lcs[i][j + 1] > lcs[i + 1][j])) block.added.push(y[j++])
    else block.removed.push(x[i++])
  }
  close()
  return blocks
}
