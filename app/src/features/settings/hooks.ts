import { useEffect } from "react"
import { openSettings } from "./store"

// ⌘, opens Settings. In the desktop app the app menu's accelerator usually gets there first and sends
// the same command; this covers a plain browser and a focused field that keeps the key.
export function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault()
        openSettings()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
