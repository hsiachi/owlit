import { HUNK_GAP } from "@owlit/protocol"
import { hunk } from "@/lib/text-diff"

export type Chunk =
  | { type: "same"; text: string }
  | { type: "gap" }
  | { type: "added"; text: string }
  | { type: "removed"; text: string }
  | { type: "change"; before: string; removed: string; added: string; after: string }

// Lines that differ between two texts (a longest-common-subsequence diff, enough for a note or a draft),
// with one line of context around each change. A line replaced by one line shows the words that changed.
export function diffLines(oldText: string, newText: string): Chunk[] {
  const a = oldText.split("\n").filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
  const b = newText.split("\n").filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
  if (a.length * b.length > 400_000) return [{ type: "added", text: b.join("\n") }]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const ops: { type: "same" | "added" | "removed"; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ type: "same", text: a[i++] })
      j++
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] > lcs[i + 1][j])) ops.push({ type: "added", text: b[j++] })
    else ops.push({ type: "removed", text: a[i++] })
  }
  const out: Chunk[] = []
  // A line kept for context sits right next to a change
  const near = (k: number) => [ops[k - 1], ops[k + 1]].some((o) => o && o.type !== "same")
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === "same") {
      if (!op.text.trim()) continue
      // Between two parts of an edit the agent reported apart
      if (op.text === HUNK_GAP) {
        if (out.length && out.at(-1)?.type !== "gap") out.push({ type: "gap" })
        continue
      }
      if (near(k)) out.push({ type: "same", text: op.text })
      else if (out.at(-1)?.type !== "gap" && out.length) out.push({ type: "gap" })
      continue
    }
    // A line out and the line that replaced it: the words that changed within it, when they share enough
    // at their ends to be read as one line rewritten
    const next = ops[k + 1]
    if (op.type === "removed" && next?.type === "added") {
      const h = hunk(op.text, next.text)
      const after = op.text.slice(h.at + h.removed.length)
      if (h.at + after.length >= Math.min(op.text.length, next.text.length) * 0.4) {
        out.push({ type: "change", before: op.text.slice(0, h.at), removed: h.removed, added: h.added, after })
        k++
        continue
      }
    }
    if (op.text.trim()) out.push({ type: op.type, text: op.text })
  }
  if (out.at(-1)?.type === "gap") out.pop()
  return out
}
