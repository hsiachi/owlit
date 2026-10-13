import { plural } from "@lingui/core/macro"
import { intlLocale } from "@owlit/i18n"
import type { EditStats } from "@owlit/protocol"

const number = (n: number) => n.toLocaleString(intlLocale())

// What an edit added and took out ("+1,240", "−380"), and the unit when it counts lines: prose counts words,
// and lines elsewhere carry their unit ("+12 −3 lines"), so the two never read as one measure
export function countParts({ unit, added, removed }: EditStats) {
  const lines = added + removed
  return {
    added: added ? `+${number(added)}` : undefined,
    removed: removed ? `−${number(removed)}` : undefined,
    unit: unit === "lines" && lines > 0 ? plural(lines, { one: "line", other: "lines" }) : undefined,
  }
}

// "+1,240 −380", "+12 −3 lines": the counts as plain text
export function countsText(stats: EditStats) {
  const { added, removed, unit } = countParts(stats)
  return [added, removed, unit].filter(Boolean).join(" ")
}

// "1,240 words", "1 line": an amount in the edit's unit, for a sentence
export function amount(n: number, unit: EditStats["unit"]) {
  const shown = number(n)
  return unit === "words" ? plural(n, { one: `${shown} word`, other: `${shown} words` }) : plural(n, { one: `${shown} line`, other: `${shown} lines` })
}
