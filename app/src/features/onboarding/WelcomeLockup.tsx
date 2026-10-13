import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { FEATHER, LETTERS, LOCKUP_VIEWBOX, TITTLE, TITTLE_CENTRE } from "@/lib/lockup"
import { cn } from "@/lib/utils"

// The first thing a new user sees: the feather draws itself in one stroke in the middle, lifts as a pen,
// writes the wordmark stroke by stroke, takes aim over the i and dots it in Owlit's green, then comes home
// on the left as the word slides right to make room. One rAF timeline drives it, and frame(t) draws any
// moment on its own, so a skip is just the last frame. The last frame is the lockup itself.

type Pose = [x: number, y: number, rotate: number, scale: number]

// The nib is the feather's start point, in the lockup's units; the pen is placed by where its nib is
const NIB = [4.25, 15.76] as const
const REST: Pose = [NIB[0], NIB[1], 0, 1]
// The word alone is centred while it's written (its middle is x 204, the box's 149); the feather is drawn
// 101 units right of its resting place, which centres it
const OFF = -55
const DRAWN: Pose = [NIB[0] + 101, NIB[1], 0, 1]
// After the last letter the pen takes aim above the i before the tap, so the green dot lands as a small reveal
const AT = { draw: 150, drawn: 1550, lift: 1700, write: 2100, dot: 4300, tap: 4950, home: 5250, rest: 5950, end: 6050 }
const TILT = 14
const PEN = 0.8
const PAUSE = 80
const ABOVE: Pose = [264.6, -79, TILT + 4, PEN + 0.03]
const TAP: Pose = [TITTLE_CENTRE[0], TITTLE_CENTRE[1], TILT + 4, PEN]

// Each stroke's centerline in writing order and direction, with the letter it reveals. Stroked a little
// wider than the letters' ~8 units, so one pass covers a stroke edge to edge.
const STROKES: { letter: keyof typeof LETTERS; d: string }[] = [
  {
    letter: "o",
    d: "M145.53 -40.11C144.46 -40.75 141.4 -43.34 139.1 -43.93C136.79 -44.53 133.96 -44.21 131.69 -43.66C129.43 -43.11 127.3 -41.85 125.51 -40.64C123.73 -39.42 122.22 -37.9 120.99 -36.37C119.75 -34.84 118.8 -33.15 118.08 -31.47C117.36 -29.78 117.1 -28.04 116.67 -26.25C116.24 -24.46 115.79 -22.79 115.49 -20.73C115.19 -18.67 114.48 -16.16 114.87 -13.89C115.27 -11.62 116.3 -8.88 117.87 -7.1C119.44 -5.33 122 -3.84 124.3 -3.25C126.61 -2.67 129.44 -3.01 131.7 -3.58C133.95 -4.15 136.06 -5.46 137.84 -6.69C139.61 -7.92 141.1 -9.43 142.34 -10.94C143.58 -12.45 144.55 -14.08 145.28 -15.75C146.01 -17.42 146.3 -19.17 146.74 -20.95C147.18 -22.73 147.6 -24.39 147.91 -26.45C148.22 -28.52 148.99 -31.07 148.59 -33.35C148.2 -35.62 147.11 -38.35 145.53 -40.11C143.95 -41.88 140.17 -43.3 139.1 -43.93",
  },
  { letter: "w", d: "M164.95 -45L172.25 -2.3L193.1 -42L197.1 -1.4L222.4 -45" },
  { letter: "l", d: "M244.33 -73.1L229.43 -3" },
  { letter: "i", d: "M259.25 -44.5L250.43 -3" },
  { letter: "t", d: "M283.74 -66.6L272.8 -15.1Q270.37 -3.65 282 -3.65L285.6 -3.65" },
  { letter: "t", d: "M281 -44.15L295 -44.15" },
]

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (t: number) => Math.max(0, Math.min(1, t))
const mix = (a: Pose, b: Pose, t: number): Pose => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]

interface Stroke {
  el: SVGPathElement
  len: number
  s: number[]
  at: number[]
  cost: number
}

// Direction of travel at s, over a window of ±w
function heading(el: SVGPathElement, len: number, s: number, w = 0.5) {
  const a = el.getPointAtLength(Math.max(0, s - w))
  const b = el.getPointAtLength(Math.min(len, s + w))
  return Math.atan2(b.y - a.y, b.x - a.x)
}

// A hand slows into turns and at a stroke's start and end: time per unit of length grows with how much the
// line turns nearby (a bell over ±12 units, so it eases into a corner). at[k] is the share of the stroke's
// time spent by the time it reaches s[k].
function pace(el: SVGPathElement): Stroke {
  const len = el.getTotalLength()
  const K = Math.ceil(len * 2)
  const s: number[] = []
  const turn = [0]
  const at = [0]
  for (let k = 0; k <= K; k++) s.push((len * k) / K)
  for (let k = 1; k <= K; k++) {
    const d = heading(el, len, s[k]) - heading(el, len, s[k - 1])
    turn.push(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))))
  }
  for (let k = 1; k <= K; k++) {
    let bend = 0
    for (let j = k - 24; j <= k + 24; j++) bend += turn[Math.max(0, Math.min(K, j))] * Math.exp(-(((j - k) / 8) ** 2) / 2)
    at.push(at[k - 1] + (1 + 1.2 * bend) * (1 + 1.4 * Math.exp(-s[k] / 4)) * (1 + 0.6 * Math.exp((s[k] - len) / 4)))
  }
  // Plus a moment to set the nib down
  return { el, len, s, cost: (at[K] * len) / K + 10, at: at.map((v) => v / at[K]) }
}

// Length written once share f of the stroke's time has passed
function lengthAt(st: Stroke, f: number) {
  let lo = 0
  let hi = st.at.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (st.at[m] < f) lo = m
    else hi = m
  }
  return lerp(st.s[lo], st.s[hi], clamp((f - st.at[lo]) / (st.at[hi] - st.at[lo] || 1)))
}

// The pen on a stroke: nib on the point, leaning a little further over when it moves right
function writing(st: Stroke, s: number): Pose {
  const p = st.el.getPointAtLength(s)
  return [p.x, p.y, TILT + 6 * Math.cos(heading(st.el, st.len, s, 5)), PEN]
}

// Between strokes the pen lifts, pauses, crosses in an arc, and comes down on the next start
function airborne(a: Pose, b: Pose, ms: number, dur: number): Pose {
  if (ms < PAUSE) {
    const k = ease(ms / PAUSE)
    return [a[0], a[1] - 3 * k, a[2], PEN + 0.02 * k]
  }
  const v = ease((ms - PAUSE) / (dur - PAUSE))
  const hop = 3 * (1 - v) + 0.1 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.sin(Math.PI * v)
  return [lerp(a[0], b[0], v), lerp(a[1], b[1], v) - hop, lerp(a[2], b[2], v), PEN + 0.02 * Math.min(1, hop / 3)]
}

type Step = { st: Stroke; t0: number; t1: number } | { from: Pose; to: Pose; t0: number; t1: number }

// Ink and air in turn, timed so the word fills AT.write…AT.dot; ink time follows each stroke's pace
function plan(strokes: Stroke[]): Step[] {
  const ends = strokes.map((st) => [writing(st, 0), writing(st, st.len)])
  const air = strokes.slice(1).map((_, i) => PAUSE + 40 + 0.6 * Math.hypot(ends[i + 1][0][0] - ends[i][1][0], ends[i + 1][0][1] - ends[i][1][1]))
  const k = (AT.dot - AT.write - air.reduce((x, y) => x + y, 0)) / strokes.reduce((x, st) => x + st.cost, 0)
  const steps: Step[] = []
  let t = AT.write
  strokes.forEach((st, i) => {
    steps.push({ st, t0: t, t1: (t += st.cost * k) })
    if (i < air.length) steps.push({ from: ends[i][1], to: ends[i + 1][0], t0: t, t1: (t += air[i]) })
  })
  return steps
}

interface Parts {
  quill: SVGGElement
  quillPath: SVGPathElement
  quillLen: number
  word: SVGGElement
  whole: SVGPathElement
  letters: SVGGElement
  tittle: SVGPathElement
  ripple: SVGCircleElement
  strokes: Stroke[]
  steps: Step[]
}

// The pen's pose through the whole timeline
function pose(p: Parts, t: number): Pose {
  const start = writing(p.strokes[0], 0)
  const last = p.strokes.at(-1)!
  const end = writing(last, last.len)
  if (t < AT.write) {
    // The feather lifts off where it was drawn and tilts into a pen over the o
    const v = ease((t - AT.lift) / (AT.write - AT.lift))
    const q = mix([DRAWN[0] - OFF, DRAWN[1], DRAWN[2], DRAWN[3]], start, v)
    return [q[0], q[1] - 14 * Math.sin(Math.PI * v), q[2], q[3] + 0.04 * Math.sin(Math.PI * v)]
  }
  if (t < AT.dot) {
    const step = p.steps.find((g) => t < g.t1) ?? p.steps.at(-1)!
    const f = clamp((t - step.t0) / (step.t1 - step.t0))
    return "st" in step ? writing(step.st, lengthAt(step.st, f)) : airborne(step.from, step.to, t - step.t0, step.t1 - step.t0)
  }
  if (t < AT.tap) {
    // Never a dead hold: the pen glides up over the i and slows into the top of its arc (a long ease-out,
    // which is the pause), leaning in as if taking aim, then drops onto the i, quickening as it lands
    const f = (t - AT.dot) / (AT.tap - AT.dot)
    const apex: Pose = [ABOVE[0], ABOVE[1] - 4, TILT + 9, ABOVE[3]]
    if (f < 0.72) {
      const v = 1 - (1 - f / 0.72) ** 3
      return [lerp(end[0], apex[0], v), lerp(end[1], apex[1], v) - 5 * Math.sin(Math.PI * Math.min(1, v * 1.4)) * (1 - v), lerp(end[2], apex[2], v), apex[3]]
    }
    return mix(apex, TAP, ((f - 0.72) / 0.28) ** 2.2)
  }
  if (t < AT.tap + 30) return TAP
  if (t < AT.home) return mix(TAP, ABOVE, 1 - (1 - (t - AT.tap - 30) / (AT.home - AT.tap - 30)) ** 2)
  if (t >= AT.rest) return REST
  // Home in an arc over the word, settling as the lockup's feather
  const v = ease((t - AT.home) / (AT.rest - AT.home))
  const mid = [150, -78]
  const x = lerp(lerp(ABOVE[0], mid[0], v), lerp(mid[0], REST[0], v), v)
  const y = lerp(lerp(ABOVE[1], mid[1], v), lerp(mid[1], REST[1], v), v)
  return [x, y, lerp(ABOVE[2], 0, v), lerp(ABOVE[3], 1, v)]
}

// One frame at t ms
function frame(p: Parts, t: number) {
  t = Math.max(0, Math.min(t, AT.end))
  // The feather draws itself from the nib
  const drawn = ease(clamp((t - AT.draw) / (AT.drawn - AT.draw)))
  p.quillPath.style.strokeDasharray = drawn < 1 ? `${p.quillLen} ${p.quillLen}` : ""
  p.quillPath.style.strokeDashoffset = drawn < 1 ? String(p.quillLen * (1 - drawn)) : ""
  p.quill.style.opacity = t < AT.draw ? "0" : "1"
  // The word's offset eases out while the feather flies home, so the two arrive together
  const dx = OFF * (1 - ease(clamp((t - AT.home - 150) / (AT.rest - AT.home - 150))))
  p.word.setAttribute("transform", `translate(${dx} 0)`)
  const q = t < AT.lift ? DRAWN : pose(p, t)
  const x = t < AT.lift || t >= AT.rest ? q[0] : q[0] + dx
  p.quill.setAttribute("transform", `translate(${x} ${q[1]}) rotate(${q[2]}) scale(${q[3]}) translate(${-NIB[0]} ${-NIB[1]})`)
  // Ink: each stroke's centerline drawn on behind the nib; once written, the plain letters take over
  const written = t >= AT.dot
  p.whole.style.visibility = written ? "" : "hidden"
  p.letters.style.visibility = written ? "hidden" : ""
  for (const step of p.steps) {
    if (!("st" in step)) continue
    const s = t <= step.t0 ? 0 : t >= step.t1 ? step.st.len : lengthAt(step.st, (t - step.t0) / (step.t1 - step.t0))
    step.st.el.style.strokeDashoffset = String(step.st.len - s)
    // A zero-length dash would still leave a round dot
    step.st.el.style.visibility = s > 0 ? "" : "hidden"
  }
  // The dot lands with a small overshoot and a ring
  const c = t - AT.tap
  const ring = clamp(c / 700)
  const size = c < 0 ? 0 : c < 90 ? 1.35 * (1 - (1 - c / 90) ** 2) : lerp(1.35, 1, ease(clamp((c - 90) / 170)))
  const [cx, cy] = TITTLE_CENTRE
  p.tittle.setAttribute("transform", `translate(${cx} ${cy}) scale(${size}) translate(${-cx} ${-cy})`)
  p.ripple.setAttribute("r", String(lerp(5, 26, 1 - (1 - ring) ** 3)))
  p.ripple.style.opacity = String(c < 0 ? 0 : 0.7 * (1 - ring))
  return t < AT.end
}

export function WelcomeLockup({ onDone, className }: { onDone: () => void; className?: string }) {
  const svg = useRef<SVGSVGElement>(null)
  const [run, setRun] = useState(0)
  const [lit, setLit] = useState(false)
  const done = useRef(onDone)
  useLayoutEffect(() => {
    done.current = onDone
  })
  // When the last run ended: the click that skipped it isn't also a click to play it again
  const endedAt = useRef(0)

  useEffect(() => {
    const root = svg.current!
    const get = <T extends Element>(name: string) => root.querySelector<T>(`[data-part="${name}"]`)!
    const quillPath = get<SVGPathElement>("quill-path")
    const strokes = [...root.querySelectorAll<SVGPathElement>("[data-stroke]")].map((el) => {
      const st = pace(el)
      el.style.strokeDasharray = `${st.len} ${st.len + 20}`
      return st
    })
    const parts: Parts = {
      quill: get("quill"),
      quillPath,
      quillLen: quillPath.getTotalLength(),
      word: get("word"),
      whole: get("whole"),
      letters: get("letters"),
      tittle: get("tittle"),
      ripple: get("ripple"),
      strokes,
      steps: plan(strokes),
    }
    let raf = 0
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      endedAt.current = performance.now()
      cancelAnimationFrame(raf)
      frame(parts, AT.end)
      setLit(true)
      removeEventListener("pointerdown", skip, true)
      removeEventListener("keydown", skip, true)
      done.current()
    }
    // While it plays, a click or a key only skips to the end
    const skip = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      finish()
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish()
      return
    }
    addEventListener("pointerdown", skip, true)
    addEventListener("keydown", skip, true)
    frame(parts, 0)
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = now - t0
      if (t >= AT.tap) setLit(true)
      if (frame(parts, t)) raf = requestAnimationFrame(tick)
      else finish()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener("pointerdown", skip, true)
      removeEventListener("keydown", skip, true)
    }
  }, [run])

  return (
    <div className={cn("relative", className)}>
      {/* A faint green glow that comes on with the dot */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[560px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--color-owlit-mark)_10%,transparent),color-mix(in_oklch,var(--color-owlit-mark)_4%,transparent)_55%,transparent)] opacity-0 transition-opacity duration-1000",
          lit && "opacity-100",
        )}
      />
      <svg
        ref={svg}
        viewBox={LOCKUP_VIEWBOX}
        fill="none"
        role="img"
        aria-label="owlit"
        className="relative w-80 cursor-pointer overflow-visible text-foreground"
        // Afterwards, the lockup plays again when clicked
        onClick={() => {
          if (performance.now() - endedAt.current < 400) return
          setLit(false)
          setRun((n) => n + 1)
        }}
      >
        <defs>
          {(Object.keys(LETTERS) as (keyof typeof LETTERS)[]).map((letter) => (
            <mask key={letter} id={`welcome-ink-${letter}`}>
              {STROKES.filter((s) => s.letter === letter).map((s, i) => (
                <path key={i} data-stroke d={s.d} fill="none" stroke="#fff" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </mask>
          ))}
        </defs>
        <g data-part="word">
          <path data-part="whole" fill="currentColor" d={Object.values(LETTERS).join("")} />
          <g data-part="letters" fill="currentColor">
            {(Object.entries(LETTERS) as [keyof typeof LETTERS, string][]).map(([letter, d]) => (
              <path key={letter} d={d} mask={`url(#welcome-ink-${letter})`} />
            ))}
          </g>
          <circle data-part="ripple" cx={TITTLE_CENTRE[0]} cy={TITTLE_CENTRE[1]} r={5} className="fill-none stroke-owlit-mark" strokeWidth={1.2} opacity={0} />
          <path data-part="tittle" className="fill-owlit-mark" d={TITTLE} transform="scale(0)" />
        </g>
        <g data-part="quill" opacity={0}>
          <path data-part="quill-path" d={FEATHER.d} transform={FEATHER.transform} stroke="currentColor" strokeWidth={FEATHER.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  )
}
