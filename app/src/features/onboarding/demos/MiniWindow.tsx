import { Children, isValidElement, useCallback, useEffect, useState, type ReactNode } from "react"
import { HouseIcon, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import { OwlitMark } from "@/components/owlit-mark"
import { FADE_MS } from "./engine"
import { DEMO_PLACES, DemoPlaceContext, type DemoPlace, type PlaceClaim } from "./place"
import s from "./demos.module.css"

// The rail's icons, as the app's rail draws them (app/nav.ts)
const ICON: Record<DemoPlace, LucideIcon> = {
  home: HouseIcon,
  chat: KIND_ICON.chat,
  docs: KIND_ICON.doc,
  collections: KIND_ICON.collection,
  library: KIND_ICON.paper,
}
const top = (i: number) => 8 + i * 30

// A small owlit window: the title bar with the feather, the rail of places with the current one lifted,
// and the sheet the scenes play on. It stays mounted while the flow swaps its scene, so the lift travels
// from place to place and one scene cross-fades into the next. A scene can say where it is (useDemoPlace),
// and that wins over `place` while it is shown.
export function MiniWindow({ place, children, className }: { place: DemoPlace | null; children: ReactNode; className?: string }) {
  const [claims, setClaims] = useState<{ token: symbol; claim: PlaceClaim }[]>([])
  const claim = useCallback((token: symbol, c: PlaceClaim | null) => {
    setClaims((list) => {
      if (!c) return list.filter((x) => x.token !== token)
      // A scene that moves keeps its rank; a scene newly shown goes on top
      return list.some((x) => x.token === token) ? list.map((x) => (x.token === token ? { token, claim: c } : x)) : [...list, { token, claim: c }]
    })
  }, [])
  const last = claims[claims.length - 1]?.claim
  const here = last ? last.place : place
  const at = here ? DEMO_PLACES.indexOf(here) : -1

  return (
    <div className={cn(s.mini, "bg-sidebar shadow-lg ring-1 ring-foreground/8 select-none dark:ring-foreground/14", className)} aria-hidden>
      <div className={s.tb}>
        <div className={s.lights}>
          <i />
          <i />
          <i />
        </div>
        <OwlitMark className={s.feather} />
      </div>
      <div className={s.rail}>
        <div className={cn(s.lift, "shadow-xs")} style={{ top: top(Math.max(at, 0)), opacity: at < 0 ? 0 : 1 }} />
        {DEMO_PLACES.map((p, i) => {
          const Icon = ICON[p]
          return (
            <div key={p} className={s.ic} data-on={p === here || undefined} style={{ top: top(i) }}>
              <Icon />
              <span className={s.railDot} data-on={last?.dot === p || undefined} />
            </div>
          )
        })}
      </div>
      <div className={s.sheet}>
        <DemoPlaceContext value={claim}>
          <SceneFade>{children}</SceneFade>
        </DemoPlaceContext>
      </div>
    </div>
  )
}

// Which scene is showing: the first element child, by type and position. The flow writes its scenes as
// `{step === "read" && <ReadDemo />}`, so a change of step is a change of type here.
function sceneOf(children: ReactNode) {
  const el = Children.toArray(children).find(isValidElement)
  return el ? { type: el.type, key: el.key } : null
}

interface Shown {
  id: number
  node: ReactNode
  scene: ReturnType<typeof sceneOf>
  leaving?: boolean
}

// One scene gives way to the next by cross-fading. The one leaving stays mounted, as it was, until it has
// faded, so nothing in it jumps while it goes.
function SceneFade({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown[]>(() => [{ id: 0, node: children, scene: sceneOf(children) }])
  const current = shown[shown.length - 1]
  const scene = sceneOf(children)
  const same = scene?.type === current.scene?.type && scene?.key === current.scene?.key
  // Kept in step with each render (React's pattern for state that follows props), so the scene that leaves
  // is drawn as it last was
  if (!same) setShown([...shown.slice(0, -1), { ...current, leaving: true }, { id: current.id + 1, node: children, scene }])
  else if (current.node !== children) setShown([...shown.slice(0, -1), { ...current, node: children }])

  const leaving = shown.some((x) => x.leaving)
  useEffect(() => {
    if (!leaving) return
    const id = setTimeout(() => setShown((list) => list.filter((x) => !x.leaving)), FADE_MS)
    return () => clearTimeout(id)
  }, [leaving, shown.length])

  return shown.map((x) => (
    <div key={x.id} className={cn(s.layer, x.leaving ? s.leaving : x.id > 0 && s.entering)}>
      {x.node}
    </div>
  ))
}
