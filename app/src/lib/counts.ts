// How many holders each key has (screens showing a chat, editors showing a file), as a record a store can
// keep: a key is there only while something holds it

export const countUp = (counts: Record<string, number>, key: string) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 })

export function countDown(counts: Record<string, number>, key: string) {
  const n = (counts[key] ?? 1) - 1
  const { [key]: _gone, ...rest } = counts
  return n > 0 ? { ...rest, [key]: n } : rest
}
