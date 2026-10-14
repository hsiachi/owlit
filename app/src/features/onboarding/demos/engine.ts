import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

// The demos' timeline: each scene is a short script (wait, change the picture, move the pointer, click)
// that runs while the scene is mounted and loops after its pause, as the prototype's did. The picture is
// state, drawn by the scene; the script only changes it. Unmounting stops it at once: every timer is
// cleared, and nothing it would have done afterwards happens.

const REDUCED = "(prefers-reduced-motion: reduce)"
const subscribeReduced = (onChange: () => void) => {
  const query = matchMedia(REDUCED)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

// With reduced motion a scene shows its last frame, still
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => matchMedia(REDUCED).matches,
    () => false,
  )
}

export interface CursorState {
  x: number
  y: number
  on: boolean
  press: boolean
  // How long the move to (x, y) takes
  ms: number
}

// One picture of a scene. A scene that changes to another view (the Library to the open paper) starts a
// new layer, and the two cross-fade, as a page switch in the sheet does.
export interface Layer<S> {
  id: number
  state: S
  leaving?: boolean
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Script<S> {
  sleep(ms: number): Promise<void>
  // Change the current picture
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void
  // A new picture that cross-fades in over the current one
  scene(next: S): void
  // Run `fn` after `ms` without waiting for it (a count's bump settling)
  later(ms: number, fn: () => void): void
  // Type `text` into a string field of the picture, a character at a time, as a person would
  type(key: keyof S, text: string, ms?: number): Promise<void>
  moveTo(x: number, y: number, ms?: number): Promise<void>
  // Move to a point inside a named element: dx, dy are fractions of its box
  moveToEl(name: string, dx?: number, dy?: number, ms?: number): Promise<void>
  click(): Promise<void>
  hideCursor(): void
  // A named element's box in the scene, in the window's own pixels (whatever scale the window is drawn at)
  at(name: string): Box | null
  // Its line boxes, for words that wrap
  lines(name: string): Box[]
}

interface Run<S> {
  layers: Layer<S>[]
  cursor: CursorState
  next: number
}

const HIDDEN: CursorState = { x: 0, y: 0, on: false, press: false, ms: 700 }
const STOP = Symbol("stop")
// The cross-fade between two pictures; the old one is dropped once it has gone
export const FADE_MS = 320

// `restart`: what the script shows, beyond its own words (a name, an agent); a change starts it again
export function useScript<S>({ initial, final, script, restart }: { initial: () => S; final: () => S; script: (c: Script<S>) => Promise<void>; restart?: string }) {
  const reduced = useReducedMotion()
  const [run, setRun] = useState<Run<S>>(() => ({ layers: [{ id: 0, state: initial() }], cursor: HIDDEN, next: 1 }))
  // The script as of the last render, read when it starts
  const latest = useRef({ initial, script })
  useLayoutEffect(() => {
    latest.current = { initial, script }
  })
  const root = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const refs = useRef(new Map<string, (el: HTMLElement | null) => () => void>())
  // Whether the picture has moved off its first frame, so a restart (new props, motion allowed again) starts clean
  const dirty = useRef(false)

  // A callback ref per name, kept, so React doesn't detach and attach it on every render. Two layers can
  // name the same element while they cross-fade; the newer one wins, and the older one leaving doesn't
  // take the name with it.
  const reg = useCallback((name: string) => {
    let ref = refs.current.get(name)
    if (!ref) {
      ref = (el: HTMLElement | null) => {
        if (el) els.current.set(name, el)
        return () => {
          if (el && els.current.get(name) === el) els.current.delete(name)
        }
      }
      refs.current.set(name, ref)
    }
    return ref
  }, [])

  useEffect(() => {
    if (reduced) return
    const { initial, script } = latest.current
    let alive = true
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const timer = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timers.delete(id)
        if (alive) fn()
      }, ms)
      timers.add(id)
    }
    const sleep = (ms: number) => new Promise<void>((resolve) => timer(ms, resolve))
    const update = (fn: (r: Run<S>) => Run<S>) => {
      if (!alive) throw STOP
      dirty.current = true
      setRun(fn)
    }
    const setCursor = (patch: Partial<CursorState>) => update((r) => ({ ...r, cursor: { ...r.cursor, ...patch } }))
    const box = (el: Element | DOMRect, origin: DOMRect, scale: number): Box => {
      const r = el instanceof DOMRect ? el : el.getBoundingClientRect()
      return { x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale }
    }
    const frame = () => {
      const el = root.current
      if (!el) return null
      const origin = el.getBoundingClientRect()
      return { origin, scale: origin.width / (el.offsetWidth || 1) || 1 }
    }

    const c: Script<S> = {
      sleep,
      set: (patch) =>
        update((r) => ({
          ...r,
          layers: r.layers.map((l, i) => (i === r.layers.length - 1 ? { ...l, state: { ...l.state, ...(typeof patch === "function" ? patch(l.state) : patch) } } : l)),
        })),
      scene: (next) => {
        update((r) => ({
          ...r,
          next: r.next + 1,
          layers: [...r.layers.map((l, i) => (i === r.layers.length - 1 ? { ...l, leaving: true } : l)), { id: r.next, state: next }],
        }))
        timer(FADE_MS, () => setRun((r) => ({ ...r, layers: r.layers.filter((l) => !l.leaving || l === r.layers[r.layers.length - 1]) })))
      },
      later: timer,
      type: async (key, text, ms = 38) => {
        for (const ch of text) {
          c.set((s) => ({ [key]: `${(s[key] as string | null) ?? ""}${ch}` }) as Partial<S>)
          await sleep(ms + Math.random() * 25)
        }
      },
      moveTo: async (x, y, ms = 700) => {
        setCursor({ x, y, ms, on: true })
        await sleep(ms)
      },
      moveToEl: async (name, dx = 0.5, dy = 0.5, ms) => {
        const p = c.at(name)
        if (p) await c.moveTo(p.x + p.w * dx, p.y + p.h * dy, ms)
      },
      click: async () => {
        setCursor({ press: true })
        await sleep(140)
        setCursor({ press: false })
        await sleep(120)
      },
      hideCursor: () => setCursor({ on: false }),
      at: (name) => {
        const el = els.current.get(name)
        const f = frame()
        return el && f ? box(el, f.origin, f.scale) : null
      },
      lines: (name) => {
        const el = els.current.get(name)
        const f = frame()
        return el && f ? [...el.getClientRects()].map((r) => box(r, f.origin, f.scale)) : []
      },
    }

    void (async () => {
      try {
        // A restart begins from the first frame again, faded in over whatever was showing
        if (dirty.current) c.scene(initial())
        for (;;) {
          await script(c)
          c.hideCursor()
          c.scene(initial())
        }
      } catch (e) {
        if (e !== STOP) throw e
      }
    })()

    return () => {
      alive = false
      for (const id of timers) clearTimeout(id)
    }
    // It starts again when motion is allowed again, or when what it shows changes
  }, [reduced, restart])

  const shown: Run<S> = reduced ? { layers: [{ id: -1, state: final() }], cursor: HIDDEN, next: 0 } : run
  return { layers: shown.layers, cursor: shown.cursor, root, reg }
}

// A word-by-word reveal: the words of `text` (in any language), each with what follows it, so a stream
// of them reads as typing
export function words(text: string, locale: string): string[] {
  const out: string[] = []
  for (const s of new Intl.Segmenter(locale, { granularity: "word" }).segment(text)) {
    if (s.isWordLike || out.length === 0) out.push(s.segment)
    else out[out.length - 1] += s.segment
  }
  return out
}

// A lift (a segment's thumb, a tab's underline) that travels to the chosen item, an element marked
// data-item inside `box`; placed without a move the first time, and again when the box resizes (a font
// settling). Measured in layout pixels, so the window's scale doesn't matter.
export function useTravel<B extends HTMLElement, M extends HTMLElement>(on: number) {
  const box = useRef<B>(null)
  const mark = useRef<M>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const el = box.current
    const m = mark.current
    if (!el || !m) return
    const place = () => {
      const target = el.querySelectorAll<HTMLElement>("[data-item]")[on]
      if (!target) return
      if (!placed.current) m.style.transition = "none"
      m.style.left = `${target.offsetLeft}px`
      m.style.width = `${target.offsetWidth}px`
      if (!placed.current) {
        void m.offsetWidth
        m.style.transition = ""
        placed.current = true
      }
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [on])
  return { box, mark }
}
