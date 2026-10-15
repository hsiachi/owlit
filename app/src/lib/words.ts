import { t } from "@lingui/core/macro"

// Small helpers for the sentences the interface says. Counted words ("3 lines") are Lingui plurals where
// they are said, since each language counts its own way.

// "a, b and c": things in a list. Each language joins its own way ("a、b和c"), so the comma and the last
// "and" are messages.
export function joinAnd(items: string[]) {
  if (items.length <= 1) return items[0] ?? ""
  const rest = items.slice(0, -1).join(t({ message: ", ", context: "between things in a list" }))
  const last = items.at(-1)!
  return t({ message: `${rest} and ${last}`, context: "the last thing in a list" })
}

// "read 3 files, searched the web twice and opened a page": things done, joined the same way in English
// but not in every language (Chinese joins clauses with "，", things with "、")
export function joinActions(actions: string[]) {
  if (actions.length <= 1) return actions[0] ?? ""
  const rest = actions.slice(0, -1).join(t({ message: ", ", context: "between actions in a sentence" }))
  const last = actions.at(-1)!
  return t({ message: `${rest} and ${last}`, context: "the last action in a sentence" })
}

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A query's words, and whether all of them appear in a text, ignoring case
export const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
export const hasAllWords = (text: string, words: string[]) => {
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}

// Cut at a word boundary, so a chip never ends mid-word ("Scholars need to k…")
export const shorten = (text: string, n: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= n) return flat
  const cut = flat.slice(0, n + 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > n / 2 ? cut.slice(0, space) : flat.slice(0, n)).replace(/[\s,.;:]+$/, "")}…`
}
