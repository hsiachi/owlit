import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useSettings } from "@/features/settings/store"
import { isDesktop } from "@/lib/rpc"
import { useWorkspace } from "@/lib/workspace"

// What Home needs that the files don't say: where the cursor was when the user last wrote in a doc, and
// when they were last here. Kept in this window's storage per workspace folder; nothing goes to core.

interface DocMark {
  path: string
  at: number
  // Cursor offset in the doc's text, so Home can quote the paragraph the user was writing in
  head: number
}

interface TrailState {
  // Most recent first, per workspace
  docs: Record<string, DocMark[]>
  lastActiveAt: Record<string, number>
  // When this launch found the user last here, per workspace; not kept, so it is fresh every launch
  awayFrom: Record<string, number | null>
  // The last stretch in this launch the window was in the background long enough for Owlit to count the
  // user away (its night shift works then); not kept
  lastAway: { from: number; to: number } | null
}

const KEEP = 30

export const useTrail = create<TrailState>()(
  persist((): TrailState => ({ docs: {}, lastActiveAt: {}, awayFrom: {}, lastAway: null }), {
    name: "owlit-home",
    version: 1,
    partialize: (s) => ({ docs: s.docs, lastActiveAt: s.lastActiveAt }),
  }),
)

// The browser preview has no workspace; it gets one shared key
export const workspaceKey = () => useWorkspace.getState().current?.path ?? "browser"

// Privacy › "Remember what I do" turns this off along with the activity journal
const remembering = () => useSettings.getState().view?.activity.enabled !== false

// Called by the doc editor for the user's own edits, never an agent's
export function markDocEdit(path: string, head: number) {
  if (!remembering()) return
  const key = workspaceKey()
  useTrail.setState((s) => {
    const rest = (s.docs[key] ?? []).filter((m) => m.path !== path)
    return { docs: { ...s.docs, [key]: [{ path, at: Date.now(), head }, ...rest].slice(0, KEEP) } }
  })
}

// The first time a workspace is seen in this launch, the last time stored for it is when the user left
function touch() {
  // The desktop app opens its workspace a moment after the window starts
  if (isDesktop && !useWorkspace.getState().current) return
  const key = workspaceKey()
  const s = useTrail.getState()
  const awayFrom = key in s.awayFrom ? s.awayFrom : { ...s.awayFrom, [key]: s.lastActiveAt[key] ?? null }
  useTrail.setState({ awayFrom, lastActiveAt: { ...s.lastActiveAt, [key]: Date.now() } })
}

// As long as the window must be in the background for Owlit to count the user away (core's
// initiative/presence.ts › AWAY_MS)
const AWAY_AFTER = 30_000

// Being here means the window is in front; checked once a minute, so leaving is known to the minute
export function startTrail() {
  const tick = () => document.visibilityState === "visible" && document.hasFocus() && touch()
  touch()
  setInterval(tick, 60_000)
  let blurredAt: number | null = null
  window.addEventListener("blur", () => {
    blurredAt = Date.now()
  })
  window.addEventListener("focus", () => {
    const now = Date.now()
    if (blurredAt !== null && now - blurredAt >= AWAY_AFTER) useTrail.setState({ lastAway: { from: blurredAt, to: now } })
    blurredAt = null
  })
  window.addEventListener("focus", touch)
  window.addEventListener("pagehide", () => document.hasFocus() && touch())
  useWorkspace.subscribe((s, prev) => s.current?.path !== prev.current?.path && touch())
}
