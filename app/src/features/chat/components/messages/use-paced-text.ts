import { useEffect, useRef, useState } from "react"
import { FINISH_MS, revealStep, wordEnd } from "../../lib/reveal"

// How a text part is being shown: "live" while its answer is written, "ending" once it has ended (what is
// still waiting comes out within FINISH_MS), "off" for everything at once (stopped, broken)
export type Pace = "live" | "ending" | "off"

// The part of an answer's text to show now (lib/reveal.ts has the rule). Text first drawn with words in it
// (a chat opened in the middle of an answer, the first words of a part) shows them at once; only what
// arrives afterwards is paced. Under reduced motion the text shows as it arrives.
export function usePacedText(text: string, pace: Pace): string {
  const [shown, setShown] = useState(text.length)
  const live = useRef({ text, pace, pos: text.length, endsAt: 0, last: 0, frame: 0, sync: 0 })
  const instant = pace === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches

  useEffect(() => {
    const s = live.current
    s.text = text
    if (pace === "ending" && s.pace === "live") s.endsAt = performance.now() + FINISH_MS
    s.pace = pace
    if (instant) {
      // Drawn whole already; the count catches up so pacing can go on from here if it starts again
      cancelAnimationFrame(s.frame)
      cancelAnimationFrame(s.sync)
      s.frame = 0
      s.pos = text.length
      s.sync = requestAnimationFrame(() => setShown(s.text.length))
      return
    }
    if (s.frame || s.pos >= text.length) return
    s.last = performance.now()
    const tick = (now: number) => {
      const dt = now - s.last
      s.last = now
      s.pos = revealStep(s.pos, s.text.length, dt, s.pace === "ending" ? Math.max(0, s.endsAt - now) : null)
      const next = wordEnd(s.text, s.pos)
      setShown((n) => Math.max(n, next))
      s.frame = s.pos < s.text.length ? requestAnimationFrame(tick) : 0
    }
    s.frame = requestAnimationFrame(tick)
  }, [text, pace, instant])

  useEffect(() => {
    const s = live.current
    return () => {
      cancelAnimationFrame(s.frame)
      cancelAnimationFrame(s.sync)
    }
  }, [])

  return instant || shown >= text.length ? text : text.slice(0, shown)
}
