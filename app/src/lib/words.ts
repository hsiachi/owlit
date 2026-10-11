// Small helpers for the sentences the interface says

// "a, b and c"
export const joinAnd = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`)

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// "1 line", "3 lines"; `many` for words that don't just take an s
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// A query's words, and whether all of them appear in a text, ignoring case
export const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
export const hasAllWords = (text: string, words: string[]) => {
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}
