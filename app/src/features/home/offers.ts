import { useMemo } from "react"
import type { ProjectsSummary } from "@owlit/protocol"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useProjectsStore } from "@/features/projects/store"
import { workspaceKey } from "./trail"

// Home's one-time offer to make a project of a loose folder the person worked in lately (core's summary
// lists the folders). One turned down is never offered again: kept in this window's storage per workspace
// folder, as the trail is, and nothing goes to core; a folder renamed is a new folder to offer.

export type Offer = ProjectsSummary["folders"][number]

interface OffersState {
  // Folder paths turned down, per workspace
  dismissed: Record<string, string[]>
}

export const useOfferStore = create<OffersState>()(persist((): OffersState => ({ dismissed: {} }), { name: "owlit-home-offers", version: 1 }))

const NONE: string[] = []

// The folders to offer now
export function useOffers(): Offer[] {
  const folders = useProjectsStore((s) => s.summary?.folders)
  const dismissed = useOfferStore((s) => s.dismissed[workspaceKey()] ?? NONE)
  return useMemo(() => (folders ?? []).filter((f) => !dismissed.includes(f.path)), [folders, dismissed])
}

export function dismissOffer(folder: string) {
  const key = workspaceKey()
  useOfferStore.setState((s) => ({ dismissed: { ...s.dismissed, [key]: [...new Set([...(s.dismissed[key] ?? []), folder])] } }))
}

// Undo of a dismissal
export function restoreOffer(folder: string) {
  const key = workspaceKey()
  useOfferStore.setState((s) => ({ dismissed: { ...s.dismissed, [key]: (s.dismissed[key] ?? []).filter((f) => f !== folder) } }))
}
