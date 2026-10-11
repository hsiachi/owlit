// Comparing two versions of a text by what they share at either end

// How many characters a and b share at the start
export function sharedStart(a: string, b: string) {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// How many they share at the end, at most `limit`
export function sharedEnd(a: string, b: string, limit = Math.min(a.length, b.length)) {
  let n = 0
  while (n < limit && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

// The one span that turns `from` into `to`, between their shared prefix and suffix
export function spanChange(from: string, to: string) {
  const start = sharedStart(from, to)
  const end = sharedEnd(from, to, Math.min(from.length, to.length) - start)
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}

// A letter or digit of a script that spaces its words. Han and kana run on without spaces, so widening to
// the whole run there would take in the sentence.
const isWord = (c: string | undefined) =>
  c !== undefined && /[\p{L}\p{N}_]/u.test(c) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c)

// The one span an edit changes, as words: its ends are widened to whole words, so "mostly" to "mainly"
// reads as one word swapped, not "m(ost)(ain)ly"
export function hunk(oldText: string, newText: string) {
  const change = spanChange(oldText, newText)
  let p = change.from
  let s = oldText.length - change.to
  while (p > 0 && isWord(oldText[p - 1]) && (isWord(oldText[p]) || isWord(newText[p]))) p--
  while (s > 0 && isWord(oldText[oldText.length - s]) && (isWord(oldText[oldText.length - s - 1]) || isWord(newText[newText.length - s - 1]))) s--
  return { at: p, removed: oldText.slice(p, oldText.length - s), added: newText.slice(p, newText.length - s) }
}
