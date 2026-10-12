import type { EditStats } from "@owlit/protocol"

// What an edit added and took out ("+1,240", "−380"), and the unit when it counts lines: prose counts words,
// and lines elsewhere carry their unit ("+12 −3 lines"), so the two never read as one measure
export function countParts({ unit, added, removed }: EditStats) {
  return {
    added: added ? `+${added.toLocaleString()}` : undefined,
    removed: removed ? `−${removed.toLocaleString()}` : undefined,
    unit: unit === "lines" && added + removed > 0 ? (added + removed === 1 ? "line" : "lines") : undefined,
  }
}

// "+1,240 −380", "+12 −3 lines": the counts as plain text
export function countsText(stats: EditStats) {
  const { added, removed, unit } = countParts(stats)
  return [added, removed, unit].filter(Boolean).join(" ")
}

// "1,240 words", "1 line": an amount in the edit's unit, for a sentence
export const amount = (n: number, unit: EditStats["unit"]) => `${n.toLocaleString()} ${n === 1 ? unit.slice(0, -1) : unit}`
