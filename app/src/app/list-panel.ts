import { create } from "zustand"
import { persist } from "zustand/middleware"

// The list panel beside the icon rail (Chat's chats, Docs' tree); its width survives a restart. The default
// keeps the 300px the rail and panel had together.
export const LIST_WIDTH = 260
const LIST_MIN = 200
const LIST_MAX = 480

interface ListPanelState {
  width: number
  setWidth: (width: number) => void
}

export const useListPanel = create<ListPanelState>()(
  persist(
    (set) => ({
      width: LIST_WIDTH,
      setWidth: (width) => set({ width: Math.round(Math.max(LIST_MIN, Math.min(LIST_MAX, width))) }),
    }),
    { name: "owlit-list-panel" },
  ),
)
