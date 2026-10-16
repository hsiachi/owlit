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

// The length of text to show for a position: never half a word, so it stops at the last whitespace at or
// before it. A word with no space (a formula, a link's address) shows whole once it is passed.
export function wordEnd(text: string, pos: number): number {
  if (pos >= text.length) return text.length
  for (let i = Math.floor(pos); i > 0; i--) if (/\s/.test(text[i])) return i
  return 0
}
