import { describe, expect, it } from "vitest"
import { FINISH_MS, revealStep, wordEnd } from "./reveal"

const FRAME = 1000 / 60
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 10}`).join(" ") + " "

// Plays chunks [arrival ms, text] at 60 frames a second, the answer ending at `end`; returns what each
// frame added, the length shown at each frame's time, and the frame the whole answer was shown
function replay(chunks: [number, string][], end: number, locale = "en") {
  let text = "", k = 0, pos = 0, shown = 0
  const added: number[] = []
  const frames: { t: number; shown: number }[] = []
  for (let t = 0; ; t += FRAME) {
    while (k < chunks.length && chunks[k][0] <= t) text += chunks[k++][1]
    pos = revealStep(pos, text.length, FRAME, t >= end ? Math.max(0, end + FINISH_MS - t) : null)
    const next = Math.max(shown, wordEnd(text, pos, locale))
    added.push(next - shown)
    shown = next
    frames.push({ t, shown })
    if (t >= end && shown === text.length) return { added, frames, doneAt: t }
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

describe("paced reveal of Chinese", () => {
  // A paragraph with no spaces, as Claude Code sends it: 40 characters every 400ms
  const paragraph =
    "大型语言模型在检索增强生成中的表现取决于检索器的质量与上下文的组织方式。本文比较了三种检索策略在长文档问答任务上的效果，并分析了它们在不同领域数据上的稳定性。实验表明，基于稠密向量的检索在开放领域问题上明显优于传统的稀疏检索，但在专业术语密集的科学文献中，两者的差距显著缩小。我们进一步发现，将检索结果按段落重新排序并加入简短的来源说明，可以让模型更少地编造引用。最后，我们讨论了评测方法本身的局限。"
  const chunks: [number, string][] = []
  for (let i = 0; i * 40 < paragraph.length; i++) chunks.push([i * 400, paragraph.slice(i * 40, i * 40 + 40)])
  const end = chunks.at(-1)![0] + 40

  it("comes on a few characters a frame rather than a burst at once", () => {
    const { added } = replay(chunks, end, "zh-Hans")
    expect(Math.max(...added)).toBeLessThanOrEqual(30)
  })

  it("starts showing each burst within a frame of its arrival", () => {
    const { frames } = replay(chunks, end, "zh-Hans")
    chunks.forEach(([at], i) => {
      const before = i * 40
      const first = frames.find((f) => f.shown > before)!
      expect(first.t - at).toBeLessThanOrEqual(FRAME)
    })
  })

  it("never stops inside a word", () => {
    // 检索 is one word: never 检 alone
    expect(wordEnd("我们比较检索策略", 5, "zh-Hans")).toBe(4)
    expect(wordEnd("我们比较检索策略", 6, "zh-Hans")).toBe(6)
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
