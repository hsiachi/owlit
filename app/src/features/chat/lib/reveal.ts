// How an answer being written comes onto the screen. Agents send text in bursts (Claude Code pauses
// 0.3–0.5s a few times per answer and then a line or two lands at once; Codex sends
// clumps 8–10 times a second), so the shown text trails what has arrived and closes a share of the gap
// every frame: it runs about TRAIL_MS behind, speeds up by itself after a burst and slows into a pause,
// with no fixed speed to tune per agent.

// How far behind the shown text runs
export const TRAIL_MS = 150
// The slowest it goes while words are waiting (characters a second), so the last words before a pause
// come out instead of crawling
export const FLOOR_PER_S = 60
// What is still waiting when the answer ends comes out within this long, so the end never jumps and the
// answer's last word is never held up for more
export const FINISH_MS = 150

// Where the shown text reaches after `dt` ms, as a fractional position; `finishLeft` is how long is left
// of the finish once the answer has ended (null while it is still being written)
export function revealStep(pos: number, arrived: number, dt: number, finishLeft: number | null): number {
  const waiting = arrived - pos
  if (waiting <= 0) return arrived
  let step = Math.max((waiting * dt) / TRAIL_MS, Math.min(waiting, (FLOOR_PER_S * dt) / 1000))
  if (finishLeft !== null) step = Math.max(step, finishLeft <= dt ? waiting : (waiting * dt) / finishLeft)
  return Math.min(arrived, pos + step)
}

// The length of text to show for a position: never half a word. Where words are spaced it stops at the
// last whitespace at or before it, so a word with no space (a formula, a link's address) shows whole once
// it is passed. Chinese and Japanese leave no space between words, so there it stops at a word boundary
// Intl.Segmenter finds (without one the text would wait for the paragraph's end and land in lumps).
export function wordEnd(text: string, pos: number, locale = "en"): number {
  if (pos >= text.length) return text.length
  const at = Math.floor(pos)
  // Only the text around the position is segmented, each frame: a word ends within LOOK_BACK before it, and
  // LOOK_AHEAD after it says whether the word there goes on
  const from = Math.max(0, at - LOOK_BACK)
  let cut = -1
  for (const { index } of segmenterFor(locale).segment(text.slice(from, at + LOOK_AHEAD))) {
    const i = from + index
    if (i > at) break
    // The slice's own start is a boundary only when it is the text's
    if (i === 0 || (i > from && (/\s/.test(text[i]!) || SPACELESS.test(text[i - 1]!) || SPACELESS.test(text[i]!)))) cut = i
  }
  if (cut >= 0) return cut
  for (let i = from; i > 0; i--) if (/\s/.test(text[i]!)) return i
  return 0
}

const LOOK_BACK = 32
const LOOK_AHEAD = 8

// Writing without spaces between words: Han, kana, Hangul, and the CJK punctuation and full-width forms
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u

const segmenters = new Map<string, Intl.Segmenter>()
function segmenterFor(locale: string) {
  let s = segmenters.get(locale)
  if (!s) segmenters.set(locale, (s = new Intl.Segmenter(locale, { granularity: "word" })))
  return s
}
