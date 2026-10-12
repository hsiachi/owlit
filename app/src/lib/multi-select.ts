// Picking several rows of a list with ⌘- and ⇧-click, by key, over the rows in the order they show

export type PickMode = "single" | "toggle" | "range"

// ⌘ (Ctrl elsewhere) adds or drops one row, ⇧ takes the rows from the anchor, a plain click is a single pick
export const pickMode = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PickMode =>
  e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "single"

// The picks with the key added, or dropped when it was already picked
export const toggle = (picked: string[], key: string) => (picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key])

// The keys from one to the other, both included, in the list's order; only `to` when either isn't in it
export function range(order: string[], from: string, to: string) {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}
