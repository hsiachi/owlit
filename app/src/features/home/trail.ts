import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useSettings } from "@/features/settings/store"
import { useWorkspace } from "@/lib/workspace"

// What Home needs that the files don't say: where the cursor was when the user last wrote in a doc. Kept in
// this window's storage per workspace folder; nothing goes to core.

interface DocMark {
  path: string
  at: number
  // Cursor offset in the doc's text, so Home can quote the paragraph the user was writing in
  head: number
}

interface TrailState {
  // Most recent first, per workspace
  docs: Record<string, DocMark[]>
}

const KEEP = 30

export const useTrail = create<TrailState>()(
  persist((): TrailState => ({ docs: {} }), { name: "owlit-home", version: 1, partialize: (s) => ({ docs: s.docs }) }),
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
