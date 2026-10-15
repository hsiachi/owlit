import { describe, expect, it } from "vitest"
import { FINISH_MS, revealStep, wordEnd } from "./reveal"

const FRAME = 1000 / 60
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 10}`).join(" ") + " "

// Plays chunks [arrival ms, text] at 60 frames a second, the answer ending at `end`; returns what each
// frame added and the frame the whole answer was shown
function replay(chunks: [number, string][], end: number) {
  let text = "", k = 0, pos = 0, shown = 0
  const added: number[] = []
  for (let t = 0; ; t += FRAME) {
    while (k < chunks.length && chunks[k][0] <= t) text += chunks[k++][1]
    pos = revealStep(pos, text.length, FRAME, t >= end ? Math.max(0, end + FINISH_MS - t) : null)
    const next = Math.max(shown, wordEnd(text, pos))
    added.push(next - shown)
    shown = next
    if (t >= end && shown === text.length) return { added, doneAt: t }
  }
}

describe("paced reveal", () => {
  // As Claude Code sends: two words every 50ms, then a half-second pause and two lines at once
  const chunks: [number, string][] = []
  for (let i = 0; i < 40; i++) chunks.push([i * 50, words(2)])
  chunks.push([2450, words(30)])
  for (let i = 0; i < 20; i++) chunks.push([2500 + i * 50, words(2)])
  const end = 3500 + 40

  it("turns a burst into an even run of a few words a frame", () => {
    const { added } = replay(chunks, end)
    // Unpaced, the burst would add 180 characters in one frame
    expect(Math.max(...added)).toBeLessThan(30)
  })

  it("shows what is left within the finish once the answer ends", () => {
    const { doneAt } = replay(chunks, end)
    expect(doneAt - end).toBeLessThanOrEqual(FINISH_MS + FRAME)
  })

  it("catches up at once after a long gap (a hidden window)", () => {
    expect(revealStep(0, 2000, 400, null)).toBe(2000)
  })
})

describe("word end", () => {
  it("never stops inside a word", () => {
    expect(wordEnd("one two three", 6)).toBe(3)
    expect(wordEnd("one two three", 7)).toBe(7)
    expect(wordEnd("one two three", 99)).toBe(13)
  })

  it("holds a word with no space until it is passed", () => {
    expect(wordEnd("see https://example.org/a/b", 20)).toBe(3)
  })
})
