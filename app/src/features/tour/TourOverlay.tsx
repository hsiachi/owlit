import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useDocsStore } from "@/features/docs/store"
import { cn } from "@/lib/utils"
import { useTour } from "./store"

// The tour: the page dims around one part of the real app, a card beside it says what it does, and the
// spotlight glides to the next stop. Nothing is blocked: the dim lets clicks through, so the user can do
// what a stop shows (open the paper, switch to the PDF), and a stop that waits for that moves on by itself
// once it's done. Next is always there too; Skip tour or Esc ends it.

// The example's paper the tour opens, and its draft
const PAPER = "arxiv-2310.11511"
const DRAFT = "Hallucination in RAG/Related work.md"

interface Stop {
  kicker: () => string
  title: () => string
  body: () => ReactNode
  // What the spotlight falls on; while it isn't on screen the card waits in the middle
  target: string
  // Takes the user where the stop is, as it begins
  enter?: (navigate: NavigateFunction, pathname: string) => void
  // The stop moves on by itself once this holds, with a line saying what it waits for
  done?: (pathname: string) => boolean
  waiting?: () => string
}

const radio = (n: number) => document.querySelector<HTMLElement>(`[data-tour="digest-switch"] [role="radio"]:nth-of-type(${n})`)

const STOPS: Stop[] = [
  {
    kicker: () => t`Library`,
    title: () => t`The example's papers`,
    body: () => t`Eight papers on hallucination and retrieval are already here. Open one to read it.`,
    target: `[data-paper-id="${PAPER}"], [data-paper-id]`,
    enter: (navigate, pathname) => pathname !== "/library" && navigate("/library"),
    done: (pathname) => pathname.startsWith("/library/"),
    waiting: () => t`Waiting for you to open a paper…`,
  },
  {
    kicker: () => t`Reading`,
    title: () => t`Owlit's digest`,
    body: () => t`A paper opens on Owlit's digest: what it asks, how, and what it found, with page links. Switch to the PDF to read the paper itself.`,
    target: '[data-tour="digest-switch"] [role="radiogroup"]',
    enter: (navigate, pathname) => !pathname.startsWith("/library/") && navigate(`/library/${PAPER}`),
    done: () => radio(2)?.getAttribute("aria-checked") === "true",
    waiting: () => t`Try switching to the PDF…`,
  },
  {
    kicker: () => t`Reading`,
    title: () => t`Select to highlight or ask`,
    body: () => t`Select any sentence: pick a colour to highlight it, comment on it, or ask Owlit about it.`,
    target: '[data-tour="reader"]',
    enter: (navigate, pathname) => {
      if (!pathname.startsWith("/library/")) navigate(`/library/${PAPER}`)
      // The PDF, not the digest over it
      setTimeout(() => radio(2)?.getAttribute("aria-checked") === "false" && radio(2)?.click(), 300)
    },
  },
  {
    kicker: () => t`Docs`,
    title: () => t`Cite as you write`,
    body: () => (
      <Trans>
        The draft cites papers from the Library. Type <Key>@</Key> in any doc to add one.
      </Trans>
    ),
    target: '[data-tour="doc"]',
    enter: (navigate, pathname) => {
      if (pathname.startsWith("/docs/")) return
      const files = Object.values(useDocsStore.getState().files)
      const draft = files.find((f) => f.path === DRAFT) ?? files.find((f) => f.path.endsWith(".md"))
      navigate(draft ? `/docs/${draft.id}` : "/docs")
    },
  },
  {
    kicker: () => t`Owlit`,
    title: () => t`Ask from anywhere`,
    body: () => (
      <Trans>
        Press <Key>⌘J</Key> on any page to ask Owlit about what's on screen. It answers beside the page.
      </Trans>
    ),
    target: '[data-tour="ask"]',
  },
  {
    kicker: () => t`That's it`,
    title: () => t`Help is here`,
    body: () => t`Take the tour again, see every shortcut, or ask Owlit how to do something. When you're ready, File › Open Workspace opens a folder of your own.`,
    target: '[data-tour="help"]',
  },
]

function Key({ children }: { children: ReactNode }) {
  return <kbd className="mx-0.5 inline-flex h-5 items-center rounded-md bg-muted px-1.5 align-[1px] font-sans text-xs font-medium text-muted-foreground">{children}</kbd>
}

type Rect = { left: number; top: number; width: number; height: number }
const PAD = 6
const GAP = 14
const CARD_WIDTH = 320

export function TourOverlay() {
  const stop = useTour((s) => s.stop)
  if (stop === null) return null
  return <Tour index={stop} />
}

function Tour({ index }: { index: number }) {
  const { go, end } = useTour()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const stop = STOPS[index]
  const last = index === STOPS.length - 1
  const [rect, setRect] = useState<Rect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const [cardAt, setCardAt] = useState<{ left: number; top: number } | null>(null)
  const next = () => (last ? end() : go(index + 1))

  // Going to where the stop is
  useEffect(() => {
    stop.enter?.(navigate, pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // The spotlight follows its target every frame (pages settle, panels open); a stop that waits moves on
  // once the user has done the thing
  const where = useRef(pathname)
  where.current = pathname
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = document.querySelector(stop.target)
      const r = el?.getBoundingClientRect()
      setRect((prev) => {
        if (!r || !r.width) return null
        const nextRect = { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }
        return prev && Math.abs(prev.left - nextRect.left) + Math.abs(prev.top - nextRect.top) + Math.abs(prev.width - nextRect.width) + Math.abs(prev.height - nextRect.height) < 0.5 ? prev : nextRect
      })
      if (stop.done?.(where.current)) return void go(index + 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stop, index, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && end()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [end])

  // The card beside the spotlight: below it when there's room, else above, else to its side
  useLayoutEffect(() => {
    const height = card.current?.offsetHeight ?? 180
    const w = window.innerWidth
    const h = window.innerHeight
    if (!rect) return setCardAt({ left: (w - CARD_WIDTH) / 2, top: (h - height) / 2 })
    const clampX = (x: number) => Math.max(12, Math.min(w - CARD_WIDTH - 12, x))
    const bottom = rect.top + rect.height
    if (h - bottom >= height + GAP + 12 && rect.height < h / 2) return setCardAt({ left: clampX(rect.left), top: bottom + GAP })
    if (rect.top >= height + GAP + 12 && rect.height < h / 2) return setCardAt({ left: clampX(rect.left), top: rect.top - GAP - height })
    const right = rect.left + rect.width
    const top = Math.max(12, Math.min(h - height - 12, rect.top + rect.height / 2 - height / 2))
    setCardAt(w - right >= CARD_WIDTH + GAP + 12 ? { left: right + GAP, top } : { left: Math.max(12, rect.left - GAP - CARD_WIDTH), top })
  }, [rect, index])

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        aria-hidden
        className={cn("absolute rounded-xl transition-all duration-500 ease-(--ease)", !rect && "opacity-0")}
        style={{
          ...(rect ?? { left: "50%", top: "50%", width: 0, height: 0 }),
          boxShadow: "0 0 0 9999px oklch(0.15 0.01 60 / 45%)",
        }}
      >
        <span className="absolute -inset-[3px] animate-pulse rounded-[15px] ring-2 ring-white/80" />
      </div>
      <div
        ref={card}
        role="dialog"
        aria-label={stop.title()}
        className="menu-surface pointer-events-auto absolute rounded-xl bg-popover px-4 pt-4 pb-3 text-popover-foreground transition-[left,top,opacity] duration-500 ease-(--ease)"
        style={{ width: CARD_WIDTH, ...(cardAt ?? { left: -9999, top: 0 }) }}
      >
        <div className="text-xs font-medium text-muted-foreground">
          {stop.kicker()} · {t`${index + 1} of ${STOPS.length}`}
        </div>
        <div key={index} className="animate-in fade-in duration-300">
          <div className="mt-1 mb-1.5 text-[15px] font-semibold">{stop.title()}</div>
          <div className="text-sm leading-normal text-muted-foreground">{stop.body()}</div>
          {stop.waiting && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-owlit">
              <span className="size-2.5 animate-ring-breathe rounded-full border-[1.5px] border-owlit-mark" />
              {stop.waiting()}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1">
          <div className="flex flex-1 gap-1">
            {STOPS.map((_, i) => (
              <span key={i} className={cn("size-1.5 rounded-full bg-foreground/15 transition-colors", i === index && "bg-foreground/80")} />
            ))}
          </div>
          {!last && (
            <Button variant="ghost" size="sm" onClick={end}>
              {t`Skip tour`}
            </Button>
          )}
          <Button size="sm" onClick={next} autoFocus>
            {last ? t({ message: "Done", comment: "ends the tour" }) : t({ message: "Next", comment: "the tour's next stop" })}
          </Button>
        </div>
      </div>
    </div>
  )
}
